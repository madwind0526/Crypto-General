import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

export const averageDropCycleScenario: StrategyScenario = {
  id: "average-drop-cycle-5m-3-5-3",
  traderId: "general-e",
  name: "5m avg drop cycle",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0.03,
    avgStopPct: 0.05,
    avgTakeProfitPct: 0.03,
  },
};

export const averageDropCycleScenarios: StrategyScenario[] = buildAverageDropCycleScenarios();

export const averageDropCycleStrategy: Strategy = {
  id: "general-e",
  name: "General-E Average Drop Cycle",
  description:
    "최근 평균 거래가격 대비 급락 구간에서 매수하고, 보유 중에는 평균가격 기반 손절/익절 조건으로 반복 매매하는 전략입니다.",
  defaultScenario: averageDropCycleScenario,
  scenarios: averageDropCycleScenarios,
  decide(context: StrategyContext, scenario = averageDropCycleScenario): StrategyDecision {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const averagePrice = getAverageTradePrice(candles, candleIndex, scenario.params.averageWindowCandles);
    if (averagePrice === null || averagePrice <= 0) return hold("warming-up");

    if (position) {
      if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
        return {
          action: "sell",
          confidence: 0.76,
          reasonCodes: ["average-below-entry-stop"],
          targetWeight: 0,
        };
      }

      if (current.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
        return {
          action: "sell",
          confidence: 0.72,
          reasonCodes: ["price-above-average-take-profit"],
          targetWeight: 0,
        };
      }

      return hold("average-cycle-position-running");
    }

    if (current.close <= averagePrice * (1 - scenario.params.entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + scenario.params.entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65,
      };
    }

    return hold("waiting-average-drop");
  },
};

function buildAverageDropCycleScenarios() {
  const scenarios: StrategyScenario[] = [];
  const averageWindows = [1, 3, 5, 10];

  for (const averageWindowCandles of averageWindows) {
    for (let entryDropPct = 1; entryDropPct <= 5; entryDropPct += 1) {
      for (let avgStopPct = 0; avgStopPct <= 5; avgStopPct += 1) {
        for (let avgTakeProfitPct = 1; avgTakeProfitPct <= 5; avgTakeProfitPct += 1) {
          scenarios.push({
            id: `average-drop-cycle-${averageWindowCandles}m-entry-${entryDropPct}-stop-${avgStopPct}-take-${avgTakeProfitPct}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m avg / ${formatDropThreshold(entryDropPct, 5)} entry / ${formatDropThreshold(
              avgStopPct,
              5,
            )} stop / ${formatRiseThreshold(avgTakeProfitPct, 5)} take`,
            description:
              "Parameter split for General-E average drop cycle using selected minute windows and one-percent threshold steps.",
            params: {
              averageWindowCandles,
              entryDropPct: entryDropPct / 100,
              avgStopPct: avgStopPct / 100,
              avgTakeProfitPct: avgTakeProfitPct / 100,
            },
          });
        }
      }
    }
  }

  return scenarios;
}

function formatDropThreshold(value: number, maxValue: number) {
  return value >= maxValue ? `<= -${value}%` : `-${value}%`;
}

function formatRiseThreshold(value: number, maxValue: number) {
  return value >= maxValue ? `>= +${value}%` : `+${value}%`;
}

function getAverageTradePrice(candles: Candle[], candleIndex: number, windowCandles: number) {
  return getAverageTradePrices(candles, windowCandles)[candleIndex] ?? null;
}

const averagePriceCache = new WeakMap<Candle[], Map<string, Array<number | null>>>();

function getAverageTradePrices(candles: Candle[], windowCandles: number) {
  let byWindow = averagePriceCache.get(candles);
  if (!byWindow) {
    byWindow = new Map();
    averagePriceCache.set(candles, byWindow);
  }

  const window = Math.max(1, windowCandles);
  const key = `${window}:${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;

  const averages: Array<number | null> = [];
  let volumeSum = 0;
  let quoteVolumeSum = 0;
  let closeSum = 0;

  for (let index = 0; index < candles.length; index += 1) {
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

    if (index + 1 < window) {
      averages.push(null);
      continue;
    }

    averages.push(volumeSum > 0 && quoteVolumeSum > 0 ? quoteVolumeSum / volumeSum : closeSum / window);
  }

  byWindow.set(key, averages);
  return averages;
}

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
