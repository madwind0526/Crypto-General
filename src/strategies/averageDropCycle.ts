import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

export const averageDropCycleScenario: StrategyScenario = {
  id: "average-drop-cycle-5m-entry-0.5-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / entry-0.5% / stop-2.0% / take-0.5%",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0.005,
    avgStopPct: 0.020,
    avgTakeProfitPct: 0.005,
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
  const averageWindows = [5, 10, 30, 60];
  // Narrowed ranges: 0.5–2% in 0.5% steps
  const halfPctSteps = [0.5, 1.0, 1.5, 2.0];

  for (const averageWindowCandles of averageWindows) {
    for (const entryDrop of halfPctSteps) {
      for (const avgStop of halfPctSteps) {
        for (const avgTake of halfPctSteps) {
          const e = entryDrop.toFixed(1);
          const s = avgStop.toFixed(1);
          const t = avgTake.toFixed(1);
          scenarios.push({
            id: `average-drop-cycle-${averageWindowCandles}m-entry-${e}-stop-${s}-take-${t}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / entry-${e}% / stop-${s}% / take-${t}%`,
            description:
              "Parameter split for General-E using 0.5–2% narrowed ranges in 0.5% steps.",
            params: {
              averageWindowCandles,
              entryDropPct: entryDrop / 100,
              avgStopPct: avgStop / 100,
              avgTakeProfitPct: avgTake / 100,
            },
          });
        }
      }
    }
  }

  return scenarios;
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
    if (index < window) {
      averages.push(null);
    } else {
      // intentional: average is computed BEFORE adding the current candle,
      // so averages[index] reflects the prior window [index-window, index-1].
      // this lets the stop-loss detect a sharp drop vs. the pre-drop average
      // without the current candle's falling price diluting that average.
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

function hold(reason: string): StrategyDecision {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
