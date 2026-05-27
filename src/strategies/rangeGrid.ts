import { bollinger, rsi } from "../indicators/technical";
import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

export const rangeGridScenario: StrategyScenario = {
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
    minProfitPct: 0.005,  // exit only when return >= 0.5% (time-based exit always fires)
  },
};

const rangeGridScenarios: StrategyScenario[] = [
  {
    ...rangeGridScenario,
    id: "range-grid-balanced",
    name: "Balanced range grid",
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
      maxHoldCandles: 24,
    },
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
      maxHoldCandles: 48,
    },
  },
];

export const rangeGridStrategy: Strategy = {
  id: "range-grid",
  name: "Range / Grid Mean Reversion",
  description: "횡보장에서는 과매도 구간을 사고 평균 회귀 시 청산합니다.",
  defaultScenario: rangeGridScenario,
  scenarios: rangeGridScenarios,
  decide(context: StrategyContext, scenario = rangeGridScenario): StrategyDecision {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const indicators = getRangeGridIndicators(candles, scenario);
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];

    if (band == null || currentRsi === null) return hold("warming-up");

    if (position) {
      const isTimeExit = position.holdCandles >= scenario.params.maxHoldCandles;
      const isMeanReversionExit = current.close >= band.middle;
      if (isTimeExit || isMeanReversionExit) {
        const minProfitPct = (scenario.params.minProfitPct as number | undefined) ?? 0;
        const returnPct = (current.close - position.averagePrice) / position.averagePrice;
        if (!isTimeExit && minProfitPct > 0 && returnPct < minProfitPct) {
          return hold("min-profit-wait");
        }
        return { action: "sell", confidence: 0.66, reasonCodes: ["mean-reversion-exit"], targetWeight: 0 };
      }
      return hold("range-position-running");
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
        maxHoldCandles: scenario.params.maxHoldCandles,
      };
    }

    return hold("no-range-entry");
  },
};

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

type RangeGridIndicators = {
  bands: ReturnType<typeof bollinger>;
  rsiValues: Array<number | null>;
};

const rangeGridIndicatorCache = new WeakMap<Candle[], Map<string, RangeGridIndicators>>();

function getRangeGridIndicators(candles: Candle[], scenario: StrategyScenario): RangeGridIndicators {
  let scenarioCache = rangeGridIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = new Map();
    rangeGridIndicatorCache.set(candles, scenarioCache);
  }

  const key = getMutableCandleCacheKey(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;

  const closes = candles.map((candle) => candle.close);
  const indicators = {
    bands: bollinger(closes, scenario.params.period, scenario.params.deviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
  };
  scenarioCache.set(key, indicators);
  return indicators;
}

function getMutableCandleCacheKey(candles: Candle[], scenario: StrategyScenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}
