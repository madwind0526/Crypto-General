// scripts/test-average-drop-ranges.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const current2 = candles[candleIndex];
  const previousWindow = getWindow(candles, candleIndex - 1, 48);
  if (!current2 || previousWindow.length < 12) {
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
  const nearSupport = Math.abs(current2.close - support) / current2.close <= threshold;
  const nearResistance = Math.abs(resistance - current2.close) / current2.close <= threshold;
  const resistanceBreakout = current2.close > resistance * 1.002;
  const supportBreakdown = current2.close < support * 0.998;
  return {
    nearSupport,
    nearResistance,
    resistanceBreakout,
    supportBreakdown
  };
}
function evaluateCandlestickWarnings(candles, candleIndex) {
  const current2 = candles[candleIndex];
  const previous = candles[candleIndex - 1];
  const recent = getWindow(candles, candleIndex, 12);
  if (!current2 || !previous || recent.length < 4) {
    return {
      bearishTopWarning: false,
      bullishReversalHint: false
    };
  }
  const range = Math.max(current2.high - current2.low, Number.EPSILON);
  const body = Math.abs(current2.close - current2.open);
  const upperWick = current2.high - Math.max(current2.open, current2.close);
  const lowerWick = Math.min(current2.open, current2.close) - current2.low;
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const nearRecentHigh = current2.high >= recentHigh * 0.995;
  const bearishEngulfing = current2.close < current2.open && previous.close > previous.open && current2.open >= previous.close && current2.close <= previous.open;
  const shootingStar = nearRecentHigh && upperWick / range >= 0.55 && body / range <= 0.35;
  const longLowerReversal = lowerWick / range >= 0.5 && current2.close > current2.open;
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
function runBacktest(strategy, scenario, candles, config = defaultBacktestConfig) {
  const guideRuleMode = config.guideRuleMode ?? "ignored";
  const slip = (price) => config.dynamicSlippage ? config.dynamicSlippage(price) : config.slippageRate;
  let cash = config.initialCash;
  let position = null;
  const trades = [];
  const signalAudit = [];
  const equityCurve = [];
  let lastSellPrice;
  let lastSellCandleIndex;
  let currentCandleIndex = 0;
  let peakValue = config.initialCash;
  let maxDrawdown2 = 0;
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
      maxDrawdown2 = Math.max(maxDrawdown2, peakValue === 0 ? 0 : (peakValue - portfolioValue) / peakValue);
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
      const fee = budget * config.feeRate;
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
    maxDrawdown2 = Math.max(maxDrawdown2, peakValue === 0 ? 0 : (peakValue - currentValue) / peakValue);
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
    const fee = proceeds * config.feeRate;
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
    returnRate: (finalValue - config.initialCash) / config.initialCash,
    maxDrawdown: maxDrawdown2,
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

// src/simulation/dailyOperation.ts
var defaultOptions = {
  minBuyScore: 0.55,
  rotationAdvantage: 0.12
};
function decideDailyOperation({
  currentPosition,
  now,
  options = {},
  signals
}) {
  const resolved = { ...defaultOptions, ...options };
  const rankedSignals = signals.slice().sort((a, b) => scoreSignal(b) - scoreSignal(a));
  const sellSignal = currentPosition ? rankedSignals.find((signal) => signal.market === currentPosition.market && signal.action === "sell") : void 0;
  const bestBuySignal = rankedSignals.find(
    (signal) => signal.action === "buy" && scoreSignal(signal) >= resolved.minBuyScore
  );
  if (currentPosition && sellSignal) {
    return {
      action: "sell",
      timestamp: now,
      sellMarket: currentPosition.market,
      selectedSignal: sellSignal,
      currentPosition,
      rankedSignals,
      reasonCodes: ["sell-signal-priority", ...sellSignal.reasonCodes]
    };
  }
  if (!currentPosition) {
    if (!bestBuySignal) {
      return {
        action: "hold",
        timestamp: now,
        rankedSignals,
        reasonCodes: ["no-qualified-buy-signal"]
      };
    }
    return {
      action: "buy",
      timestamp: now,
      buyMarket: bestBuySignal.market,
      selectedSignal: bestBuySignal,
      rankedSignals,
      reasonCodes: ["best-buy-signal", ...bestBuySignal.reasonCodes]
    };
  }
  if (bestBuySignal && bestBuySignal.market !== currentPosition.market) {
    const currentMarketBuy = rankedSignals.find(
      (signal) => signal.market === currentPosition.market && signal.action === "buy"
    );
    const currentScore = currentMarketBuy ? scoreSignal(currentMarketBuy) : resolved.minBuyScore;
    const challengerScore = scoreSignal(bestBuySignal);
    if (challengerScore >= currentScore + resolved.rotationAdvantage) {
      return {
        action: "rotate",
        timestamp: now,
        buyMarket: bestBuySignal.market,
        sellMarket: currentPosition.market,
        selectedSignal: bestBuySignal,
        currentPosition,
        rankedSignals,
        reasonCodes: ["stronger-buy-signal-rotation", ...bestBuySignal.reasonCodes]
      };
    }
  }
  return {
    action: "hold",
    timestamp: now,
    currentPosition,
    rankedSignals,
    reasonCodes: ["keep-current-position"]
  };
}
function scoreSignal(signal) {
  return clamp012(signal.strength * 0.65 + signal.qualityScore * 0.35);
}
function clamp012(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/simulation/safety.ts
var MIN_CANDLE_RATIO = 1 / 6;
var MAX_REJECTED_SIGNAL_RATIO = 0.5;
function evaluateSafetyBlock(result, candles, currentReturn) {
  const reasons = [];
  const minCandles = Math.max(60, Math.round(candles.length * MIN_CANDLE_RATIO));
  if (candles.length < minCandles) reasons.push("insufficient-1m-data");
  if (currentReturn <= -0.03) reasons.push("rapid-intraday-drop");
  if (currentReturn >= 0.12) reasons.push("overextended-chase-risk");
  if (result.maxDrawdown >= 0.15) reasons.push("high-max-drawdown");
  if (result.returnRate <= 0) reasons.push("non-positive-backtest");
  const tradeCount = Math.max(1, result.tradeCount);
  if (result.guideRejectedSignals / tradeCount > MAX_REJECTED_SIGNAL_RATIO) reasons.push("many-rejected-signals");
  return {
    blocked: reasons.length > 0,
    reasons
  };
}
function getDailyReturnAtCandleIndex(candles, candleIndex) {
  const candle = candles[candleIndex];
  if (!candle) return 0;
  const dayStart = getKstDayStart(candle.timestamp);
  let lo = 0;
  let hi = candleIndex;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (candles[mid].timestamp < dayStart) lo = mid + 1;
    else hi = mid;
  }
  const first = candles[lo];
  if (!first || first.timestamp > candle.timestamp || first.close === 0) return 0;
  return (candle.close - first.close) / first.close;
}
function getKstDayStart(timestamp) {
  const kstOffsetMs = 9 * 60 * 60 * 1e3;
  const dayMs = 24 * 60 * 60 * 1e3;
  return Math.floor((timestamp + kstOffsetMs) / dayMs) * dayMs - kstOffsetMs;
}

// src/simulation/paperTrading.ts
var defaultOptions2 = {
  autoBlockMode: "disabled",
  guideRuleMode: "strict",
  maxCandles: 288,
  startAt: null,
  config: defaultBacktestConfig
};
var PaperTradingSession = class {
  constructor(strategy, plan, options = {}) {
    this.strategy = strategy;
    this.plan = plan;
    const resolved = resolveOptions(options);
    this.config = resolved.config;
    this.slip = (price) => resolved.config.dynamicSlippage ? resolved.config.dynamicSlippage(price) : resolved.config.slippageRate;
    this.guideRuleMode = resolved.guideRuleMode;
    this.autoBlockMode = resolved.autoBlockMode;
    this.initialCash = resolved.config.initialCash;
    this.cash = resolved.config.initialCash;
    this.selectedMarkets = plan.selectedMarkets;
    this.scenarioById = getScenarioById(strategy);
  }
  initialCash;
  selectedMarkets;
  cash;
  config;
  slip;
  guideRuleMode;
  autoBlockMode;
  scenarioById;
  marketPointers = /* @__PURE__ */ new Map();
  position = null;
  lastSellPriceByMarket = /* @__PURE__ */ new Map();
  lastPositionCandleTimestamp = null;
  trades = [];
  decisions = [];
  equityCurve = [];
  safetyBlockedSignals = 0;
  safetyBlockedByMarket = {};
  blockedSignals = [];
  step(timestamp, candlesByMarket, options = {}) {
    const signals = [];
    const candlesAtTime = /* @__PURE__ */ new Map();
    for (const selected of this.selectedMarkets) {
      const candles = candlesByMarket[selected.market] ?? [];
      const candleIndex = findCandleIndexAtOrBefore(candles, timestamp, this.marketPointers.get(selected.market) ?? 0);
      if (candleIndex < 0) continue;
      this.marketPointers.set(selected.market, candleIndex);
      const candle = candles[candleIndex];
      candlesAtTime.set(selected.market, { candle, candleIndex });
    }
    const riskExitedMarkets = this.updateOpenPosition(candlesAtTime, timestamp, options.riskMarkets);
    if (riskExitedMarkets.size === 0) {
      for (const selected of this.selectedMarkets) {
        if (options.signalMarkets && !options.signalMarkets.has(selected.market)) continue;
        if (riskExitedMarkets.has(selected.market)) continue;
        const candleInfo = candlesAtTime.get(selected.market);
        if (!candleInfo) continue;
        const { candleIndex } = candleInfo;
        const candles = candlesByMarket[selected.market] ?? [];
        const scenario = this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
        const marketPosition = this.position?.market === selected.market ? this.position : null;
        const decision2 = this.strategy.decide(
          {
            market: selected.market,
            candles,
            candleIndex,
            lastSellPrice: this.lastSellPriceByMarket.get(selected.market),
            position: marketPosition,
            portfolioValue: this.getPortfolioValue(candlesAtTime)
          },
          scenario
        );
        const guideRuleEvaluation = evaluateGuideRules({
          candles,
          candleIndex,
          decision: decision2,
          mode: this.guideRuleMode
        });
        let finalAction = decision2.action;
        const guideBlocked = decision2.action === "buy" && this.guideRuleMode === "strict" && !guideRuleEvaluation.passed;
        if (guideBlocked) {
          finalAction = "hold";
          this.blockedSignals.push({
            market: selected.market,
            timestamp,
            reason: "guide-rule",
            reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons],
            guideRuleMode: this.guideRuleMode,
            safetyMode: this.autoBlockMode
          });
        }
        if (decision2.action === "buy" && !guideBlocked && this.autoBlockMode === "enabled") {
          const candlesUntilDecision = candles.slice(0, candleIndex + 1);
          const currentReturn = getDailyReturnAtCandleIndex(candles, candleIndex);
          const safetyEvaluation = evaluateSafetyBlock(selected.bestResult, candlesUntilDecision, currentReturn);
          if (safetyEvaluation.blocked) {
            finalAction = "hold";
            this.safetyBlockedSignals += 1;
            this.safetyBlockedByMarket[selected.market] = (this.safetyBlockedByMarket[selected.market] ?? 0) + 1;
            this.blockedSignals.push({
              market: selected.market,
              timestamp,
              reason: "safety",
              reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons, ...safetyEvaluation.reasons],
              guideRuleMode: this.guideRuleMode,
              safetyMode: this.autoBlockMode
            });
          }
        }
        if (finalAction !== "hold") {
          signals.push({
            market: selected.market,
            action: finalAction,
            strength: decision2.confidence,
            qualityScore: scoreSelectedMarket(selected.score, selected.bestResult.returnRate, selected.bestResult.maxDrawdown),
            timestamp,
            reasonCodes: [...decision2.reasonCodes, ...guideRuleEvaluation.reasons]
          });
        }
      }
    }
    const decision = decideDailyOperation({
      currentPosition: this.position ? {
        market: this.position.market,
        entryPrice: this.position.averagePrice,
        currentPrice: candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice,
        quantity: this.position.quantity,
        openedAt: this.position.openedAt
      } : null,
      now: timestamp,
      options: this.strategy.id === "general-d" || this.strategy.id === "general-e" ? { rotationAdvantage: Number.POSITIVE_INFINITY } : void 0,
      signals
    });
    if ((decision.action === "sell" || decision.action === "rotate") && this.position) {
      const candle = candlesAtTime.get(this.position.market)?.candle;
      if (candle) {
        const basePrice = options.executionPrices?.get(this.position.market) ?? candle.close;
        const exitPrice = basePrice * (1 - this.slip(basePrice));
        this.cash += this.closePosition(this.position, exitPrice, timestamp, decision.reasonCodes);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
      }
    }
    if ((decision.action === "buy" || decision.action === "rotate") && decision.buyMarket && !this.position) {
      const candle = candlesAtTime.get(decision.buyMarket)?.candle;
      if (candle && this.cash > 0) {
        const budget = this.cash;
        const basePrice = options.executionPrices?.get(decision.buyMarket) ?? candle.close;
        const fillPrice = basePrice * (1 + this.slip(basePrice));
        const fee = budget * this.config.feeRate;
        const quantity = Math.max(0, (budget - fee) / fillPrice);
        if (quantity > 0) {
          this.cash -= budget;
          this.position = {
            market: decision.buyMarket,
            quantity,
            averagePrice: fillPrice,
            openedAt: timestamp,
            highestPrice: fillPrice,
            holdCandles: 0
          };
          this.lastPositionCandleTimestamp = candlesAtTime.get(decision.buyMarket)?.candle.timestamp ?? null;
          this.trades.push({
            market: decision.buyMarket,
            side: "buy",
            timestamp,
            price: fillPrice,
            quantity,
            fee,
            reasonCodes: decision.reasonCodes,
            guideRuleMode: this.guideRuleMode
          });
        }
      }
    }
    const portfolioValue = this.getPortfolioValue(candlesAtTime);
    this.decisions.push({
      timestamp,
      action: decision.action,
      buyMarket: decision.buyMarket,
      sellMarket: decision.sellMarket,
      portfolioValue,
      cash: this.cash,
      positionMarket: this.position?.market,
      reasonCodes: decision.reasonCodes
    });
    this.equityCurve.push({ timestamp, value: portfolioValue });
    return decision;
  }
  finalize(candlesByMarket, closeOpenPosition) {
    if (closeOpenPosition && this.position) {
      const candles = candlesByMarket[this.position.market] ?? [];
      const last = candles[this.marketPointers.get(this.position.market) ?? candles.length - 1] ?? candles[candles.length - 1];
      if (last) {
        const exitPrice = last.close * (1 - this.slip(last.close));
        this.cash += this.closePosition(this.position, exitPrice, last.timestamp, ["paper-final-close"]);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
        this.equityCurve.push({ timestamp: last.timestamp, value: this.cash });
      }
    }
    return this.result();
  }
  result() {
    const finalValue = this.equityCurve[this.equityCurve.length - 1]?.value ?? this.getCurrentValue();
    return {
      strategyId: this.strategy.id,
      strategyName: this.strategy.name,
      guideRuleMode: this.guideRuleMode,
      startedAt: this.equityCurve[0]?.timestamp ?? 0,
      endedAt: this.equityCurve[this.equityCurve.length - 1]?.timestamp ?? 0,
      initialCash: this.initialCash,
      finalValue,
      returnRate: (finalValue - this.initialCash) / this.initialCash,
      autoBlockMode: this.autoBlockMode,
      blockedSignals: this.blockedSignals.slice(),
      safetyBlockedByMarket: { ...this.safetyBlockedByMarket },
      safetyBlockedSignals: this.safetyBlockedSignals,
      trades: this.trades.slice(),
      decisions: this.decisions.slice(),
      equityCurve: this.equityCurve.slice()
    };
  }
  getTradeCount() {
    return this.trades.length;
  }
  getPositionMarket() {
    return this.position?.market ?? null;
  }
  updateOpenPosition(candlesAtTime, timestamp, riskMarkets) {
    const riskExitedMarkets = /* @__PURE__ */ new Set();
    if (!this.position) return riskExitedMarkets;
    if (riskMarkets && !riskMarkets.has(this.position.market)) return riskExitedMarkets;
    const candle = candlesAtTime.get(this.position.market)?.candle;
    if (!candle) return riskExitedMarkets;
    const previousHighestPrice = this.position.highestPrice;
    if (this.lastPositionCandleTimestamp !== candle.timestamp) {
      this.position.holdCandles += 1;
      this.lastPositionCandleTimestamp = candle.timestamp;
    }
    const scenario = this.getScenarioForMarket(this.position.market);
    const stopLossPct = scenario?.params.stopLossPct ?? scenario?.params.emergencyStopPct ?? 0;
    const trailingStopPct = scenario?.params.trailingStopPct ?? 0;
    const takeProfitPct = scenario?.params.takeProfitPct ?? 0;
    const stopPrice = this.position.averagePrice * (1 - stopLossPct);
    const trailingStop = previousHighestPrice * (1 - trailingStopPct);
    const takeProfit = this.position.averagePrice * (1 + takeProfitPct);
    const triggeredStops = [
      stopLossPct > 0 && candle.low <= stopPrice ? stopPrice : null,
      trailingStopPct > 0 && candle.low <= trailingStop ? trailingStop : null
    ].filter((price) => price !== null);
    const takeProfitTriggered = takeProfitPct > 0 && candle.high >= takeProfit;
    if (triggeredStops.length > 0 || takeProfitTriggered) {
      const exitedMarket = this.position.market;
      const exitBasePrice = triggeredStops.length > 0 ? Math.max(...triggeredStops) : takeProfit;
      const exitPrice = exitBasePrice * (1 - this.slip(exitBasePrice));
      this.cash += this.closePosition(this.position, exitPrice, timestamp, ["risk-rule-exit"]);
      this.lastSellPriceByMarket.set(exitedMarket, exitPrice);
      riskExitedMarkets.add(exitedMarket);
      this.position = null;
      this.lastPositionCandleTimestamp = null;
    }
    if (this.position) {
      this.position.highestPrice = Math.max(this.position.highestPrice, candle.high);
    }
    return riskExitedMarkets;
  }
  getScenarioForMarket(market) {
    const selected = this.selectedMarkets.find((item) => item.market === market);
    if (!selected) return null;
    return this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
  }
  getPortfolioValue(candlesAtTime) {
    if (!this.position) return this.cash;
    const currentPrice = candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice;
    return this.cash + this.position.quantity * currentPrice;
  }
  getCurrentValue() {
    return this.equityCurve[this.equityCurve.length - 1]?.value ?? this.cash;
  }
  closePosition(positionToClose, price, timestamp, reasonCodes) {
    const proceeds = positionToClose.quantity * price;
    const fee = proceeds * this.config.feeRate;
    this.trades.push({
      market: positionToClose.market,
      side: "sell",
      timestamp,
      price,
      quantity: positionToClose.quantity,
      fee,
      reasonCodes,
      guideRuleMode: this.guideRuleMode
    });
    return proceeds - fee;
  }
};
function runPaperTradingSimulation(strategy, plan, candlesByMarket, options = {}) {
  const resolved = resolveOptions(options);
  const selectedMarkets = plan.selectedMarkets.filter((item) => (candlesByMarket[item.market] ?? []).length > 0);
  const timestamps = getSimulationTimestamps(selectedMarkets.map((item) => candlesByMarket[item.market] ?? [])).filter((timestamp) => resolved.startAt === null || timestamp >= resolved.startAt).slice(-resolved.maxCandles);
  const session = new PaperTradingSession(strategy, plan, resolved);
  for (const timestamp of timestamps) {
    session.step(timestamp, candlesByMarket);
  }
  return session.finalize(candlesByMarket, true);
}
function resolveOptions(options) {
  return {
    ...defaultOptions2,
    ...options,
    config: {
      ...defaultOptions2.config,
      ...options.config,
      guideRuleMode: options.guideRuleMode ?? options.config?.guideRuleMode ?? defaultOptions2.guideRuleMode
    }
  };
}
function getScenarioById(strategy) {
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  return new Map(scenarios.map((scenario) => [scenario.id, scenario]));
}
function getSimulationTimestamps(candleSets) {
  const timestamps = /* @__PURE__ */ new Set();
  for (const candles of candleSets) {
    for (const candle of candles) timestamps.add(candle.timestamp);
  }
  return [...timestamps].sort((a, b) => a - b);
}
function findCandleIndexAtOrBefore(candles, timestamp, startIndex) {
  if (candles.length === 0) return -1;
  const boundedStart = Math.min(Math.max(0, startIndex), candles.length - 1);
  if (candles[boundedStart].timestamp <= timestamp) {
    const nextIndex = boundedStart + 1;
    if (nextIndex >= candles.length || candles[nextIndex].timestamp > timestamp) return boundedStart;
    return findLastIndexAtOrBefore(candles, timestamp, nextIndex, candles.length - 1);
  }
  return findLastIndexAtOrBefore(candles, timestamp, 0, boundedStart);
}
function findLastIndexAtOrBefore(candles, timestamp, low, high) {
  let left = low;
  let right = high;
  let result = -1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle].timestamp <= timestamp) {
      result = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return result;
}
function scoreSelectedMarket(score, returnRate, maxDrawdown2) {
  const normalizedScore = Number.isFinite(score) ? (Math.tanh(score) + 1) / 2 : 0.5;
  return clamp013(normalizedScore * 0.45 + clamp013(returnRate + 0.5) * 0.35 + (1 - clamp013(maxDrawdown2)) * 0.2);
}
function clamp013(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// src/simulation/optimizer.ts
function scoreBacktestResult(result) {
  const drawdownPenalty = result.maxDrawdown * 1.5;
  const activityPenalty = result.tradeCount < 2 ? 0.08 : 0;
  const pfBonus = Math.min(result.profitFactor, 3) * 0.03;
  return result.returnRate - drawdownPenalty + result.winRate * 0.05 + pfBonus - activityPenalty;
}

// src/simulation/traderOptimization.ts
var defaultOptions3 = {
  candidateMarketCount: 30,
  monitoringMarketCount: 15,
  tradeValueLookbackCandles: 1440,
  optimizationLookbackCandles: Number.POSITIVE_INFINITY,
  minCandles: 120,
  guideRuleMode: "ignored",
  minPrice: 100,
  maxPrice: 1e4
};
function selectTopMarketsByTradeValue(candlesByMarket, count, lookbackCandles = defaultOptions3.tradeValueLookbackCandles, minCandles = defaultOptions3.minCandles, minPrice = defaultOptions3.minPrice, maxPrice = defaultOptions3.maxPrice) {
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
  const resolved = { ...defaultOptions3, ...options };
  const config = {
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
    const bestResult = optimizeStrategyForMarket(strategy, candles, config);
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
function optimizeStrategyForMarket(strategy, candles, config) {
  if (candles.length === 0) return null;
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  if (scenarios.length === 0 || !scenarios[0]) return null;
  const results = scenarios.map((scenario) => runBacktest(strategy, scenario, candles, config));
  return results.reduce(
    (best, current2) => scoreBacktestResult(current2) > scoreBacktestResult(best) ? current2 : best
  );
}
function sumRecentTradeValue(candles, lookbackCandles) {
  return candles.slice(Math.max(0, candles.length - lookbackCandles)).reduce((sum, candle) => sum + candle.quoteVolume, 0);
}
function trimCandles(candles, maxCandles) {
  if (!Number.isFinite(maxCandles) || maxCandles <= 0 || candles.length <= maxCandles) return candles;
  return candles.slice(candles.length - maxCandles);
}

// src/strategies/averageDropCycle.ts
var averageDropCycleScenario = {
  id: "average-drop-cycle-5m-entry-0.5-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / entry-0.5% / stop-2.0% / take-0.5%",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 5e-3,
    entryRisePct: 0,
    avgStopPct: 0.02,
    avgTakeProfitPct: 5e-3
  }
};
var averageDropCycleScenarios = buildAverageDropCycleScenarios();
var averageDropCycleStrategy = {
  id: "general-e",
  name: "General-E Average Drop Cycle",
  description: "\uCD5C\uADFC \uD3C9\uADE0 \uAC70\uB798\uAC00\uACA9 \uB300\uBE44 \uAE09\uB77D \uAD6C\uAC04\uC5D0\uC11C \uB9E4\uC218\uD558\uACE0, \uBCF4\uC720 \uC911\uC5D0\uB294 \uD3C9\uADE0\uAC00\uACA9 \uAE30\uBC18 \uC190\uC808/\uC775\uC808 \uC870\uAC74\uC73C\uB85C \uBC18\uBCF5 \uB9E4\uB9E4\uD558\uB294 \uC804\uB7B5\uC785\uB2C8\uB2E4.",
  defaultScenario: averageDropCycleScenario,
  scenarios: averageDropCycleScenarios,
  decide(context, scenario = averageDropCycleScenario) {
    const { candles, candleIndex, position } = context;
    const current2 = candles[candleIndex];
    const averagePrice = getAverageTradePrice(candles, candleIndex, scenario.params.averageWindowCandles);
    if (averagePrice === null || averagePrice <= 0) return hold("warming-up");
    const entryRisePct = scenario.params.entryRisePct ?? 0;
    const entryDropPct = scenario.params.entryDropPct;
    const isRiseMode = entryRisePct > 0;
    if (position) {
      if (isRiseMode) {
        if (current2.close <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["rise-stop-loss"], targetWeight: 0 };
        }
        if (current2.close >= position.averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["rise-take-profit"], targetWeight: 0 };
        }
      } else {
        if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["average-below-entry-stop"], targetWeight: 0 };
        }
        if (current2.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["price-above-average-take-profit"], targetWeight: 0 };
        }
      }
      return hold("average-cycle-position-running");
    }
    if (isRiseMode && current2.close >= averagePrice * (1 + entryRisePct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryRisePct * 5),
        reasonCodes: ["price-above-average-entry"],
        targetWeight: 0.65
      };
    }
    if (!isRiseMode && entryDropPct > 0 && current2.close <= averagePrice * (1 - entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65
      };
    }
    return hold("waiting-average-signal");
  }
};
function buildAverageDropCycleScenarios() {
  const scenarios = [];
  const averageWindows = [5, 10, 30, 60];
  const entryPcts = [0.01, 0.02, 0.03, 0.04, 0.05];
  const stopPcts = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
  const takePcts = [0.01, 0.02, 0.03, 0.04, 0.05];
  for (const averageWindowCandles of averageWindows) {
    for (const entryDropPct of entryPcts) {
      for (const avgStopPct of stopPcts) {
        if (Math.round(avgStopPct * 100) < Math.round(entryDropPct * 100) + 1) continue;
        for (const avgTakeProfitPct of takePcts) {
          const p = (entryDropPct * 100).toFixed(0);
          const s = (avgStopPct * 100).toFixed(0);
          const t = (avgTakeProfitPct * 100).toFixed(0);
          scenarios.push({
            id: `average-drop-cycle-${averageWindowCandles}m-entry-${p}-stop-${s}-take-${t}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / drop-${p}% / stop-${s}% / take-${t}%`,
            description: "Drop mode: buy when price falls below VWAP.",
            params: {
              averageWindowCandles,
              entryDropPct,
              entryRisePct: 0,
              avgStopPct,
              avgTakeProfitPct
            }
          });
        }
      }
    }
  }
  return scenarios;
}
function getAverageTradePrice(candles, candleIndex, windowCandles) {
  return getAverageTradePrices(candles, windowCandles)[candleIndex] ?? null;
}
var averagePriceCache = /* @__PURE__ */ new WeakMap();
function getAverageTradePrices(candles, windowCandles) {
  let byWindow = averagePriceCache.get(candles);
  if (!byWindow) {
    byWindow = /* @__PURE__ */ new Map();
    averagePriceCache.set(candles, byWindow);
  }
  const window = Math.max(1, windowCandles);
  const key = `${window}:${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;
  const averages = [];
  let volumeSum = 0;
  let quoteVolumeSum = 0;
  let closeSum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    if (index < window) {
      averages.push(null);
    } else {
      averages.push(volumeSum > 0 && quoteVolumeSum > 0 ? quoteVolumeSum / volumeSum : closeSum / window);
    }
    const current2 = candles[index];
    volumeSum += current2.volume;
    quoteVolumeSum += current2.quoteVolume;
    closeSum += current2.close;
    if (index >= window) {
      const removed = candles[index - window];
      volumeSum -= removed.volume;
      quoteVolumeSum -= removed.quoteVolume;
      closeSum -= removed.close;
    }
  }
  byWindow.set(key, averages);
  return averages;
}
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

// scripts/test-average-drop-ranges.ts
function upbitTickSlippage(price) {
  if (price < 10) return 0.01 / price;
  if (price < 100) return 0.1 / price;
  if (price < 500) return 1 / price;
  if (price < 1e3) return 5 / price;
  if (price < 5e3) return 10 / price;
  if (price < 1e4) return 50 / price;
  return 100 / price;
}
var root = process.cwd();
var cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
var outputPath = path.join(root, "data", "local", "experiments", "general-e-range-comparison.json");
var payload = JSON.parse(await readFile(cachePath, "utf8"));
var realisticConfig = {
  ...defaultBacktestConfig,
  slippageRate: 0,
  dynamicSlippage: upbitTickSlippage
};
var grids = [
  {
    id: "current",
    label: "Current: entry -1..-5 by 1, stop -1..-6 by 1, take +1..+5 by 1",
    entryPcts: [0.01, 0.02, 0.03, 0.04, 0.05],
    stopPcts: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
    takePcts: [0.01, 0.02, 0.03, 0.04, 0.05]
  },
  {
    id: "narrowed",
    label: "Narrowed: entry -1..-3 by 0.5, stop -1..-5 by 1, take +1..+3 by 0.5",
    entryPcts: [0.01, 0.015, 0.02, 0.025, 0.03],
    stopPcts: [0.01, 0.02, 0.03, 0.04, 0.05],
    takePcts: [0.01, 0.015, 0.02, 0.025, 0.03]
  }
];
var runs = grids.map((grid) => {
  const strategy = withGrid(grid);
  const plan = buildTraderOptimizationPlan(strategy, payload.candlesByMarket, {
    candidateMarketCount: 30,
    monitoringMarketCount: 15,
    tradeValueLookbackCandles: 1440,
    optimizationLookbackCandles: 10080,
    minPrice: 100,
    maxPrice: 1e4,
    guideRuleMode: "ignored",
    config: realisticConfig
  });
  const paper = runPaperTradingSimulation(strategy, plan, payload.candlesByMarket, {
    autoBlockMode: "disabled",
    guideRuleMode: "ignored",
    maxCandles: 10080,
    startAt: null,
    config: realisticConfig
  });
  return { grid, strategy, plan, paper };
});
var [current, narrowed] = runs;
var report = {
  generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
  cache: {
    path: path.relative(root, cachePath),
    generatedAt: payload.generatedAt
  },
  mode: {
    guideRuleMode: "ignored",
    safetyMode: "disabled",
    candidateMarkets: 30,
    monitoringMarkets: 15,
    optimizationCandles: 10080,
    constraint: "stopPct >= entryDropPct + 1 percentage point"
  },
  summaries: runs.map(summarizeRun),
  selectionChanges: {
    kept: intersect(markets(current.plan), markets(narrowed.plan)),
    removed: subtract(markets(current.plan), markets(narrowed.plan)),
    added: subtract(markets(narrowed.plan), markets(current.plan))
  },
  selectedMarkets: runs.map(({ grid, plan }) => ({
    grid: grid.id,
    markets: plan.selectedMarkets.map(toMarketRow)
  })),
  unionComparison: buildUnionComparison(current.plan, narrowed.plan)
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}
`, "utf8");
console.log(`Cache: ${path.relative(root, cachePath)} (${payload.generatedAt ?? "unknown"})`);
console.log(`Report: ${path.relative(root, outputPath)}`);
console.log("Mode: Guideline X / Safety X, realistic Upbit tick slippage, top-30 -> top-15");
console.log("Constraint: stopPct >= entryDropPct + 1 percentage point");
console.log("");
console.table(report.summaries.map(formatSummary));
console.log("");
console.log(`Kept (${report.selectionChanges.kept.length}): ${report.selectionChanges.kept.join(", ")}`);
console.log(`Removed (${report.selectionChanges.removed.length}): ${report.selectionChanges.removed.join(", ") || "-"}`);
console.log(`Added (${report.selectionChanges.added.length}): ${report.selectionChanges.added.join(", ") || "-"}`);
console.log("");
console.log("Narrowed top-15");
console.table(narrowed.plan.selectedMarkets.map((item) => ({
  market: item.market.replace("KRW-", ""),
  scenario: item.bestResult.scenarioName,
  return: fmtPct(item.bestResult.returnRate),
  maxDD: fmtPct(item.bestResult.maxDrawdown),
  trades: item.bestResult.tradeCount
})));
function withGrid(grid) {
  const scenarios = buildScenarios(grid);
  return {
    ...averageDropCycleStrategy,
    scenarios,
    defaultScenario: scenarios[0]
  };
}
function buildScenarios(grid) {
  const scenarios = [];
  for (const averageWindowCandles of [5, 10, 30, 60]) {
    for (const entryDropPct of grid.entryPcts) {
      for (const avgStopPct of grid.stopPcts) {
        if (avgStopPct + 1e-12 < entryDropPct + 0.01) continue;
        for (const avgTakeProfitPct of grid.takePcts) {
          const entry = fmtGridPct(entryDropPct);
          const stop = fmtGridPct(avgStopPct);
          const take = fmtGridPct(avgTakeProfitPct);
          scenarios.push({
            id: `${grid.id}-average-drop-cycle-${averageWindowCandles}m-entry-${entry}-stop-${stop}-take-${take}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / drop-${entry}% / stop-${stop}% / take-${take}%`,
            description: "Temporary backtracking range-comparison scenario.",
            params: {
              averageWindowCandles,
              entryDropPct,
              entryRisePct: 0,
              avgStopPct,
              avgTakeProfitPct
            }
          });
        }
      }
    }
  }
  return scenarios;
}
function summarizeRun(run) {
  const selected = run.plan.selectedMarkets;
  const paperDrawdown = maxDrawdown(run.paper.equityCurve.map((point) => point.value));
  return {
    grid: run.grid.id,
    label: run.grid.label,
    scenarios: run.strategy.scenarios.length,
    candidates: run.plan.candidateMarkets.length,
    selected: selected.length,
    averageSelectedReturn: average(selected.map((item) => item.bestResult.returnRate)),
    medianSelectedReturn: median(selected.map((item) => item.bestResult.returnRate)),
    worstSelectedReturn: Math.min(...selected.map((item) => item.bestResult.returnRate)),
    averageSelectedMaxDrawdown: average(selected.map((item) => item.bestResult.maxDrawdown)),
    selectedBacktestTrades: selected.reduce((sum, item) => sum + item.bestResult.tradeCount, 0),
    portfolioReturn: run.paper.returnRate,
    portfolioFinalValue: run.paper.finalValue,
    portfolioMaxDrawdown: paperDrawdown,
    portfolioTrades: run.paper.trades.length
  };
}
function formatSummary(summary) {
  return {
    grid: summary.grid,
    scenarios: summary.scenarios,
    candidates: summary.candidates,
    selected: summary.selected,
    avgSelected: fmtPct(summary.averageSelectedReturn),
    medianSelected: fmtPct(summary.medianSelectedReturn),
    worstSelected: fmtPct(summary.worstSelectedReturn),
    avgMaxDD: fmtPct(summary.averageSelectedMaxDrawdown),
    selectedTrades: summary.selectedBacktestTrades,
    portfolioReturn: fmtPct(summary.portfolioReturn),
    portfolioFinal: Math.round(summary.portfolioFinalValue).toLocaleString("ko-KR"),
    portfolioMaxDD: fmtPct(summary.portfolioMaxDrawdown),
    portfolioTrades: summary.portfolioTrades
  };
}
function buildUnionComparison(currentPlan, narrowedPlan) {
  const currentByMarket = new Map(currentPlan.optimizedMarkets.map((item) => [item.market, item]));
  const narrowedByMarket = new Map(narrowedPlan.optimizedMarkets.map((item) => [item.market, item]));
  const union = [.../* @__PURE__ */ new Set([...markets(currentPlan), ...markets(narrowedPlan)])].sort();
  return union.map((market) => ({
    market,
    current: currentByMarket.has(market) ? toMarketRow(currentByMarket.get(market)) : null,
    narrowed: narrowedByMarket.has(market) ? toMarketRow(narrowedByMarket.get(market)) : null
  }));
}
function toMarketRow(item) {
  return {
    market: item.market,
    scenarioId: item.bestResult.scenarioId,
    scenarioName: item.bestResult.scenarioName,
    returnRate: item.bestResult.returnRate,
    maxDrawdown: item.bestResult.maxDrawdown,
    tradeCount: item.bestResult.tradeCount,
    winRate: item.bestResult.winRate
  };
}
function markets(plan) {
  return plan.selectedMarkets.map((item) => item.market);
}
function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}
function subtract(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}
function average(values) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
function maxDrawdown(values) {
  let peak = values[0] ?? 0;
  let result = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) result = Math.max(result, (peak - value) / peak);
  }
  return result;
}
function fmtGridPct(value) {
  return Number((value * 100).toFixed(1)).toString();
}
function fmtPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
