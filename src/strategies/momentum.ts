import { averageTrueRange, ema, macd, rsi } from "../indicators/technical";
import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

// Large-cap / stablecoin markets: too liquid for trend-following — signals are noise
const EXCLUDED_MARKETS = new Set(["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-USDT", "KRW-USDC"]);

export const momentumScenario: StrategyScenario = {
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
    volumeMultiplier: 0.8,    // B: lowered from 1.15 — volume spike is lagging/peak signal
    atrPeriod: 14,
    maxAtrPct: 0.08,
    stopLossPct: 0.035,
    trailingStopPct: 0.045,
    exitRsiMin: 50,           // A: exit at RSI midline (faster than 48)
    profitTargetPct: 0.03,    // D: take partial profit at 3%
    profitTargetWeight: 0.5,  // D: keep 50% after partial profit
    minHoldBars: 30,          // minimum candles before signal-based exit is allowed
  },
};

const momentumScenarios: StrategyScenario[] = [
  {
    ...momentumScenario,
    id: "momentum-balanced",
    name: "Balanced momentum",
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
      minHoldBars: 15,
    },
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
      minHoldBars: 20,
    },
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
      minHoldBars: 30,
    },
  },
  {
    // All indicators scaled to 1h equivalent on 1m candles
    id: "momentum-1h",
    traderId: "momentum",
    name: "Hourly momentum (60/240)",
    description: "All indicator periods scaled to 1h chart equivalent — suppresses 1m noise.",
    params: {
      fastEma: 60,
      slowEma: 240,
      rsiPeriod: 60,    // 1h of data for RSI
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
      minHoldBars: 60,
    },
  },
  {
    // All indicators scaled to 30min equivalent on 1m candles
    id: "momentum-30m",
    traderId: "momentum",
    name: "30min momentum (30/120)",
    description: "All indicator periods scaled to 30m chart equivalent — moderate noise filter.",
    params: {
      fastEma: 30,
      slowEma: 120,
      rsiPeriod: 30,    // 30min of data for RSI
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
      minHoldBars: 30,
    },
  },
  {
    // All indicators scaled to 2h equivalent on 1m candles
    id: "momentum-2h",
    traderId: "momentum",
    name: "2h momentum (120/480)",
    description: "All indicator periods scaled to 2h chart equivalent — strongest noise filter.",
    params: {
      fastEma: 120,
      slowEma: 480,
      rsiPeriod: 120,   // 2h of data for RSI
      rsiMin: 52,
      volumeLookback: 120,
      volumeMultiplier: 0.8,
      atrPeriod: 120,
      maxAtrPct: 0.10,
      stopLossPct: 0.04,
      trailingStopPct: 0.06,
      exitRsiMin: 48,
      macdFast: 120,
      macdSlow: 480,
      macdSignal: 40,
      profitTargetPct: 0.05,
      profitTargetWeight: 0.5,
      minHoldBars: 120,
    },
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
      rsiMin: 45,              // C: lower threshold — pullback depresses RSI
      rsiMax: 62,              // C: avoid overbought entries
      volumeLookback: 24,
      volumeMultiplier: 0.7,
      atrPeriod: 14,
      maxAtrPct: 0.08,
      stopLossPct: 0.025,      // C: tighter stop — entry near support
      trailingStopPct: 0.04,
      exitRsiMin: 50,
      exitEmaBuffer: 0.005,    // C: 0.5% below fast EMA before exiting — avoids whipsaw on entry
      profitTargetPct: 0.03,
      profitTargetWeight: 0.5,
      minHoldBars: 20,
      pullbackEntry: 1,        // flag: use pullback entry logic
    },
  },
];

