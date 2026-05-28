import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../types/trading";

export const averageDropCycleScenario: StrategyScenario = {
  id: "average-drop-cycle-5m-entry-0.5-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / entry-0.5% / stop-2.0% / take-0.5%",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0.005,
    entryRisePct: 0,
    avgStopPct: 0.020,
    avgTakeProfitPct: 0.005,
  },
};

// Rise mode: buy when price breaks ABOVE VWAP by entryRisePct (momentum/breakout entry).
// Exit uses entry-price-based stop/take-profit (not VWAP) to avoid immediate re-exit.
export const averageRiseCycleScenario: StrategyScenario = {
  id: "average-rise-cycle-5m-entry-0.2-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / rise-entry-0.2% / stop-2.0% / take-0.5%",
  description: "Buy a breakout above VWAP, exit when price drops from entry (stop) or rises further (take-profit).",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 0,
    entryRisePct: 0.002,
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

    const entryRisePct = (scenario.params.entryRisePct as number | undefined) ?? 0;
    const entryDropPct = scenario.params.entryDropPct as number;
    const isRiseMode = entryRisePct > 0;

    if (position) {
      if (isRiseMode) {
        // Rise mode: stop/take-profit relative to entry price (not VWAP)
        // — avoids immediate re-exit since we entered above VWAP
        if (current.close <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["rise-stop-loss"], targetWeight: 0 };
        }
        if (current.close >= position.averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["rise-take-profit"], targetWeight: 0 };
        }
      } else {
        // Drop mode: VWAP-based stop/take-profit (original logic)
        if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["average-below-entry-stop"], targetWeight: 0 };
        }
        if (current.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["price-above-average-take-profit"], targetWeight: 0 };
        }
      }
      return hold("average-cycle-position-running");
    }

    // Rise entry: price broke above VWAP (momentum/breakout)
    if (isRiseMode && current.close >= averagePrice * (1 + entryRisePct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryRisePct * 5),
        reasonCodes: ["price-above-average-entry"],
        targetWeight: 0.65,
      };
    }

    // Drop entry: price fell below VWAP
    if (!isRiseMode && entryDropPct > 0 && current.close <= averagePrice * (1 - entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65,
      };
    }

    return hold("waiting-average-signal");
  },
};

function buildAverageDropCycleScenarios() {
  const scenarios: StrategyScenario[] = [];
  const averageWindows = [5, 10, 30, 60];                          // 4
  const entryPcts   = [0.01, 0.02, 0.03, 0.04, 0.05];             // 5 (1–5%)
  const stopPcts    = [0, 0.01, 0.02, 0.03, 0.04, 0.05];          // 6 (0–5%, 0=disabled)
  const takePcts    = [0.01, 0.02, 0.03, 0.04, 0.05];             // 5 (1–5%)
  // Total: 4 × 5 × 6 × 5 = 600 scenarios

  for (const averageWindowCandles of averageWindows) {
    for (const entryDropPct of entryPcts) {
      for (const avgStopPct of stopPcts) {
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
              avgTakeProfitPct,
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
