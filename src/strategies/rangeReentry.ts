import { bollinger, ema, rsi } from "../indicators/technical";
import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

export const rangeReentryScenario: StrategyScenario = {
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
    emergencyStopPct: 0.04,
  },
};

const rangeReentryScenarios: StrategyScenario[] = [
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
      pullbackPct: 0.009,
      trailingStopAfterProfitPct: 0.009,
      emergencyStopPct: 0.032,
    },
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
      emergencyStopPct: 0.05,
    },
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
      emergencyStopPct: 0.035,
    },
  },
  {
    ...rangeReentryScenario,
    id: "range-reentry-trend-ride",
    name: "Trend-ride re-entry",
    params: {
      ...rangeReentryScenario.params,
      rsiMaxEntry: 48,
      bandWidthMax: 0.09,
      pullbackPct: 0.008,
      maxTrendSlopePct: 0.008,
      profitTargetPct: 0.025,
      reentryDropPct: 0.025,
      trailingStopAfterProfitPct: 0.02,
      emergencyStopPct: 0.045,
    },
  },
];

export const rangeReentryStrategy: Strategy = {
  id: "general-d",
  name: "General-D Range Re-entry",
  description:
    "General-B 기반으로 박스권 재진입을 노리고, +2.5% 이익 구간 이후 추세는 트레일링으로 따라가며 하락 추세 진입은 차단합니다.",
  defaultScenario: rangeReentryScenario,
  scenarios: rangeReentryScenarios,
  decide(context: StrategyContext, scenario = rangeReentryScenario): StrategyDecision {
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
    const uptrendPullbackEntry =
      uptrend &&
      current.close <= fast * (1 - scenario.params.pullbackPct) &&
      currentRsi <= Math.max(scenario.params.rsiMaxEntry, 52);

    if (rangeEntry || uptrendPullbackEntry) {
      return {
        action: "buy",
        confidence: rangeEntry ? 0.66 : 0.6,
        reasonCodes: rangeEntry
          ? ["box-regime", "lower-band-touch", "rsi-oversold", "reentry-allowed"]
          : ["uptrend-pullback", "ema-pullback", "reentry-allowed"],
        targetWeight: 0.65,
      };
    }

    return hold("no-reentry-setup");
  },
};

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

function sell(reasonCodes: string[]): StrategyDecision {
  return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 };
}

type RangeReentryIndicators = {
  bands: ReturnType<typeof bollinger>;
  fast: Array<number | null>;
  rsiValues: Array<number | null>;
  slow: Array<number | null>;
};

const rangeReentryIndicatorCache = new WeakMap<Candle[], Map<string, RangeReentryIndicators>>();

function getRangeReentryIndicators(candles: Candle[], scenario: StrategyScenario): RangeReentryIndicators {
  let scenarioCache = rangeReentryIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = new Map();
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
    slow: ema(closes, scenario.params.slowEma),
  };
  scenarioCache.set(key, indicators);
  return indicators;
}

function getMutableCandleCacheKey(candles: Candle[], scenario: StrategyScenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}
