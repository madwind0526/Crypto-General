import { bollinger, ema, rsi } from "../indicators/technical";
import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";
import { arbitrageScenario, arbitrageStrategy } from "./arbitrage";
import { averageDropCycleScenario, averageDropCycleStrategy } from "./averageDropCycle";
import { momentumScenario, momentumStrategy } from "./momentum";
import { rangeGridScenario, rangeGridStrategy } from "./rangeGrid";

type Regime = "uptrend" | "downtrend" | "sideways" | "oversold" | "mean-reversion";

export const generalSumScenario: StrategyScenario = {
  id: "general-sum-balanced",
  traderId: "general-sum",
  name: "Balanced regime router",
  description: "코인별 추세를 감지하고 상승(A)/횡보(B)/과매도(E)/평균회귀(C) 전략으로 자동 라우팅합니다.",
  params: {
    fastEma: 12,
    slowEma: 48,
    rsiPeriod: 14,
    bollPeriod: 20,
    bollDeviations: 2.0,
    trendSlopeLookback: 12,
    uptrendSlopePct: 0.008,
    downtrendSlopePct: 0.008,
    sidewaysBandWidthMax: 0.07,
    oversoldRsiMax: 35,
  },
};

const generalSumScenarios: StrategyScenario[] = [
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
      uptrendSlopePct: 0.005,
      downtrendSlopePct: 0.005,
      sidewaysBandWidthMax: 0.08,
      oversoldRsiMax: 38,
    },
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
      oversoldRsiMax: 30,
    },
  },
];

export const generalSumStrategy: Strategy = {
  id: "general-sum",
  name: "General-Sum Regime Router",
  description:
    "코인별로 현재 추세(상승/횡보/과매도/평균회귀/하락)를 감지하고 가장 적합한 전략(A~E)으로 자동 전환합니다. 코인 선택은 여러 전략에 중복 등장한 종목을 우선합니다.",
  defaultScenario: generalSumScenario,
  scenarios: generalSumScenarios,
  decide(context: StrategyContext, scenario = generalSumScenario): StrategyDecision {
    const { candles, candleIndex, position } = context;
    const params = scenario.params;
    const indicators = getSumIndicators(candles, scenario);

    const fast = indicators.fast[candleIndex];
    const slow = indicators.slow[candleIndex];
    const slowPrev = indicators.slow[Math.max(0, candleIndex - params.trendSlopeLookback)];
    const band = indicators.bands[candleIndex];
    const currentRsi = indicators.rsiValues[candleIndex];

    if (fast === null || slow === null || slowPrev === null || slowPrev === 0 || band === null || currentRsi === null) {
      return hold("warming-up");
    }

    const slowSlope = (slow - slowPrev) / slowPrev;
    const regime = detectRegime(fast, slow, slowSlope, band.widthPct, currentRsi, params);

    if (regime === "downtrend") {
      if (position) {
        return { action: "sell", confidence: 0.72, reasonCodes: ["sum-downtrend-exit"], targetWeight: 0 };
      }
      return hold("sum-downtrend-blocked");
    }

    const sub = getSubStrategyForRegime(regime);
    const decision = sub.strategy.decide(context, sub.scenario);
    return {
      ...decision,
      reasonCodes: [...decision.reasonCodes, `sum-regime:${regime}`],
    };
  },
};

function detectRegime(
  fast: number,
  slow: number,
  slowSlope: number,
  bandWidthPct: number,
  currentRsi: number,
  params: Record<string, number>,
): Regime {
  const { uptrendSlopePct, downtrendSlopePct, sidewaysBandWidthMax, oversoldRsiMax } = params;
  if (currentRsi <= oversoldRsiMax) return "oversold";
  if (fast > slow && slowSlope >= uptrendSlopePct) return "uptrend";
  if (fast < slow && slowSlope <= -downtrendSlopePct) return "downtrend";
  if (bandWidthPct <= sidewaysBandWidthMax && Math.abs(slowSlope) < uptrendSlopePct) return "sideways";
  return "mean-reversion";
}

function getSubStrategyForRegime(regime: Regime): { strategy: Strategy; scenario: StrategyScenario } {
  switch (regime) {
    case "uptrend":
      return { strategy: momentumStrategy, scenario: momentumScenario };
    case "sideways":
      return { strategy: rangeGridStrategy, scenario: rangeGridScenario };
    case "oversold":
      return { strategy: averageDropCycleStrategy, scenario: averageDropCycleScenario };
    case "mean-reversion":
    default:
      return { strategy: arbitrageStrategy, scenario: arbitrageScenario };
  }
}

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

type SumIndicators = {
  fast: Array<number | null>;
  slow: Array<number | null>;
  bands: ReturnType<typeof bollinger>;
  rsiValues: Array<number | null>;
};

const sumIndicatorCache = new WeakMap<Candle[], Map<string, SumIndicators>>();

function getSumIndicators(candles: Candle[], scenario: StrategyScenario): SumIndicators {
  let scenarioCache = sumIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = new Map();
    sumIndicatorCache.set(candles, scenarioCache);
  }

  const key = `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
  const cached = scenarioCache.get(key);
  if (cached) return cached;

  const closes = candles.map((c) => c.close);
  const indicators: SumIndicators = {
    fast: ema(closes, scenario.params.fastEma),
    slow: ema(closes, scenario.params.slowEma),
    bands: bollinger(closes, scenario.params.bollPeriod, scenario.params.bollDeviations),
    rsiValues: rsi(closes, scenario.params.rsiPeriod),
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
