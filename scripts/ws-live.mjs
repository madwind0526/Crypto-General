// scripts/ws-live.ts
import WebSocket from "ws";
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
function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine = values.map((_, index) => {
    const fastValue = fastEma[index];
    const slowValue = slowEma[index];
    return fastValue === null || slowValue === null ? null : fastValue - slowValue;
  });
  const firstReal = macdLine.findIndex((v) => v !== null);
  const signalAligned = new Array(macdLine.length).fill(null);
  if (firstReal >= 0) {
    const realValues = macdLine.slice(firstReal);
    const signalFromReal = ema(realValues, signal);
    for (let i = 0; i < signalFromReal.length; i++) {
      signalAligned[firstReal + i] = signalFromReal[i];
    }
  }
  return {
    macdLine,
    signalLine: signalAligned,
    histogram: macdLine.map((value, index) => {
      const signalValue = signalAligned[index];
      return value === null || signalValue === null ? null : value - signalValue;
    })
  };
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
function averageTrueRange(candles, period) {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  return sma(trueRanges, period);
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
function scoreSelectedMarket(score, returnRate, maxDrawdown) {
  const normalizedScore = Number.isFinite(score) ? (Math.tanh(score) + 1) / 2 : 0.5;
  return clamp013(normalizedScore * 0.45 + clamp013(returnRate + 0.5) * 0.35 + (1 - clamp013(maxDrawdown)) * 0.2);
}
function clamp013(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
var averageRiseCycleScenario = {
  id: "average-rise-cycle-5m-entry-0.2-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / rise-entry-0.2% / stop-2.0% / take-0.5%",
  description: "Buy a breakout above VWAP, exit when price drops from entry (stop) or rises further (take-profit).",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0,
    entryRisePct: 2e-3,
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
    const current = candles[candleIndex];
    const averagePrice = getAverageTradePrice(candles, candleIndex, scenario.params.averageWindowCandles);
    if (averagePrice === null || averagePrice <= 0) return hold2("warming-up");
    const entryRisePct = scenario.params.entryRisePct ?? 0;
    const entryDropPct = scenario.params.entryDropPct;
    const isRiseMode = entryRisePct > 0;
    if (position) {
      if (isRiseMode) {
        if (current.close <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["rise-stop-loss"], targetWeight: 0 };
        }
        if (current.close >= position.averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["rise-take-profit"], targetWeight: 0 };
        }
      } else {
        if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["average-below-entry-stop"], targetWeight: 0 };
        }
        if (current.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["price-above-average-take-profit"], targetWeight: 0 };
        }
      }
      return hold2("average-cycle-position-running");
    }
    if (isRiseMode && current.close >= averagePrice * (1 + entryRisePct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryRisePct * 5),
        reasonCodes: ["price-above-average-entry"],
        targetWeight: 0.65
      };
    }
    if (!isRiseMode && entryDropPct > 0 && current.close <= averagePrice * (1 - entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65
      };
    }
    return hold2("waiting-average-signal");
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
    const current = candles[index];
    volumeSum += current.volume;
    quoteVolumeSum += current.quoteVolume;
    closeSum += current.close;
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
function hold2(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

// src/strategies/rangeGrid.ts
var rangeGridScenario = {
  id: "range-grid-default",
  traderId: "range-grid",
  name: "Bollinger range grid",
  description: "Sideways-market Bollinger lower-band entry with mean-reversion exit.",
  params: {
    period: 20,
    deviations: 2,
    rsiPeriod: 14,
    rsiMaxEntry: 38,
    bandWidthMax: 0.08,
    stopLossPct: 0.04,
    takeProfitPct: 0.035,
    maxHoldCandles: 36,
    minProfitPct: 5e-3
    // exit only when return >= 0.5% (time-based exit always fires)
  }
};
var rangeGridScenarios = [
  {
    ...rangeGridScenario,
    id: "range-grid-balanced",
    name: "Balanced range grid"
  },
  {
    ...rangeGridScenario,
    id: "range-grid-tight",
    name: "Tight range grid",
    params: {
      ...rangeGridScenario.params,
      deviations: 1.8,
      rsiMaxEntry: 42,
      bandWidthMax: 0.055,
      takeProfitPct: 0.025,
      stopLossPct: 0.03,
      maxHoldCandles: 24
    }
  },
  {
    ...rangeGridScenario,
    id: "range-grid-deep",
    name: "Deep oversold grid",
    params: {
      ...rangeGridScenario.params,
      deviations: 2.3,
      rsiMaxEntry: 32,
      bandWidthMax: 0.1,
      takeProfitPct: 0.05,
      stopLossPct: 0.055,
      maxHoldCandles: 48
    }
  }
];
var rangeGridStrategy = {
  id: "range-grid",
  name: "Range / Grid Mean Reversion",
  description: "\uD6A1\uBCF4\uC7A5\uC5D0\uC11C\uB294 \uACFC\uB9E4\uB3C4 \uAD6C\uAC04\uC744 \uC0AC\uACE0 \uD3C9\uADE0 \uD68C\uADC0 \uC2DC \uCCAD\uC0B0\uD569\uB2C8\uB2E4.",
  defaultScenario: rangeGridScenario,
  scenarios: rangeGridScenarios,
  decide(context, scenario = rangeGridScenario) {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const indicators = getRangeGridIndicators(candles, scenario);
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    if (band == null || currentRsi === null) return hold3("warming-up");
    if (position) {
      const isTimeExit = position.holdCandles >= scenario.params.maxHoldCandles;
      const isMeanReversionExit = current.close >= band.middle;
      if (isTimeExit || isMeanReversionExit) {
        const minProfitPct = scenario.params.minProfitPct ?? 0;
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (!isTimeExit && minProfitPct > 0 && returnPct < minProfitPct) {
          return hold3("min-profit-wait");
        }
        return { action: "sell", confidence: 0.66, reasonCodes: ["mean-reversion-exit"], targetWeight: 0 };
      }
      return hold3("range-position-running");
    }
    const isSideways = band.widthPct <= scenario.params.bandWidthMax;
    const isOversold = current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry;
    if (isSideways && isOversold) {
      return {
        action: "buy",
        confidence: 0.64,
        reasonCodes: ["sideways-regime", "lower-band-touch", "rsi-oversold"],
        targetWeight: 0.65,
        stopLossPct: scenario.params.stopLossPct,
        takeProfitPct: scenario.params.takeProfitPct,
        maxHoldCandles: scenario.params.maxHoldCandles
      };
    }
    return hold3("no-range-entry");
  }
};
function hold3(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var rangeGridIndicatorCache = /* @__PURE__ */ new WeakMap();
function getRangeGridIndicators(candles, scenario) {
  let scenarioCache = rangeGridIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    rangeGridIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey2(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const indicators = {
    bands: bollinger(closes, scenario.params.period, scenario.params.deviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey2(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/generalSum.ts
var generalSumScenario = {
  id: "general-sum-balanced",
  traderId: "general-sum",
  name: "Balanced regime router",
  description: "\uCF54\uC778\uBCC4 \uCD94\uC138\uB97C \uAC10\uC9C0\uD558\uACE0 \uC0C1\uC2B9(A)/\uD6A1\uBCF4(B)/\uACFC\uB9E4\uB3C4(E)/\uD3C9\uADE0\uD68C\uADC0(C) \uC804\uB7B5\uC73C\uB85C \uC790\uB3D9 \uB77C\uC6B0\uD305\uD569\uB2C8\uB2E4.",
  params: {
    fastEma: 12,
    slowEma: 48,
    rsiPeriod: 14,
    bollPeriod: 20,
    bollDeviations: 2,
    trendSlopeLookback: 12,
    uptrendSlopePct: 8e-3,
    downtrendSlopePct: 8e-3,
    sidewaysBandWidthMax: 0.07,
    oversoldRsiMax: 35
  }
};
var generalSumScenarios = [
  generalSumScenario,
  {
    ...generalSumScenario,
    id: "general-sum-sensitive",
    name: "Sensitive regime router",
    params: {
      ...generalSumScenario.params,
      fastEma: 8,
      slowEma: 34,
      trendSlopeLookback: 8,
      uptrendSlopePct: 5e-3,
      downtrendSlopePct: 5e-3,
      sidewaysBandWidthMax: 0.08,
      oversoldRsiMax: 38
    }
  },
  {
    ...generalSumScenario,
    id: "general-sum-conservative",
    name: "Conservative regime router",
    params: {
      ...generalSumScenario.params,
      fastEma: 20,
      slowEma: 60,
      trendSlopeLookback: 20,
      uptrendSlopePct: 0.012,
      downtrendSlopePct: 0.012,
      sidewaysBandWidthMax: 0.06,
      oversoldRsiMax: 30
    }
  }
];
var generalSumStrategy = {
  id: "general-sum",
  name: "General-Sum Regime Router",
  description: "\uCF54\uC778\uBCC4\uB85C \uD604\uC7AC \uCD94\uC138(\uC0C1\uC2B9/\uD6A1\uBCF4/\uACFC\uB9E4\uB3C4/\uD3C9\uADE0\uD68C\uADC0/\uD558\uB77D)\uB97C \uAC10\uC9C0\uD558\uACE0 \uAC00\uC7A5 \uC801\uD569\uD55C \uC804\uB7B5(A~E)\uC73C\uB85C \uC790\uB3D9 \uC804\uD658\uD569\uB2C8\uB2E4. \uCF54\uC778 \uC120\uD0DD\uC740 \uC5EC\uB7EC \uC804\uB7B5\uC5D0 \uC911\uBCF5 \uB4F1\uC7A5\uD55C \uC885\uBAA9\uC744 \uC6B0\uC120\uD569\uB2C8\uB2E4.",
  defaultScenario: generalSumScenario,
  scenarios: generalSumScenarios,
  decide(context, scenario = generalSumScenario) {
    const { candles, candleIndex, position } = context;
    const params = scenario.params;
    const indicators = getSumIndicators(candles, scenario);
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const slowPrev = indicators.slow[Math.max(0, candleIndex - params.trendSlopeLookback)];
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    if (fast === null || slow === null || slowPrev === null || slowPrev === 0 || band === null || currentRsi === null) {
      return hold4("warming-up");
    }
    const slowSlope = (slow - slowPrev) / slowPrev;
    const regime = detectRegime(fast, slow, slowSlope, band.widthPct, currentRsi, params);
    if (regime === "downtrend") {
      if (position) {
        return { action: "sell", confidence: 0.72, reasonCodes: ["sum-downtrend-exit"], targetWeight: 0 };
      }
      return hold4("sum-downtrend-blocked");
    }
    const sub = getSubStrategyForRegime(regime);
    const decision = sub.strategy.decide(context, sub.scenario);
    return {
      ...decision,
      reasonCodes: [...decision.reasonCodes, `sum-regime:${regime}`]
    };
  }
};
function detectRegime(fast, slow, slowSlope, bandWidthPct, currentRsi, params) {
  const { uptrendSlopePct, downtrendSlopePct, sidewaysBandWidthMax, oversoldRsiMax } = params;
  if (currentRsi <= oversoldRsiMax) return "oversold";
  if (fast > slow && slowSlope >= uptrendSlopePct) return "uptrend";
  if (fast < slow && slowSlope <= -downtrendSlopePct) return "downtrend";
  if (bandWidthPct <= sidewaysBandWidthMax && Math.abs(slowSlope) < uptrendSlopePct) return "sideways";
  return "mean-reversion";
}
function getSubStrategyForRegime(regime) {
  switch (regime) {
    case "uptrend":
      return { strategy: averageDropCycleStrategy, scenario: averageRiseCycleScenario };
    case "sideways":
      return { strategy: rangeGridStrategy, scenario: rangeGridScenario };
    case "oversold":
      return { strategy: averageDropCycleStrategy, scenario: averageDropCycleScenario };
    case "mean-reversion":
    default:
      return { strategy: arbitrageStrategy, scenario: arbitrageScenario };
  }
}
function hold4(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var sumIndicatorCache = /* @__PURE__ */ new WeakMap();
function getSumIndicators(candles, scenario) {
  let scenarioCache = sumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    sumIndicatorCache.set(candles, scenarioCache);
  }
  const key = `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((c) => c.close);
  const indicators = {
    fast: ema(closes, scenario.params.fastEma),
    slow: ema(closes, scenario.params.slowEma),
    bands: bollinger(closes, scenario.params.bollPeriod, scenario.params.bollDeviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}

// src/strategies/momentum.ts
var EXCLUDED_MARKETS = /* @__PURE__ */ new Set(["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-USDT", "KRW-USDC"]);
var momentumScenario = {
  id: "momentum-default",
  traderId: "momentum",
  name: "Regime-filtered momentum",
  description: "EMA trend, RSI, MACD, volume confirmation, fast-EMA exit, and partial profit taking.",
  params: {
    fastEma: 12,
    slowEma: 48,
    rsiPeriod: 14,
    rsiMin: 54,
    volumeLookback: 24,
    volumeMultiplier: 0.8,
    // B: lowered from 1.15 — volume spike is lagging/peak signal
    atrPeriod: 14,
    maxAtrPct: 0.08,
    stopLossPct: 0.035,
    trailingStopPct: 0.045,
    exitRsiMin: 50,
    // A: exit at RSI midline (faster than 48)
    profitTargetPct: 0.03,
    // D: take partial profit at 3%
    profitTargetWeight: 0.5,
    // D: keep 50% after partial profit
    minHoldBars: 30
    // minimum candles before signal-based exit is allowed
  }
};
var momentumScenarios = [
  {
    ...momentumScenario,
    id: "momentum-balanced",
    name: "Balanced momentum"
  },
  {
    ...momentumScenario,
    id: "momentum-fast",
    name: "Fast momentum",
    params: {
      ...momentumScenario.params,
      fastEma: 8,
      slowEma: 34,
      rsiMin: 52,
      volumeMultiplier: 0.7,
      stopLossPct: 0.03,
      trailingStopPct: 0.035,
      exitRsiMin: 50,
      profitTargetPct: 0.025,
      profitTargetWeight: 0.5,
      minHoldBars: 15
    }
  },
  {
    ...momentumScenario,
    id: "momentum-strict",
    name: "Strict momentum",
    params: {
      ...momentumScenario.params,
      fastEma: 20,
      slowEma: 60,
      rsiMin: 58,
      volumeMultiplier: 1.1,
      stopLossPct: 0.025,
      trailingStopPct: 0.04,
      exitRsiMin: 50,
      profitTargetPct: 0.04,
      profitTargetWeight: 0.5,
      minHoldBars: 20
    }
  },
  {
    ...momentumScenario,
    id: "momentum-wide-trail",
    name: "Wide-trail momentum",
    params: {
      ...momentumScenario.params,
      rsiMin: 55,
      volumeMultiplier: 0.7,
      stopLossPct: 0.045,
      trailingStopPct: 0.07,
      exitRsiMin: 50,
      profitTargetPct: 0.05,
      profitTargetWeight: 0.5,
      minHoldBars: 30
    }
  },
  {
    // All indicators scaled to 1h equivalent on 1m candles
    id: "momentum-1h",
    traderId: "momentum",
    name: "Hourly momentum (60/240)",
    description: "All indicator periods scaled to 1h chart equivalent \u2014 suppresses 1m noise.",
    params: {
      fastEma: 60,
      slowEma: 240,
      rsiPeriod: 60,
      // 1h of data for RSI
      rsiMin: 54,
      volumeLookback: 60,
      volumeMultiplier: 0.8,
      atrPeriod: 60,
      maxAtrPct: 0.08,
      stopLossPct: 0.03,
      trailingStopPct: 0.05,
      exitRsiMin: 50,
      macdFast: 60,
      macdSlow: 240,
      macdSignal: 20,
      profitTargetPct: 0.04,
      profitTargetWeight: 0.5,
      minHoldBars: 60
    }
  },
  {
    // All indicators scaled to 30min equivalent on 1m candles
    id: "momentum-30m",
    traderId: "momentum",
    name: "30min momentum (30/120)",
    description: "All indicator periods scaled to 30m chart equivalent \u2014 moderate noise filter.",
    params: {
      fastEma: 30,
      slowEma: 120,
      rsiPeriod: 30,
      // 30min of data for RSI
      rsiMin: 54,
      volumeLookback: 30,
      volumeMultiplier: 0.8,
      atrPeriod: 30,
      maxAtrPct: 0.08,
      stopLossPct: 0.03,
      trailingStopPct: 0.045,
      exitRsiMin: 50,
      macdFast: 30,
      macdSlow: 120,
      macdSignal: 10,
      profitTargetPct: 0.035,
      profitTargetWeight: 0.5,
      minHoldBars: 30
    }
  },
  {
    // All indicators scaled to 2h equivalent on 1m candles
    id: "momentum-2h",
    traderId: "momentum",
    name: "2h momentum (120/480)",
    description: "All indicator periods scaled to 2h chart equivalent \u2014 strongest noise filter.",
    params: {
      fastEma: 120,
      slowEma: 480,
      rsiPeriod: 120,
      // 2h of data for RSI
      rsiMin: 52,
      volumeLookback: 120,
      volumeMultiplier: 0.8,
      atrPeriod: 120,
      maxAtrPct: 0.1,
      stopLossPct: 0.04,
      trailingStopPct: 0.06,
      exitRsiMin: 48,
      macdFast: 120,
      macdSlow: 480,
      macdSignal: 40,
      profitTargetPct: 0.05,
      profitTargetWeight: 0.5,
      minHoldBars: 120
    }
  },
  {
    // C: Pullback entry — enters on dip to fast EMA within established slow-EMA uptrend
    id: "momentum-pullback",
    traderId: "momentum",
    name: "Pullback momentum",
    description: "Enters when price bounces off fast EMA within a slow-EMA uptrend. Avoids overbought entries.",
    params: {
      fastEma: 12,
      slowEma: 48,
      rsiPeriod: 14,
      rsiMin: 45,
      // C: lower threshold — pullback depresses RSI
      rsiMax: 62,
      // C: avoid overbought entries
      volumeLookback: 24,
      volumeMultiplier: 0.7,
      atrPeriod: 14,
      maxAtrPct: 0.08,
      stopLossPct: 0.025,
      // C: tighter stop — entry near support
      trailingStopPct: 0.04,
      exitRsiMin: 50,
      exitEmaBuffer: 5e-3,
      // C: 0.5% below fast EMA before exiting — avoids whipsaw on entry
      profitTargetPct: 0.03,
      profitTargetWeight: 0.5,
      minHoldBars: 20,
      pullbackEntry: 1
      // flag: use pullback entry logic
    }
  }
];
var momentumStrategy = {
  id: "momentum",
  name: "Momentum / Trend Following",
  description: "\uC0C1\uC2B9 \uCD94\uC138\uAC00 \uD655\uC778\uB41C KRW \uB9C8\uCF13\uB9CC \uC9C4\uC785\uD558\uACE0 \uCD94\uC138 \uC57D\uD654 \uC2DC \uBE60\uB974\uAC8C \uC774\uD0C8\uD569\uB2C8\uB2E4.",
  defaultScenario: momentumScenario,
  scenarios: momentumScenarios,
  excludedMarkets: EXCLUDED_MARKETS,
  decide(context, scenario = momentumScenario) {
    if (EXCLUDED_MARKETS.has(context.market)) {
      return hold5("excluded-market");
    }
    const { candles, candleIndex, position } = context;
    const params = scenario.params;
    const current = candles[candleIndex];
    const prev = candleIndex > 0 ? candles[candleIndex - 1] : null;
    const indicators = getMomentumIndicators(candles, scenario);
    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];
    const currentMacd = indicators.macdHistogram[candleIndex];
    const currentAtr = indicators.atr[candleIndex];
    const volumeWindow = indicators.volumes.slice(
      Math.max(0, candleIndex - params.volumeLookback),
      candleIndex
    );
    const averageVolume = volumeWindow.length === 0 ? current.volume : volumeWindow.reduce((sum, value) => sum + value, 0) / volumeWindow.length;
    if (fast === null || slow === null || currentRsi === null || currentMacd === null || currentAtr === null) {
      return hold5("warming-up");
    }
    const atrPct = currentAtr / current.close;
    const exitRsiMin = params.exitRsiMin ?? 48;
    const exitEmaBuffer = params.exitEmaBuffer ?? 0;
    if (position) {
      const profitTargetPct = params.profitTargetPct ?? 0;
      if (profitTargetPct > 0 && !position.partialProfitTaken) {
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (returnPct >= profitTargetPct) {
          return {
            action: "sell",
            confidence: 0.8,
            reasonCodes: ["partial-profit"],
            targetWeight: params.profitTargetWeight ?? 0.5
          };
        }
      }
      const minHoldBars = params.minHoldBars ?? 0;
      if (position.holdCandles < minHoldBars) {
        return hold5("min-hold-period");
      }
      const trendFailed = fast < slow || current.close < fast * (1 - exitEmaBuffer);
      const momentumFailed = currentRsi < exitRsiMin;
      if (trendFailed || momentumFailed) {
        return sell(["momentum-exit", trendFailed ? "trend-failed" : "momentum-failed"]);
      }
      return hold5("position-running");
    }
    const volumeConfirmed = current.volume >= averageVolume * params.volumeMultiplier;
    const uptrend = fast > slow && current.close > slow;
    if (params.pullbackEntry) {
      const rsiMax = params.rsiMax ?? 65;
      const prevFast = prev !== null ? indicators.fast[candleIndex - 1] : null;
      const bouncingOffFast = current.close > fast && current.close <= fast * 1.02 && prevFast !== null && prev !== null && prev.close <= prevFast * 1.005;
      const rsiInRange = currentRsi >= params.rsiMin && currentRsi <= rsiMax;
      if (uptrend && bouncingOffFast && rsiInRange && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.8,
          reasonCodes: ["pullback-entry", "near-fast-ema", "rsi-in-range"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct
        };
      }
    } else {
      const trendUp = fast > slow && current.close > fast;
      const momentumUp = currentRsi >= params.rsiMin && currentMacd > 0;
      if (trendUp && momentumUp && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.78,
          reasonCodes: ["trend-up", "rsi-confirmed", "macd-positive", "volume-confirmed"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct
        };
      }
    }
    return hold5("no-entry");
  }
};
function hold5(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell(reasonCodes) {
  return { action: "sell", confidence: 0.7, reasonCodes, targetWeight: 0 };
}
var momentumIndicatorCache = /* @__PURE__ */ new WeakMap();
function getMomentumIndicators(candles, scenario) {
  let scenarioCache = momentumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    momentumIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey3(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const macdFast = scenario.params.macdFast ?? 12;
  const macdSlow = scenario.params.macdSlow ?? 26;
  const macdSignal = scenario.params.macdSignal ?? 9;
  const indicators = {
    volumes: candles.map((candle) => candle.volume),
    fast: ema(closes, scenario.params.fastEma),
    slow: ema(closes, scenario.params.slowEma),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
    macdHistogram: macd(closes, macdFast, macdSlow, macdSignal).histogram,
    atr: averageTrueRange(candles, scenario.params.atrPeriod)
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey3(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
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
      return hold6("warming-up");
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
      return hold6(targetReached ? "profit-target-trailing" : "waiting-profit-target");
    }
    if (downtrend) return hold6("downtrend-entry-blocked");
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
    return hold6("no-reentry-setup");
  }
};
function hold6(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
function sell2(reasonCodes) {
  return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 };
}
var rangeReentryIndicatorCache = /* @__PURE__ */ new WeakMap();
function getRangeReentryIndicators(candles, scenario) {
  let scenarioCache = rangeReentryIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    rangeReentryIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey4(candles, scenario);
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
function getMutableCandleCacheKey4(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// src/strategies/index.ts
var strategies = [
  momentumStrategy,
  rangeGridStrategy,
  arbitrageStrategy,
  rangeReentryStrategy,
  averageDropCycleStrategy
];

// scripts/ws-live.ts
function upbitTickSlippage(price) {
  if (price < 10) return 0.01 / price;
  if (price < 100) return 0.1 / price;
  if (price < 500) return 1 / price;
  if (price < 1e3) return 5 / price;
  if (price < 5e3) return 10 / price;
  if (price < 1e4) return 50 / price;
  return 100 / price;
}
var realisticConfig = {
  ...defaultBacktestConfig,
  slippageRate: 0,
  dynamicSlippage: upbitTickSlippage
};
var root = process.cwd();
var cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
var outputDir = path.join(root, "public", "market");
var outputPath = path.join(outputDir, "ws-live-results.json");
var wsUrl = "wss://api.upbit.com/websocket/v1";
var outputIntervalMs = 5e3;
var reconnectDelayMs = 5e3;
var closeProcessDelayMs = 1500;
var maxCandles = Number(process.env.WS_MAX_CANDLES ?? process.env.PAPER_MAX_CANDLES ?? 1440);
var minPrice = Number(process.env.WS_MIN_PRICE ?? 100);
var maxPrice = Number(process.env.WS_MAX_PRICE ?? 1e4);
var guideModes = ["strict", "ignored"];
var safetyModes = ["enabled", "disabled"];
var modes = ["wsO", "wsX"];
var selectedMarkets = [];
var operationStartAt;
var connectedAt = "";
var totalTicks = 0;
var wsStatus = "connecting";
var activeWs = null;
var closedCandles = {};
var liveCandle = {};
var lastMinute = {};
var closeTimers = /* @__PURE__ */ new Map();
var intraminuteTradeLocks = /* @__PURE__ */ new Set();
var plans = {
  strict: {},
  ignored: {}
};
var sessions = makeSessionStore();
async function init() {
  const cache = await loadMarketCache();
  operationStartAt = parseBoundary(cache.retentionPolicy?.operationStartAt ?? cache.retentionPolicy?.resetFrom);
  await loadPlans();
  selectedMarkets = filterKnownOutOfRangeMarkets(getPlanMarkets(), cache.candlesByMarket);
  if (selectedMarkets.length === 0) {
    const fallbackMarkets = cache.selectedMarkets?.length ? cache.selectedMarkets : Object.keys(cache.candlesByMarket);
    selectedMarkets = filterKnownOutOfRangeMarkets(fallbackMarkets, cache.candlesByMarket);
  }
  seedClosedCandles(cache);
  seedSessions();
  await writeOutput();
  connect();
  setInterval(() => {
    writeOutput().catch((error) => console.error("[ws-live] output failed", error));
  }, outputIntervalMs);
  setInterval(logStatus, 6e4);
  console.log(`[ws-live] Results: ${path.relative(root, outputPath)}`);
}
function getPlanMarkets() {
  const markets = /* @__PURE__ */ new Set();
  for (const guideRuleMode of guideModes) {
    for (const strategy of [...strategies, generalSumStrategy]) {
      const plan = plans[guideRuleMode][strategy.id];
      for (const item of plan?.selectedMarkets ?? []) markets.add(item.market);
    }
  }
  return [...markets].sort();
}
function filterKnownOutOfRangeMarkets(markets, candlesByMarket) {
  return markets.filter((market) => {
    const candles = candlesByMarket[market] ?? [];
    const lastPrice = candles[candles.length - 1]?.close;
    const keep = lastPrice === void 0 || lastPrice >= minPrice && lastPrice <= maxPrice;
    if (!keep) console.warn(`[ws-live] excluding ${market}: ${lastPrice} KRW is outside ${minPrice}~${maxPrice}`);
    return keep;
  });
}
async function loadMarketCache() {
  const cache = JSON.parse(await readFile(cachePath, "utf8"));
  if (!cache.candlesByMarket || Object.keys(cache.candlesByMarket).length === 0) {
    throw new Error(`No candles found in ${path.relative(root, cachePath)}`);
  }
  return cache;
}
async function loadPlans() {
  for (const strategy of strategies) {
    for (const guideRuleMode of guideModes) {
      const planPath = path.join(
        root,
        "data",
        "local",
        "traders",
        strategy.id,
        "scenarios",
        `optimization-${guideRuleMode}.json`
      );
      let payload;
      try {
        payload = JSON.parse(await readFile(planPath, "utf8"));
      } catch {
        throw new Error(`ws-live: plan file not found or unreadable: ${planPath}
Run 'npm run persist:traders' first.`);
      }
      plans[guideRuleMode][strategy.id] = payload.plan;
    }
  }
  for (const guideRuleMode of guideModes) {
    const planPath = path.join(
      root,
      "data",
      "local",
      "traders",
      generalSumStrategy.id,
      "scenarios",
      `optimization-${guideRuleMode}.json`
    );
    try {
      const payload = JSON.parse(await readFile(planPath, "utf8"));
      plans[guideRuleMode][generalSumStrategy.id] = payload.plan;
    } catch {
    }
  }
}
function seedClosedCandles(cache) {
  for (const market of selectedMarkets) {
    closedCandles[market] = (cache.candlesByMarket[market] ?? []).slice(-maxCandles);
  }
}
function seedSessions() {
  const allStrategies = [...strategies, generalSumStrategy];
  for (const mode of modes) {
    for (const guideRuleMode of guideModes) {
      for (const autoBlockMode of safetyModes) {
        for (const strategy of allStrategies) {
          const plan = plans[guideRuleMode][strategy.id];
          if (!plan) continue;
          const session = new PaperTradingSession(strategy, plan, {
            guideRuleMode,
            autoBlockMode,
            maxCandles,
            config: realisticConfig
          });
          replaySession(session, strategy, plan, guideRuleMode, autoBlockMode);
          sessions[mode][guideRuleMode][autoBlockMode][strategy.id] = session;
        }
      }
    }
  }
}
function replaySession(session, strategy, plan, guideRuleMode, autoBlockMode) {
  void strategy;
  void guideRuleMode;
  void autoBlockMode;
  const selectedCandles = plan.selectedMarkets.map((item) => closedCandles[item.market] ?? []);
  for (const timestamp of getSimulationTimestamps(selectedCandles).filter((candidate) => operationStartAt === void 0 || candidate >= operationStartAt).slice(-maxCandles)) {
    session.step(timestamp, closedCandles);
  }
}
function getSimulationTimestamps(candleSets) {
  const timestamps = /* @__PURE__ */ new Set();
  for (const candles of candleSets) {
    for (const candle of candles) timestamps.add(candle.timestamp);
  }
  return [...timestamps].sort((a, b) => a - b);
}
function connect() {
  wsStatus = "connecting";
  console.log(`[ws-live] Connecting to ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  activeWs = ws;
  ws.on("open", () => {
    wsStatus = "connected";
    connectedAt = (/* @__PURE__ */ new Date()).toISOString();
    ws.send(
      JSON.stringify([
        { ticket: "currency-ws-live" },
        { type: "trade", codes: selectedMarkets }
      ])
    );
    console.log(`[ws-live] Connected. Subscribed ${selectedMarkets.length} markets.`);
  });
  ws.on("message", (data) => {
    try {
      const tick = JSON.parse(data.toString("utf8"));
      if (tick.type === "trade") handleTick(tick);
    } catch {
    }
  });
  ws.on("close", () => {
    wsStatus = "disconnected";
    activeWs = null;
    console.log(`[ws-live] Disconnected. Reconnecting in ${reconnectDelayMs / 1e3}s.`);
    setTimeout(connect, reconnectDelayMs);
  });
  ws.on("error", (error) => {
    console.error(`[ws-live] ${error.message}`);
    ws.terminate();
  });
}
function handleTick(tick) {
  const market = tick.code;
  if (!selectedMarkets.includes(market)) return;
  totalTicks += 1;
  const tickTimestamp = tick.trade_timestamp;
  const minuteTimestamp = Math.floor(tickTimestamp / 6e4) * 6e4;
  const previousMinute = lastMinute[market];
  if (previousMinute !== void 0 && minuteTimestamp > previousMinute) {
    const closed = closeLiveCandle(market);
    if (closed) {
      upsertCandle(closedCandles[market], closed);
      scheduleCloseProcessing(closed.timestamp);
    }
    liveCandle[market] = newLiveCandle(market, tick, minuteTimestamp);
  } else if (!liveCandle[market]) {
    liveCandle[market] = newLiveCandle(market, tick, minuteTimestamp);
  } else {
    updateLiveCandle(liveCandle[market], tick);
  }
  lastMinute[market] = minuteTimestamp;
  stepWsOIntraminute(market, tick.trade_price, tickTimestamp);
}
function stepWsOIntraminute(market, executionPrice, timestamp) {
  const virtual = toVirtualCandle(market);
  if (!virtual) return;
  const candlesByMarket = withVirtualCandle(market, virtual);
  const signalMarkets = /* @__PURE__ */ new Set([market]);
  const riskMarkets = /* @__PURE__ */ new Set([market]);
  const executionPrices = /* @__PURE__ */ new Map([[market, executionPrice]]);
  const minuteTimestamp = virtual.timestamp;
  for (const guideRuleMode of guideModes) {
    for (const autoBlockMode of safetyModes) {
      for (const strategy of strategies) {
        const key = sessionMinuteKey(guideRuleMode, autoBlockMode, strategy.id, minuteTimestamp);
        const session = sessions.wsO[guideRuleMode][autoBlockMode][strategy.id];
        if (!session) continue;
        const locked = intraminuteTradeLocks.has(key);
        const tradeCountBefore = session.getTradeCount();
        const decision = session.step(timestamp, candlesByMarket, {
          executionPrices,
          riskMarkets,
          signalMarkets: locked ? /* @__PURE__ */ new Set() : signalMarkets
        });
        if (decision.action !== "hold" || session.getTradeCount() > tradeCountBefore) intraminuteTradeLocks.add(key);
      }
    }
  }
}
function scheduleCloseProcessing(timestamp) {
  if (closeTimers.has(timestamp)) return;
  const timer = setTimeout(() => {
    closeTimers.delete(timestamp);
    processClosedMinute(timestamp);
  }, closeProcessDelayMs);
  closeTimers.set(timestamp, timer);
}
function processClosedMinute(timestamp) {
  for (const guideRuleMode of guideModes) {
    for (const autoBlockMode of safetyModes) {
      for (const strategy of strategies) {
        const wsXSession = sessions.wsX[guideRuleMode][autoBlockMode][strategy.id];
        wsXSession?.step(timestamp, closedCandles);
        const wsOKey = sessionMinuteKey(guideRuleMode, autoBlockMode, strategy.id, timestamp);
        if (!intraminuteTradeLocks.has(wsOKey)) {
          sessions.wsO[guideRuleMode][autoBlockMode][strategy.id]?.step(timestamp, closedCandles);
        }
      }
    }
  }
  for (const key of [...intraminuteTradeLocks]) {
    if (key.endsWith(`:${timestamp}`)) intraminuteTradeLocks.delete(key);
  }
}
async function writeOutput() {
  const caseResults = {
    strict: {
      enabled: serializeCase("strict", "enabled"),
      disabled: serializeCase("strict", "disabled")
    },
    ignored: {
      enabled: serializeCase("ignored", "enabled"),
      disabled: serializeCase("ignored", "disabled")
    }
  };
  const fallbackCase = caseResults.ignored.disabled;
  const output = {
    connectedAt,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    status: wsStatus,
    tickCount: totalTicks,
    operationStartAt,
    selectedMarkets,
    caseResults,
    wsO: fallbackCase.wsO,
    wsX: fallbackCase.wsX,
    liveCandles: Object.fromEntries(
      Object.entries(liveCandle).map(([market, candle]) => [
        market,
        {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          timestamp: candle.timestamp
        }
      ])
    )
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output)}
`, "utf8");
}
function serializeCase(guideRuleMode, autoBlockMode) {
  return {
    wsO: serializeMode("wsO", guideRuleMode, autoBlockMode),
    wsX: serializeMode("wsX", guideRuleMode, autoBlockMode)
  };
}
function serializeMode(mode, guideRuleMode, autoBlockMode) {
  return Object.fromEntries(
    [...strategies, generalSumStrategy].map((strategy) => {
      const session = sessions[mode][guideRuleMode][autoBlockMode][strategy.id];
      return session ? [strategy.id, serializeResult(session.result())] : null;
    }).filter((entry) => entry !== null)
  );
}
function serializeResult(result) {
  const lastTrade = result.trades.at(-1);
  const openPosition = lastTrade?.side === "buy" ? { market: lastTrade.market, entryPrice: lastTrade.price, holdBars: 0 } : null;
  return {
    returnRate: result.returnRate,
    trades: result.trades.length,
    cash: result.finalValue,
    finalValue: result.finalValue,
    position: openPosition,
    startedAt: result.startedAt,
    endedAt: result.endedAt
  };
}
function newLiveCandle(market, tick, timestamp) {
  return {
    market,
    timestamp,
    open: tick.trade_price,
    high: tick.trade_price,
    low: tick.trade_price,
    close: tick.trade_price,
    volume: tick.trade_volume,
    quoteVolume: tick.trade_price * tick.trade_volume
  };
}
function updateLiveCandle(candle, tick) {
  candle.high = Math.max(candle.high, tick.trade_price);
  candle.low = Math.min(candle.low, tick.trade_price);
  candle.close = tick.trade_price;
  candle.volume += tick.trade_volume;
  candle.quoteVolume += tick.trade_price * tick.trade_volume;
}
function closeLiveCandle(market) {
  const candle = liveCandle[market];
  if (!candle) return null;
  return {
    market,
    timestamp: candle.timestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quoteVolume: candle.quoteVolume
  };
}
function toVirtualCandle(market) {
  return closeLiveCandle(market);
}
function withVirtualCandle(market, virtual) {
  return {
    ...closedCandles,
    [market]: upsertCopy(closedCandles[market] ?? [], virtual)
  };
}
function upsertCandle(candles, candle) {
  const last = candles[candles.length - 1];
  if (last?.timestamp === candle.timestamp) {
    candles[candles.length - 1] = candle;
  } else {
    candles.push(candle);
  }
  if (candles.length > maxCandles) candles.splice(0, candles.length - maxCandles);
}
function upsertCopy(candles, candle) {
  const copy = candles.slice();
  upsertCandle(copy, candle);
  return copy;
}
function makeSessionStore() {
  const store = {};
  for (const mode of modes) {
    store[mode] = {
      strict: { enabled: {}, disabled: {} },
      ignored: { enabled: {}, disabled: {} }
    };
  }
  return store;
}
function sessionMinuteKey(guideRuleMode, autoBlockMode, traderId, timestamp) {
  return `${guideRuleMode}:${autoBlockMode}:${traderId}:${timestamp}`;
}
function parseBoundary(value) {
  if (!value) return void 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : void 0;
}
function logStatus() {
  const fmt = (value) => `${((value ?? 0) * 100).toFixed(2)}%`;
  const row = strategies.map((strategy) => {
    const o = sessions.wsO.ignored.disabled[strategy.id]?.result().returnRate;
    const x = sessions.wsX.ignored.disabled[strategy.id]?.result().returnRate;
    return `${strategy.id}: O ${fmt(o)} / X ${fmt(x)}`;
  }).join(" | ");
  console.log(`[${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)}] ticks ${totalTicks} | ${row}`);
}
init().catch((error) => {
  console.error("[ws-live] Fatal:", error);
  process.exit(1);
});
process.on("SIGINT", () => {
  activeWs?.terminate();
  process.exit(0);
});
process.on("SIGTERM", () => {
  activeWs?.terminate();
  process.exit(0);
});