export const momentumStrategy: Strategy = {
  id: "momentum",
  name: "Momentum / Trend Following",
  description: "상승 추세가 확인된 KRW 마켓만 진입하고 추세 약화 시 빠르게 이탈합니다.",
  defaultScenario: momentumScenario,
  scenarios: momentumScenarios,
  excludedMarkets: EXCLUDED_MARKETS,
  decide(context: StrategyContext, scenario = momentumScenario): StrategyDecision {
    // 1: Skip large-cap/stablecoin markets — too liquid for trend-following
    if (EXCLUDED_MARKETS.has(context.market)) {
      return hold("excluded-market");
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
      candleIndex,
    );
    const averageVolume =
      volumeWindow.length === 0
        ? current.volume
        : volumeWindow.reduce((sum, value) => sum + value, 0) / volumeWindow.length;

    if (fast === null || slow === null || currentRsi === null || currentMacd === null || currentAtr === null) {
      return hold("warming-up");
    }

    const atrPct = currentAtr / current.close;
    const exitRsiMin = params.exitRsiMin ?? 48;
    // exitEmaBuffer: pullback scenario uses a small buffer below fast EMA to avoid whipsaw
    const exitEmaBuffer = params.exitEmaBuffer ?? 0;

    if (position) {
      // D: partial profit — sell half at profitTargetPct regardless of hold time
      const profitTargetPct = params.profitTargetPct ?? 0;
      if (profitTargetPct > 0 && !position.partialProfitTaken) {
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (returnPct >= profitTargetPct) {
          return {
            action: "sell",
            confidence: 0.8,
            reasonCodes: ["partial-profit"],
            targetWeight: params.profitTargetWeight ?? 0.5,
          };
        }
      }

      // 2: Minimum hold period — suppress signal-based exits during early candles to avoid whipsaw
      const minHoldBars = params.minHoldBars ?? 0;
      if (position.holdCandles < minHoldBars) {
        return hold("min-hold-period");
      }

      // A: fast exit — price below fast EMA (with optional buffer) or RSI at midline
      const trendFailed = fast < slow || current.close < fast * (1 - exitEmaBuffer);
      const momentumFailed = currentRsi < exitRsiMin;
      if (trendFailed || momentumFailed) {
        return sell(["momentum-exit", trendFailed ? "trend-failed" : "momentum-failed"]);
      }
      return hold("position-running");
    }

    const volumeConfirmed = current.volume >= averageVolume * params.volumeMultiplier;
    const uptrend = fast > slow && current.close > slow;

    if (params.pullbackEntry) {
      // C: Pullback entry — price bouncing off fast EMA within slow-EMA uptrend
      const rsiMax = params.rsiMax ?? 65;
      const prevFast = prev !== null ? indicators.fast[candleIndex - 1] : null;
      // Price just crossed above fast EMA (was at/below, now above) and is within 2% of it
      const bouncingOffFast =
        current.close > fast &&
        current.close <= fast * 1.02 &&
        prevFast !== null &&
        prev !== null &&
        prev.close <= prevFast * 1.005;
      const rsiInRange = currentRsi >= params.rsiMin && currentRsi <= rsiMax;

      if (uptrend && bouncingOffFast && rsiInRange && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.80,
          reasonCodes: ["pullback-entry", "near-fast-ema", "rsi-in-range"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct,
        };
      }
    } else {
      // Standard momentum entry: all signals confirming simultaneously
      const trendUp = fast > slow && current.close > fast;
      const momentumUp = currentRsi >= params.rsiMin && currentMacd > 0;

      if (trendUp && momentumUp && volumeConfirmed && atrPct < params.maxAtrPct) {
        return {
          action: "buy",
          confidence: 0.78,
          reasonCodes: ["trend-up", "rsi-confirmed", "macd-positive", "volume-confirmed"],
          targetWeight: 0.95,
          stopLossPct: params.stopLossPct,
          trailingStopPct: params.trailingStopPct,
        };
      }
    }

    return hold("no-entry");
  },
};

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

function sell(reasonCodes: string[]): StrategyDecision {
  return { action: "sell", confidence: 0.7, reasonCodes, targetWeight: 0 };
}

type MomentumIndicators = {
  volumes: number[];
  fast: Array<number | null>;
  slow: Array<number | null>;
  rsiValues: Array<number | null>;
  macdHistogram: Array<number | null>;
  atr: Array<number | null>;
};

const momentumIndicatorCache = new WeakMap<Candle[], Map<string, MomentumIndicators>>();

function getMomentumIndicators(candles: Candle[], scenario: StrategyScenario): MomentumIndicators {
  let scenarioCache = momentumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = new Map();
    momentumIndicatorCache.set(candles, scenarioCache);
  }

  const key = getMutableCandleCacheKey(candles, scenario);
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
    atr: averageTrueRange(candles, scenario.params.atrPeriod),
  };
  scenarioCache.set(key, indicators);
  return indicators;
}

function getMutableCandleCacheKey(candles: Candle[], scenario: StrategyScenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}
