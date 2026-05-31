// scripts/backtest-d-reentry.ts
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
function rsi(values, period) {
  const result = Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (index <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (index === period) {
        avgGain /= period;
        avgLoss /= period;
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    if (index >= period) {
      if (avgLoss === 0) {
        result[index] = 100;
      } else {
        const relativeStrength = avgGain / avgLoss;
        result[index] = 100 - 100 / (1 + relativeStrength);
      }
    }
  }
  return result;
}
function bollinger(values, period, deviations) {
  const middle = sma(values, period);
  return values.map((_, index) => {
    const average = middle[index];
    if (average === null) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    const variance = slice.reduce((sum, value) => sum + (value - average) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return {
      lower: average - deviations * sd,
      middle: average,
      upper: average + deviations * sd,
      widthPct: average === 0 ? 0 : 2 * deviations * sd / average
    };
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
function selectTopMarketsByTradeValue(candlesByMarket, count2, lookbackCandles = defaultOptions.tradeValueLookbackCandles, minCandles = defaultOptions.minCandles, minPrice = defaultOptions.minPrice, maxPrice = defaultOptions.maxPrice) {
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
  }).sort((a, b) => b.tradeValue - a.tradeValue).slice(0, count2);
}
function sumRecentTradeValue(candles, lookbackCandles) {
  return candles.slice(Math.max(0, candles.length - lookbackCandles)).reduce((sum, candle) => sum + candle.quoteVolume, 0);
}

// src/strategies/rangeReentry.ts
var rangeReentryScenario = {
  id: "range-reentry-balanced",
  traderId: "general-d",
  name: "Balanced re-entry",
  description: "General-B range logic with profit-target exits and sell-price pullback re-entry.",
  params: {
    period: 20,
    deviations: 2,
    rsiPeriod: 14,
    rsiMaxEntry: 40,
    bandWidthMax: 0.075,
    fastEma: 12,
    slowEma: 48,
    trendSlopeLookback: 12,
    maxTrendSlopePct: 0.012,
    pullbackPct: 0.012,
    profitTargetPct: 0.025,
    reentryDropPct: 0.025,
    trailingStopAfterProfitPct: 0.012,
    emergencyStopPct: 0.04
  }
};
var rangeReentryScenarios = [
  rangeReentryScenario,
  {
    ...rangeReentryScenario,
    id: "range-reentry-tight-box",
    name: "Tight box re-entry",
    params: {
      ...rangeReentryScenario.params,
      deviations: 1.8,
      rsiMaxEntry: 43,
      bandWidthMax: 0.055,
      pullbackPct: 9e-3,
      trailingStopAfterProfitPct: 9e-3,
      emergencyStopPct: 0.032
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-deep-pullback",
    name: "Deep pullback re-entry",
    params: {
      ...rangeReentryScenario.params,
      deviations: 2.25,
      rsiMaxEntry: 35,
      bandWidthMax: 0.095,
      pullbackPct: 0.018,
      profitTargetPct: 0.03,
      reentryDropPct: 0.03,
      trailingStopAfterProfitPct: 0.015,
      emergencyStopPct: 0.05
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-fast-cycle",
    name: "Fast cycle re-entry",
    params: {
      ...rangeReentryScenario.params,
      period: 14,
      fastEma: 8,
      slowEma: 34,
      trendSlopeLookback: 8,
      rsiMaxEntry: 45,
      bandWidthMax: 0.065,
      profitTargetPct: 0.025,
      reentryDropPct: 0.022,
      trailingStopAfterProfitPct: 0.01,
      emergencyStopPct: 0.035
    }
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-trend-ride",
    name: "Trend-ride re-entry",
    params: {
      ...rangeReentryScenario.params,
      rsiMaxEntry: 48,
      bandWidthMax: 0.09,
      pullbackPct: 8e-3,
      maxTrendSlopePct: 8e-3,
      profitTargetPct: 0.025,
      reentryDropPct: 0.025,
      trailingStopAfterProfitPct: 0.02,
      emergencyStopPct: 0.045
    }
  }
];
var rangeReentryStrategy = {
  id: "general-d",
  name: "General-D Range Re-entry",
  description: "General-B \uAE30\uBC18\uC73C\uB85C \uBC15\uC2A4\uAD8C \uC7AC\uC9C4\uC785\uC744 \uB178\uB9AC\uACE0, +2.5% \uC774\uC775 \uAD6C\uAC04 \uC774\uD6C4 \uCD94\uC138\uB294 \uD2B8\uB808\uC77C\uB9C1\uC73C\uB85C \uB530\uB77C\uAC00\uBA70 \uD558\uB77D \uCD94\uC138 \uC9C4\uC785\uC740 \uCC28\uB2E8\uD569\uB2C8\uB2E4.",
  defaultScenario: rangeReentryScenario,
  scenarios: rangeReentryScenarios,
  decide(context, scenario = rangeReentryScenario) {
    const { candles, candleIndex, lastSellPrice, position } = context;
    const current = candles[candleIndex];
    const indicators = getRangeReentryIndicators(candles, scenario);
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const slowPast = indicators.slow[Math.max(0, candleIndex - scenario.params.trendSlopeLookback)];
    if (band === null || currentRsi === null || fast === null || slow === null || slowPast === null || slowPast === 0) {
      return hold("warming-up");
    }
    const slowSlope = (slow - slowPast) / slowPast;
    const sideways = Math.abs(slowSlope) <= scenario.params.maxTrendSlopePct && band.widthPct <= scenario.params.bandWidthMax;
    const uptrend = fast > slow && slowSlope > scenario.params.maxTrendSlopePct;
    const downtrend = fast < slow && slowSlope < -scenario.params.maxTrendSlopePct;
    if (position) {
      const gainFromEntry = (current.close - position.averagePrice) / position.averagePrice;
      const lowFromEntry = (current.low - position.averagePrice) / position.averagePrice;
      const targetReached = position.highestPrice >= position.averagePrice * (1 + scenario.params.profitTargetPct);
      const trailingStop = position.highestPrice * (1 - scenario.params.trailingStopAfterProfitPct);
      if (lowFromEntry <= -scenario.params.emergencyStopPct || gainFromEntry <= -scenario.params.emergencyStopPct) {
        return sell([downtrend ? "emergency-downtrend-exit" : "emergency-stop-exit"]);
      }
      if (targetReached && uptrend && current.close <= trailingStop) {
        return sell(["profit-target-trailing-exit"]);
      }
      if (gainFromEntry >= scenario.params.profitTargetPct && !uptrend) {
        return sell(["profit-target-exit"]);
      }
      return hold(targetReached ? "profit-target-trailing" : "waiting-profit-target");
    }
    if (downtrend) return hold("downtrend-entry-blocked");
    const rangeEntry = sideways && current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry;
    const uptrendPullbackEntry = uptrend && current.close <= fast * (1 - scenario.params.pullbackPct) && currentRsi <= Math.max(scenario.params.rsiMaxEntry, 52);
    if (rangeEntry || uptrendPullbackEntry) {
      return {
        action: "buy",
        confidence: rangeEntry ? 0.66 : 0.6,
        reasonCodes: rangeEntry ? ["box-regime", "lower-band-touch", "rsi-oversold", "reentry-allowed"] : ["uptrend-pullback", "ema-pullback", "reentry-allowed"],
        targetWeight: 0.65
      };
    }
    return hold("no-reentry-setup");
  }
};
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell(reasonCodes) {
  return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 };
}
var rangeReentryIndicatorCache = /* @__PURE__ */ new WeakMap();
function getRangeReentryIndicators(candles, scenario) {
  let scenarioCache = rangeReentryIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    rangeReentryIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const indicators = {
    bands: bollinger(closes, scenario.params.period, scenario.params.deviations),
    fast: ema(closes, scenario.params.fastEma),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
    slow: ema(closes, scenario.params.slowEma)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// scripts/backtest-d-reentry.ts
var root = process.cwd();
var cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
var maxCandles = 7 * 24 * 60;
var cache = JSON.parse(await readFile(cachePath, "utf8"));
var candles7d = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);
var rangeReentryModifiedStrategy = {
  ...rangeReentryStrategy,
  id: "general-d-modified",
  name: "General-D Modified (lastSellPrice re-entry)",
  decide(context, scenario = rangeReentryStrategy.defaultScenario) {
    const { candles, candleIndex, lastSellPrice, position } = context;
    const current = candles[candleIndex];
    const closes = candles.map((c) => c.close);
    const bands = bollinger(closes, scenario.params.period, scenario.params.deviations);
    const fastArr = ema(closes, scenario.params.fastEma);
    const slowArr = ema(closes, scenario.params.slowEma);
    const rsiArr = rsi(closes, scenario.params.rsiPeriod);
    const band = bands[candleIndex];
    const currentRsi = rsiArr[candleIndex];
    const fast = fastArr[candleIndex];
    const slow = slowArr[candleIndex];
    const slowPast = slowArr[Math.max(0, candleIndex - scenario.params.trendSlopeLookback)];
    if (band === null || currentRsi === null || fast === null || slow === null || slowPast === null || slowPast === 0) {
      return hold2("warming-up");
    }
    const slowSlope = (slow - slowPast) / slowPast;
    const sideways = Math.abs(slowSlope) <= scenario.params.maxTrendSlopePct && band.widthPct <= scenario.params.bandWidthMax;
    const uptrend = fast > slow && slowSlope > scenario.params.maxTrendSlopePct;
    const downtrend = fast < slow && slowSlope < -scenario.params.maxTrendSlopePct;
    if (position) {
      const gainFromEntry = (current.close - position.averagePrice) / position.averagePrice;
      const lowFromEntry = (current.low - position.averagePrice) / position.averagePrice;
      const targetReached = position.highestPrice >= position.averagePrice * (1 + scenario.params.profitTargetPct);
      const trailingStop = position.highestPrice * (1 - scenario.params.trailingStopAfterProfitPct);
      if (lowFromEntry <= -scenario.params.emergencyStopPct || gainFromEntry <= -scenario.params.emergencyStopPct) {
        return sell2([downtrend ? "emergency-downtrend-exit" : "emergency-stop-exit"]);
      }
      if (targetReached && uptrend && current.close <= trailingStop) {
        return sell2(["profit-target-trailing-exit"]);
      }
      if (gainFromEntry >= scenario.params.profitTargetPct && !uptrend) {
        return sell2(["profit-target-exit"]);
      }
      return hold2(targetReached ? "profit-target-trailing" : "waiting-profit-target");
    }
    if (downtrend) return hold2("downtrend-entry-blocked");
    const reentryDropPct = scenario.params.reentryDropPct;
    const reentryGateOpen = !lastSellPrice || current.close <= lastSellPrice * (1 - reentryDropPct);
    const rangeEntry = sideways && current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry && reentryGateOpen;
    const uptrendPullbackEntry = uptrend && current.close <= fast * (1 - scenario.params.pullbackPct) && currentRsi <= Math.max(scenario.params.rsiMaxEntry, 52) && reentryGateOpen;
    if (rangeEntry || uptrendPullbackEntry) {
      return {
        action: "buy",
        confidence: rangeEntry ? 0.66 : 0.6,
        reasonCodes: rangeEntry ? ["box-regime", "lower-band-touch", "rsi-oversold", "reentry-gate"] : ["uptrend-pullback", "ema-pullback", "reentry-gate"],
        targetWeight: 0.65
      };
    }
    return hold2("no-reentry-setup");
  }
};
var config = { ...defaultBacktestConfig, guideRuleMode: "ignored" };
var candidates = selectTopMarketsByTradeValue(candles7d, 30);
var scenarios = rangeReentryStrategy.scenarios;
console.log("=".repeat(80));
console.log("General-D: Current vs Modified (lastSellPrice re-entry gate)  [7d, 1m, ignored]");
console.log("=".repeat(80));
console.log(pad("Coin", 8) + pad("Scenario", 26) + pad("Current Return", 16) + pad("Modified Return", 16) + pad("Cur Trades", 11) + pad("Mod Trades", 11) + "Diff");
console.log("-".repeat(100));
var totalCurrentReturn = 0;
var totalModifiedReturn = 0;
var count = 0;
for (const { market } of candidates.slice(0, 30)) {
  const candles = candles7d[market];
  if (!candles || candles.length < 120) continue;
  let bestCurrentReturn = -Infinity;
  let bestCurrentTrades = 0;
  let bestModifiedReturn = -Infinity;
  let bestModifiedTrades = 0;
  let bestScenarioName = "";
  for (const scenario of scenarios) {
    const cur = runBacktest(rangeReentryStrategy, scenario, candles, config);
    const mod = runBacktest(rangeReentryModifiedStrategy, scenario, candles, config);
    if (cur.returnRate > bestCurrentReturn) {
      bestCurrentReturn = cur.returnRate;
      bestCurrentTrades = cur.tradeCount;
      bestScenarioName = scenario.name.replace(" re-entry", "").replace("re-", "").trim();
    }
    if (mod.returnRate > bestModifiedReturn) {
      bestModifiedReturn = mod.returnRate;
      bestModifiedTrades = mod.tradeCount;
    }
  }
  if (bestCurrentTrades === 0 && bestModifiedTrades === 0) continue;
  const coin = market.replace("KRW-", "");
  const diff = bestModifiedReturn - bestCurrentReturn;
  const diffStr = (diff >= 0 ? "+" : "") + pct(diff);
  console.log(
    pad(coin, 8) + pad(bestScenarioName, 26) + pad(pct(bestCurrentReturn), 16) + pad(pct(bestModifiedReturn), 16) + pad(String(bestCurrentTrades), 11) + pad(String(bestModifiedTrades), 11) + diffStr
  );
  totalCurrentReturn += bestCurrentReturn;
  totalModifiedReturn += bestModifiedReturn;
  count++;
}
console.log("\u2500".repeat(100));
if (count > 0) {
  console.log(
    pad("AVG", 8) + pad("", 26) + pad(pct(totalCurrentReturn / count), 16) + pad(pct(totalModifiedReturn / count), 16)
  );
}
function pct(v) {
  return `${(v * 100).toFixed(2)}%`;
}
function pad(s, n) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function hold2(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell2(reasonCodes) {
  return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 };
}
