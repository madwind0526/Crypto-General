// scripts/backtest-lowprice-threshold.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

// src/indicators/technical.ts
function sma(values, period) {
  const result = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i + 1 >= period) result[i] = windowSum / period;
  }
  return result;
}
function ema(values, period) {
  const multiplier = 2 / (period + 1);
  let previous = null;
  return values.map((value, index) => {
    if (index + 1 < period) return null;
    if (previous === null) {
      const seed = values.slice(index + 1 - period, index + 1);
      previous = seed.reduce((sum, item) => sum + item, 0) / period;
      return previous;
    }
    previous = (value - previous) * multiplier + previous;
    return previous;
  });
}
function rateOfChange(values, period) {
  return values.map((value, index) => {
    if (index < period) return null;
    const previous = values[index - period];
    return previous === 0 ? 0 : (value - previous) / previous;
  });
}

// src/guideRules/evaluator.ts
var MIN_LOOKBACK = 80;
var movingAverageCache = /* @__PURE__ */ new WeakMap();
var atrCache = /* @__PURE__ */ new WeakMap();
function evaluateGuideRules({
  candleIndex,
  candles,
  decision,
  mode
}) {
  const trend = evaluateDowTheory(candles, candleIndex);
  const movingAverage = evaluateMovingAverages(candles, candleIndex);
  const supportResistance = evaluateSupportResistance(candles, candleIndex);
  const candleWarning = evaluateCandlestickWarnings(candles, candleIndex);
  if (mode === "ignored") {
    return {
      mode,
      passed: true,
      score: 1,
      reasons: ["guide-rules-ignored"],
      blockers: [],
      warnings: [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  if (decision.action === "hold") {
    return {
      mode,
      passed: true,
      score: 0,
      reasons: ["no-action"],
      blockers: [],
      warnings: [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  if (decision.action === "sell") {
    return {
      mode,
      passed: true,
      score: 1,
      reasons: ["sell-signal-allowed"],
      blockers: [],
      warnings: candleWarning.bearishTopWarning ? ["bearish-candle-warning"] : [],
      trend: trend.state,
      movingAverage: movingAverage.state
    };
  }
  const confirmations = [
    trend.state === "uptrend" ? "dow-uptrend" : null,
    movingAverage.state === "bullish" ? "ma-bullish" : null,
    supportResistance.nearSupport ? "near-support" : null,
    supportResistance.resistanceBreakout ? "resistance-breakout" : null,
    candleWarning.bullishReversalHint ? "bullish-reversal-candle" : null
  ].filter((value) => value !== null);
  const blockers = [
    trend.state === "downtrend" && !supportResistance.resistanceBreakout ? "dow-downtrend" : null,
    movingAverage.state === "bearish" && !supportResistance.nearSupport ? "ma-bearish" : null,
    supportResistance.nearResistance && !supportResistance.resistanceBreakout ? "near-resistance" : null,
    supportResistance.supportBreakdown ? "support-breakdown" : null,
    candleWarning.bearishTopWarning ? "bearish-candle-warning" : null
  ].filter((value) => value !== null);
  const hasEnoughData = candleIndex >= MIN_LOOKBACK;
  const passed = hasEnoughData && confirmations.length >= 2 && blockers.length === 0;
  const score = clamp01(confirmations.length / 4 - blockers.length * 0.3);
  return {
    mode,
    passed,
    score,
    reasons: confirmations.length > 0 ? confirmations : ["no-guide-confirmation"],
    blockers: hasEnoughData ? blockers : ["insufficient-guide-history"],
    warnings: candleWarning.bearishTopWarning ? ["bearish-candle-warning"] : [],
    trend: trend.state,
    movingAverage: movingAverage.state
  };
}
function evaluateDowTheory(candles, candleIndex) {
  const window = getWindow(candles, candleIndex, 60);
  if (window.length < 20) {
    return {
      state: "unknown",
      higherHigh: false,
      higherLow: false,
      lowerHigh: false,
      lowerLow: false
    };
  }
  const previous = window.slice(0, Math.floor(window.length / 2));
  const recent = window.slice(Math.floor(window.length / 2));
  const previousHigh = Math.max(...previous.map((candle) => candle.high));
  const previousLow = Math.min(...previous.map((candle) => candle.low));
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const higherHigh = recentHigh > previousHigh;
  const higherLow = recentLow > previousLow;
  const lowerHigh = recentHigh < previousHigh;
  const lowerLow = recentLow < previousLow;
  const state = higherHigh && higherLow ? "uptrend" : lowerHigh && lowerLow ? "downtrend" : "sideways";
  return {
    state,
    higherHigh,
    higherLow,
    lowerHigh,
    lowerLow
  };
}
function evaluateMovingAverages(candles, candleIndex) {
  const { short, medium, long } = getMovingAverageSeries(candles);
  const shortValue = short[candleIndex];
  const mediumValue = medium[candleIndex];
  const longValue = long[candleIndex];
  const mediumPast = medium[Math.max(0, candleIndex - 10)];
  const longPast = long[Math.max(0, candleIndex - 10)];
  if (shortValue === null || mediumValue === null || longValue === null || mediumPast === null || longPast === null) {
    return {
      state: "unknown",
      shortAboveMedium: false,
      mediumAboveLong: false,
      mediumSlopeUp: false,
      longSlopeUp: false
    };
  }
  const shortAboveMedium = shortValue > mediumValue;
  const mediumAboveLong = mediumValue > longValue;
  const mediumSlopeUp = mediumValue > mediumPast;
  const longSlopeUp = longValue >= longPast;
  const state = shortAboveMedium && mediumAboveLong && mediumSlopeUp ? "bullish" : !shortAboveMedium && !mediumAboveLong && !mediumSlopeUp ? "bearish" : "mixed";
  return {
    state,
    shortAboveMedium,
    mediumAboveLong,
    mediumSlopeUp,
    longSlopeUp
  };
}
function getMovingAverageSeries(candles) {
  let byWindow = movingAverageCache.get(candles);
  if (!byWindow) {
    byWindow = /* @__PURE__ */ new Map();
    movingAverageCache.set(candles, byWindow);
  }
  const last = candles[candles.length - 1];
  const key = `${candles.length}:${last?.timestamp ?? 0}:${last?.close ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const series = {
    short: ema(closes, 10),
    medium: ema(closes, 50),
    long: ema(closes, 100)
  };
  byWindow.set(key, series);
  return series;
}
function evaluateSupportResistance(candles, candleIndex) {
  const current = candles[candleIndex];
  const previousWindow = getWindow(candles, candleIndex - 1, 48);
  if (!current || previousWindow.length < 12) {
    return {
      nearSupport: false,
      nearResistance: false,
      resistanceBreakout: false,
      supportBreakdown: false
    };
  }
  const support = Math.min(...previousWindow.map((candle) => candle.low));
  const resistance = Math.max(...previousWindow.map((candle) => candle.high));
  const threshold = Math.max(6e-3, averageTrueRangePct(previousWindow) * 0.8);
  const nearSupport = Math.abs(current.close - support) / current.close <= threshold;
  const nearResistance = Math.abs(resistance - current.close) / current.close <= threshold;
  const resistanceBreakout = current.close > resistance * 1.002;
  const supportBreakdown = current.close < support * 0.998;
  return {
    nearSupport,
    nearResistance,
    resistanceBreakout,
    supportBreakdown
  };
}
function evaluateCandlestickWarnings(candles, candleIndex) {
  const current = candles[candleIndex];
  const previous = candles[candleIndex - 1];
  const recent = getWindow(candles, candleIndex, 12);
  if (!current || !previous || recent.length < 4) {
    return {
      bearishTopWarning: false,
      bullishReversalHint: false
    };
  }
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const body = Math.abs(current.close - current.open);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const nearRecentHigh = current.high >= recentHigh * 0.995;
  const bearishEngulfing = current.close < current.open && previous.close > previous.open && current.open >= previous.close && current.close <= previous.open;
  const shootingStar = nearRecentHigh && upperWick / range >= 0.55 && body / range <= 0.35;
  const longLowerReversal = lowerWick / range >= 0.5 && current.close > current.open;
  return {
    bearishTopWarning: bearishEngulfing || shootingStar,
    bullishReversalHint: longLowerReversal
  };
}
function getWindow(candles, candleIndex, size) {
  if (candleIndex < 0) return [];
  return candles.slice(Math.max(0, candleIndex + 1 - size), candleIndex + 1);
}
function averageTrueRangePct(candles) {
  if (candles.length === 0) return 0;
  let byKey = atrCache.get(candles);
  if (!byKey) {
    byKey = /* @__PURE__ */ new Map();
    atrCache.set(candles, byKey);
  }
  const last = candles[candles.length - 1];
  const key = `${candles.length}:${last?.timestamp ?? 0}:${last?.close ?? 0}`;
  const cached = byKey.get(key);
  if (cached !== void 0) return cached;
  const ranges = candles.map((candle) => (candle.high - candle.low) / candle.close);
  const values = sma(ranges, Math.min(14, ranges.length)).filter((value) => value !== null);
  const result = values.length === 0 ? 0 : values[values.length - 1];
  byKey.set(key, result);
  return result;
}
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/simulation/backtest.ts
var defaultBacktestConfig = {
  initialCash: 1e6,
  feeRate: 5e-4,
  slippageRate: 5e-4
};
function runBacktest(strategy, scenario, candles, config2 = defaultBacktestConfig) {
  const guideRuleMode = config2.guideRuleMode ?? "ignored";
  const slip = (price) => config2.dynamicSlippage ? config2.dynamicSlippage(price) : config2.slippageRate;
  let cash = config2.initialCash;
  let position = null;
  const trades = [];
  const signalAudit = [];
  const equityCurve = [];
  let lastSellPrice;
  let lastSellCandleIndex;
  let currentCandleIndex = 0;
  let peakValue = config2.initialCash;
  let maxDrawdown = 0;
  const roundTripReturns = [];
  for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
    currentCandleIndex = candleIndex;
    const candle = candles[candleIndex];
    let riskExited = false;
    if (position) {
      position.holdCandles += 1;
      const previousHighestPrice = position.highestPrice;
      const stopLossPct = scenario.params.stopLossPct ?? scenario.params.emergencyStopPct ?? 0;
      const trailingStopPct = scenario.params.trailingStopPct ?? 0;
      const takeProfitPct = scenario.params.takeProfitPct ?? 0;
      const stopPrice = position.averagePrice * (1 - stopLossPct);
      const trailingStop = previousHighestPrice * (1 - trailingStopPct);
      const takeProfit = position.averagePrice * (1 + takeProfitPct);
      const triggeredStops = [
        stopLossPct > 0 && candle.low <= stopPrice ? stopPrice : null,
        trailingStopPct > 0 && candle.low <= trailingStop ? trailingStop : null
      ].filter((price) => price !== null);
      const takeProfitTriggered = takeProfitPct > 0 && candle.high >= takeProfit;
      if (triggeredStops.length > 0 || takeProfitTriggered) {
        const exitPrice = triggeredStops.length > 0 ? Math.max(...triggeredStops) : takeProfit;
        const roundTripReturn = closePosition(exitPrice * (1 - slip(exitPrice)), ["risk-rule-exit"], candle.timestamp);
        roundTripReturns.push(roundTripReturn);
        riskExited = true;
      }
      if (position) {
        position.highestPrice = Math.max(position.highestPrice, candle.high);
      }
    }
    const portfolioValue = cash + (position ? position.quantity * candle.close : 0);
    if (riskExited) {
      peakValue = Math.max(peakValue, portfolioValue);
      maxDrawdown = Math.max(maxDrawdown, peakValue === 0 ? 0 : (peakValue - portfolioValue) / peakValue);
      equityCurve.push({ timestamp: candle.timestamp, value: portfolioValue });
      continue;
    }
    const decision = strategy.decide(
      {
        market: candle.market,
        candles,
        candleIndex,
        lastSellPrice,
        lastSellCandleIndex,
        position,
        portfolioValue
      },
      scenario
    );
    const guideRuleEvaluation = decision.action === "hold" ? createPassedGuideRuleEvaluation(guideRuleMode) : evaluateGuideRules({
      candles,
      candleIndex,
      decision,
      mode: guideRuleMode
    });
    const finalAction = decision.action === "buy" && guideRuleMode === "strict" && !guideRuleEvaluation.passed ? "hold" : decision.action;
    if (decision.action !== "hold" || !guideRuleEvaluation.passed) {
      signalAudit.push({
        market: candle.market,
        timestamp: candle.timestamp,
        rawAction: decision.action,
        finalAction,
        confidence: decision.confidence,
        guideRuleMode,
        guideRulePassed: guideRuleEvaluation.passed,
        guideRuleScore: guideRuleEvaluation.score,
        reasonCodes: decision.reasonCodes,
        guideRuleReasons: guideRuleEvaluation.reasons,
        guideRuleBlockers: guideRuleEvaluation.blockers,
        guideRuleWarnings: guideRuleEvaluation.warnings
      });
    }
    if (finalAction === "buy" && !position && decision.targetWeight > 0) {
      const budget = cash * Math.min(decision.targetWeight, 1);
      const fillPrice = candle.close * (1 + slip(candle.close));
      const fee = budget * config2.feeRate;
      const quantity = Math.max(0, (budget - fee) / fillPrice);
      if (quantity > 0) {
        cash -= budget;
        const costBasis = (quantity * fillPrice + fee) / quantity;
        position = {
          market: candle.market,
          quantity,
          averagePrice: costBasis,
          openedAt: candle.timestamp,
          highestPrice: fillPrice,
          holdCandles: 0,
          partialProfitTaken: false
        };
        trades.push({
          market: candle.market,
          side: "buy",
          timestamp: candle.timestamp,
          price: fillPrice,
          quantity,
          fee,
          reasonCodes: [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
          guideRuleMode,
          guideRuleEvaluation
        });
      }
    }
    if (finalAction === "sell" && position) {
      const keepFraction = decision.targetWeight > 0 && decision.targetWeight < 1 ? decision.targetWeight : void 0;
      const roundTripReturn = closePosition(
        candle.close * (1 - slip(candle.close)),
        [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
        candle.timestamp,
        guideRuleEvaluation,
        keepFraction
      );
      roundTripReturns.push(roundTripReturn);
    }
    const currentValue = cash + (position ? position.quantity * candle.close : 0);
    peakValue = Math.max(peakValue, currentValue);
    maxDrawdown = Math.max(maxDrawdown, peakValue === 0 ? 0 : (peakValue - currentValue) / peakValue);
    equityCurve.push({ timestamp: candle.timestamp, value: currentValue });
  }
  if (position) {
    const last = candles[candles.length - 1];
    const roundTripReturn = closePosition(last.close * (1 - slip(last.close)), ["final-close"], last.timestamp);
    roundTripReturns.push(roundTripReturn);
    if (equityCurve.length > 0 && equityCurve[equityCurve.length - 1].timestamp === last.timestamp) {
      equityCurve[equityCurve.length - 1].value = cash;
    } else {
      equityCurve.push({ timestamp: last.timestamp, value: cash });
    }
  }
  const finalValue = equityCurve[equityCurve.length - 1]?.value ?? cash;
  const wins = roundTripReturns.filter((value) => value > 0);
  const losses = roundTripReturns.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  function closePosition(price, reasonCodes, timestamp, guideRuleEvaluation, keepFraction) {
    if (!position) return 0;
    const isPartial = keepFraction !== void 0 && keepFraction > 0 && keepFraction < 1;
    const sellQuantity = isPartial ? position.quantity * (1 - keepFraction) : position.quantity;
    const proceeds = sellQuantity * price;
    const fee = proceeds * config2.feeRate;
    const entryCost = sellQuantity * position.averagePrice;
    const realized = proceeds - fee - entryCost;
    trades.push({
      market: position.market,
      side: "sell",
      timestamp,
      price,
      quantity: sellQuantity,
      fee,
      reasonCodes,
      guideRuleMode,
      guideRuleEvaluation
    });
    cash += proceeds - fee;
    if (isPartial) {
      position.quantity *= keepFraction;
      position.partialProfitTaken = true;
      return entryCost === 0 ? 0 : realized / entryCost;
    }
    lastSellPrice = price;
    lastSellCandleIndex = currentCandleIndex;
    position = null;
    return entryCost === 0 ? 0 : realized / entryCost;
  }
  return {
    strategyId: strategy.id,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scenarioParams: scenario.params,
    market: candles[0]?.market ?? "UNKNOWN",
    finalValue,
    returnRate: (finalValue - config2.initialCash) / config2.initialCash,
    maxDrawdown,
    winRate: roundTripReturns.length === 0 ? 0 : wins.length / roundTripReturns.length,
    tradeCount: trades.length,
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    worstTradeReturn: roundTripReturns.length === 0 ? 0 : Math.min(...roundTripReturns),
    guideRuleMode,
    guideRejectedSignals: signalAudit.filter((signal) => signal.rawAction !== signal.finalAction).length,
    trades,
    signalAudit,
    equityCurve
  };
}
function createPassedGuideRuleEvaluation(mode) {
  return {
    mode,
    passed: true,
    score: 1,
    reasons: [],
    blockers: [],
    warnings: [],
    trend: "unknown",
    movingAverage: "unknown"
  };
}

// src/simulation/optimizer.ts
function scoreBacktestResult(result) {
  const drawdownPenalty = result.maxDrawdown * 1.5;
  const activityPenalty = result.tradeCount < 2 ? 0.08 : 0;
  const pfBonus = Math.min(result.profitFactor, 3) * 0.03;
  return result.returnRate - drawdownPenalty + result.winRate * 0.05 + pfBonus - activityPenalty;
}

// src/simulation/traderOptimization.ts
var defaultOptions = {
  candidateMarketCount: 30,
  monitoringMarketCount: 15,
  tradeValueLookbackCandles: 1440,
  optimizationLookbackCandles: Number.POSITIVE_INFINITY,
  minCandles: 120,
  guideRuleMode: "ignored",
  minPrice: 100,
  maxPrice: 1e4
};
function selectTopMarketsByTradeValue(candlesByMarket, count, lookbackCandles = defaultOptions.tradeValueLookbackCandles, minCandles = defaultOptions.minCandles, minPrice = defaultOptions.minPrice, maxPrice = defaultOptions.maxPrice) {
  return Object.entries(candlesByMarket).map(([market, candles]) => ({
    market,
    tradeValue: sumRecentTradeValue(candles, lookbackCandles),
    candleCount: candles.length,
    lastPrice: candles.length > 0 ? candles[candles.length - 1].close : 0
  })).filter((rank) => {
    if (rank.candleCount < minCandles || rank.tradeValue <= 0) return false;
    if (minPrice !== void 0 && rank.lastPrice < minPrice) return false;
    if (maxPrice !== void 0 && rank.lastPrice > maxPrice) return false;
    return true;
  }).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, count);
}
function buildTraderOptimizationPlan(strategy, candlesByMarket, options = {}) {
  const resolved = { ...defaultOptions, ...options };
  const config2 = {
    ...defaultBacktestConfig,
    ...resolved.config,
    guideRuleMode: resolved.guideRuleMode
  };
  const candidateMarkets = selectTopMarketsByTradeValue(
    candlesByMarket,
    resolved.candidateMarketCount,
    resolved.tradeValueLookbackCandles,
    resolved.minCandles,
    resolved.minPrice,
    resolved.maxPrice
  ).filter((rank) => !strategy.excludedMarkets?.has(rank.market));
  const optimizedMarkets = candidateMarkets.map((candidate, index) => {
    const candles = trimCandles(candlesByMarket[candidate.market] ?? [], resolved.optimizationLookbackCandles);
    const bestResult = optimizeStrategyForMarket(strategy, candles, config2);
    if (!bestResult) return null;
    return {
      market: candidate.market,
      candidateRank: index + 1,
      tradeValue: candidate.tradeValue,
      score: scoreBacktestResult(bestResult),
      bestResult
    };
  }).filter((result) => result !== null).sort(compareOptimizationsByPureReturn);
  const selectedMarkets = optimizedMarkets.filter((m) => m.bestResult.tradeCount > 0).slice(0, resolved.monitoringMarketCount);
  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    guideRuleMode: resolved.guideRuleMode,
    candidateMarketCount: resolved.candidateMarketCount,
    monitoringMarketCount: resolved.monitoringMarketCount,
    candidateMarkets,
    optimizedMarkets,
    selectedMarkets
  };
}
function compareOptimizationsByPureReturn(a, b) {
  return b.bestResult.returnRate - a.bestResult.returnRate || b.score - a.score;
}
function optimizeStrategyForMarket(strategy, candles, config2) {
  if (candles.length === 0) return null;
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  if (scenarios.length === 0 || !scenarios[0]) return null;
  const results = scenarios.map((scenario) => runBacktest(strategy, scenario, candles, config2));
  return results.reduce(
    (best, current) => scoreBacktestResult(current) > scoreBacktestResult(best) ? current : best
  );
}
function sumRecentTradeValue(candles, lookbackCandles) {
  return candles.slice(Math.max(0, candles.length - lookbackCandles)).reduce((sum, candle) => sum + candle.quoteVolume, 0);
}
function trimCandles(candles, maxCandles2) {
  if (!Number.isFinite(maxCandles2) || maxCandles2 <= 0 || candles.length <= maxCandles2) return candles;
  return candles.slice(candles.length - maxCandles2);
}

// src/strategies/arbitrage.ts
var arbitrageScenario = {
  id: "relative-strength-arb-default",
  traderId: "arbitrage",
  name: "Relative-value proxy",
  description: "A spot-only proxy for future pair/funding arbitrage infrastructure.",
  params: {
    lookback: 48,
    zEntry: -1.6,
    zExit: -0.2,
    stopLossPct: 0.03,
    maxHoldCandles: 48,
    minProfitPct: 0.01,
    // exit only when z recovers AND return >= this threshold
    cooldownBars: 5
    // bars to skip after closing before re-entering
  }
};
var arbitrageScenarios = [
  {
    ...arbitrageScenario,
    id: "relative-value-balanced",
    name: "Balanced relative value"
  },
  {
    ...arbitrageScenario,
    id: "relative-value-fast",
    name: "Fast relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 24,
      zEntry: -1.25,
      zExit: -0.05,
      stopLossPct: 0.025,
      maxHoldCandles: 24,
      minProfitPct: 5e-3,
      // fast scenario: 0.5% (quick mean-reversion, lower threshold)
      cooldownBars: 3
    }
  },
  {
    ...arbitrageScenario,
    id: "relative-value-deep",
    name: "Deep relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 72,
      zEntry: -2.1,
      zExit: -0.35,
      stopLossPct: 0.045,
      maxHoldCandles: 72,
      minProfitPct: 8e-3,
      cooldownBars: 10
    }
  }
];
var arbitrageStrategy = {
  id: "arbitrage",
  name: "Statistical / Funding Arbitrage",
  description: "\uCD08\uAE30 \uBC84\uC804\uC740 \uD604\uBB3C \uB370\uC774\uD130\uB9CC \uC0AC\uC6A9\uD574 \uC0C1\uB300\uC801\uC73C\uB85C \uB20C\uB9B0 \uC885\uBAA9\uC758 \uD68C\uADC0 \uAC00\uB2A5\uC131\uC744 \uD14C\uC2A4\uD2B8\uD569\uB2C8\uB2E4.",
  defaultScenario: arbitrageScenario,
  scenarios: arbitrageScenarios,
  decide(context, scenario = arbitrageScenario) {
    const { candles, candleIndex, position, lastSellCandleIndex } = context;
    const params = scenario.params;
    const current = candles[candleIndex];
    const indicators = getArbitrageIndicators(candles, scenario);
    const window = indicators.returns.slice(Math.max(0, candleIndex - params.lookback), candleIndex);
    if (window.length < params.lookback) return hold("warming-up");
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / (window.length - 1);
    const sd = Math.sqrt(variance);
    if (sd === 0) return hold("flat-relative-window");
    const zScore = (indicators.returns[candleIndex] - average) / sd;
    const minProfitPct = params.minProfitPct ?? 0;
    const cooldownBars = params.cooldownBars ?? 0;
    if (position) {
      const returnPct = (current.close - position.averagePrice) / position.averagePrice;
      if (position.holdCandles >= params.maxHoldCandles) {
        return { action: "sell", confidence: 0.58, reasonCodes: ["max-hold-exit"], targetWeight: 0 };
      }
      const effectiveMinProfitPct = params.lowPriceThreshold && current.close < params.lowPriceThreshold ? params.lowPriceMinProfitPct ?? minProfitPct : minProfitPct;
      if (zScore >= params.zExit) {
        if (returnPct >= effectiveMinProfitPct) {
          return { action: "sell", confidence: 0.58, reasonCodes: ["relative-value-normalized", "profit-target"], targetWeight: 0 };
        }
        return hold("awaiting-profit-target");
      }
      return hold("relative-position-running");
    }
    if (cooldownBars > 0 && lastSellCandleIndex !== void 0) {
      if (candleIndex - lastSellCandleIndex < cooldownBars) {
        return hold("cooldown");
      }
    }
    if (zScore <= params.zEntry) {
      return {
        action: "buy",
        confidence: 0.54,
        reasonCodes: ["temporary-underperformance", "statistical-reversion-candidate"],
        targetWeight: 0.45,
        stopLossPct: params.stopLossPct,
        maxHoldCandles: params.maxHoldCandles
      };
    }
    return hold("no-relative-value-entry");
  }
};
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var arbitrageIndicatorCache = /* @__PURE__ */ new WeakMap();
function getArbitrageIndicators(candles, scenario) {
  let scenarioCache = arbitrageIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    arbitrageIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const returns = rateOfChange(closes, 1).map((value) => value ?? 0);
  const indicators = {
    returns
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// scripts/backtest-lowprice-threshold.ts
var root = process.cwd();
var cache = JSON.parse(
  await readFile(path.join(root, "data", "market", "upbit-krw-1m-backtracking.json"), "utf8")
);
var maxCandles = 7 * 24 * 60;
var candles7d = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);
var LOW_PRICE_THRESHOLD = 100;
var lowPriceMarkets = Object.entries(candles7d).filter(([, c]) => c.length > 0 && c[c.length - 1].close < LOW_PRICE_THRESHOLD).map(([m]) => m);
var highPriceMarkets = Object.entries(candles7d).filter(([, c]) => c.length > 0 && c[c.length - 1].close >= LOW_PRICE_THRESHOLD).map(([m]) => m);
console.log(`
\uC800\uAC00 \uCF54\uC778 (< ${LOW_PRICE_THRESHOLD}\uC6D0): ${lowPriceMarkets.map((m) => m.replace("KRW-", "")).join(", ")}`);
console.log(`\uACE0\uAC00 \uCF54\uC778 (>= ${LOW_PRICE_THRESHOLD}\uC6D0): ${highPriceMarkets.map((m) => m.replace("KRW-", "")).join(", ")}
`);
var config = { ...defaultBacktestConfig, guideRuleMode: "ignored" };
var opts = { candidateMarketCount: 30, monitoringMarketCount: 15, guideRuleMode: "ignored", config };
function makeArbWithLowPriceThreshold(lowPriceMinProfitPct) {
  const patchScenario = (s) => ({
    ...s,
    params: {
      ...s.params,
      lowPriceThreshold: LOW_PRICE_THRESHOLD,
      lowPriceMinProfitPct
    }
  });
  return {
    ...arbitrageStrategy,
    scenarios: arbitrageStrategy.scenarios?.map(patchScenario),
    defaultScenario: patchScenario(arbitrageScenario)
  };
}
var arbCurrent = arbitrageStrategy;
var arbLow2pct = makeArbWithLowPriceThreshold(0.02);
var arbLow3pct = makeArbWithLowPriceThreshold(0.03);
async function measure(strategy, label) {
  const plan = buildTraderOptimizationPlan(strategy, candles7d, opts);
  const markets = plan.selectedMarkets;
  if (markets.length === 0) return { label, markets: 0, avgReturn: 0, avgTrades: 0, avgWinRate: 0, avgDD: 0 };
  return {
    label,
    markets: markets.length,
    avgReturn: avg(markets.map((m) => m.bestResult.returnRate)),
    avgTrades: avg(markets.map((m) => m.bestResult.tradeCount)),
    avgWinRate: avg(markets.map((m) => m.bestResult.winRate)),
    avgDD: avg(markets.map((m) => m.bestResult.maxDrawdown))
  };
}
var liveMarkets = ["KRW-DOGE", "KRW-PENGU", "KRW-META", "KRW-ALT", "KRW-UP2", "KRW-NEAR", "KRW-SAFE", "KRW-ZBT", "KRW-NXPC"];
async function measurePerCoin() {
  const rows = [];
  for (const market of liveMarkets) {
    const c = candles7d[market];
    if (!c || c.length === 0) continue;
    const lastPrice = c[c.length - 1].close;
    const scenarios = arbitrageStrategy.scenarios ?? [arbitrageScenario];
    const bestFor = (strat) => {
      const bestScenario = scenarios.reduce(
        (best, scenario) => {
          const result = runBacktest(strat, scenario, c, config);
          return result.returnRate > best.returnRate ? result : best;
        },
        { returnRate: -Infinity, tradeCount: 0 }
      );
      return bestScenario;
    };
    const r0 = bestFor(arbCurrent);
    const r2 = bestFor(arbLow2pct);
    const r3 = bestFor(arbLow3pct);
    rows.push({
      market: market.replace("KRW-", ""),
      price: lastPrice,
      current: r0.returnRate,
      low2pct: r2.returnRate,
      low3pct: r3.returnRate,
      trades_current: r0.tradeCount,
      trades_low2: r2.tradeCount
    });
  }
  return rows;
}
console.log("Computing... (7\uC77C backtest, \uC57D 30\uCD08 \uC18C\uC694)");
var [summaryRows, coinRows] = await Promise.all([
  Promise.all([
    measure(arbCurrent, "\uD604\uC7AC (\uC800\uAC00 0.5%)"),
    measure(arbLow2pct, "\uC800\uAC00 \uCF54\uC778 2%"),
    measure(arbLow3pct, "\uC800\uAC00 \uCF54\uC778 3%")
  ]),
  measurePerCoin()
]);
console.log("\n" + "=".repeat(70));
console.log("\uC804\uB7B5\uBCC4 \uC804\uCCB4 \uC694\uC57D (7\uC77C 1m backtest, guideline=ignored)");
console.log("=".repeat(70));
console.log(pad("\uC804\uB7B5", 22) + pad("\uCF54\uC778\uC218", 7) + pad("\uD3C9\uADE0\uC218\uC775", 9) + pad("\uAC70\uB798\uC218", 7) + pad("\uC2B9\uB960", 8) + "MaxDD");
console.log("-".repeat(70));
for (const r of summaryRows) {
  console.log(
    pad(r.label, 22) + pad(String(r.markets), 7) + pad(pct(r.avgReturn), 9) + pad(r.avgTrades.toFixed(0), 7) + pad(pct(r.avgWinRate), 8) + pct(r.avgDD)
  );
}
console.log("\n" + "=".repeat(80));
console.log("Live-trader \uB300\uC0C1 \uCF54\uC778\uBCC4 \uC218\uC775\uB960 \uBE44\uAD50");
console.log("=".repeat(80));
console.log(pad("\uCF54\uC778", 8) + pad("\uD604\uC7AC\uAC00", 9) + pad("\uD604\uC7AC(0.5%)", 12) + pad("\uC800\uAC002%", 10) + pad("\uC800\uAC003%", 10) + pad("\uAC70\uB798\uC218\u2193", 10) + "\uBE44\uACE0");
console.log("-".repeat(80));
for (const r of coinRows) {
  const isLow = r.price < LOW_PRICE_THRESHOLD;
  const diff2 = r.low2pct - r.current;
  const marker = isLow ? diff2 > 0 ? "\u25B2 \uAC1C\uC120" : diff2 < -1e-3 ? "\u25BC \uC545\uD654" : "\u2014 \uC720\uC0AC" : "(\uACE0\uAC00, \uC601\uD5A5\uC5C6\uC74C)";
  console.log(
    pad(r.market, 8) + pad(`${r.price.toFixed(1)}\uC6D0`, 9) + pad(pct(r.current), 12) + pad(isLow ? pct(r.low2pct) : "\u2014", 10) + pad(isLow ? pct(r.low3pct) : "\u2014", 10) + pad(isLow ? `${r.trades_current}\u2192${r.trades_low2}` : "\u2014", 10) + marker
  );
}
console.log(`
\u203B \uC800\uAC00 \uAE30\uC900: ${LOW_PRICE_THRESHOLD}\uC6D0 \uBBF8\uB9CC`);
console.log("\u203B \uC800\uAC00 \uCF54\uC778 2%/3% \uC801\uC6A9 \uC2DC \uACE0\uAC00 \uCF54\uC778\uC740 \uAE30\uC874 \uC2DC\uB098\uB9AC\uC624 \uADF8\uB300\uB85C \uC720\uC9C0\uB428");
function avg(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}
function pad(s, n) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
