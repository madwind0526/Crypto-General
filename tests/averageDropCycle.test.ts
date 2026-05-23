import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/simulation/backtest";
import { averageDropCycleScenarios, averageDropCycleStrategy } from "../src/strategies/averageDropCycle";
import type { Candle } from "../src/types/trading";

function candle(close: number, index: number): Candle {
  return {
    market: "KRW-TEST",
    timestamp: index * 60_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 10,
    quoteVolume: close * 10,
  };
}

describe("averageDropCycleStrategy", () => {
  it("builds the requested minute/percent parameter split", () => {
    expect(averageDropCycleScenarios).toHaveLength(4 * 5 * 6 * 5);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.averageWindowCandles === 5)).toBe(true);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.averageWindowCandles === 10)).toBe(true);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.averageWindowCandles === 60)).toBe(true);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.averageWindowCandles === 3)).toBe(false);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.averageWindowCandles === 2)).toBe(false);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.entryDropPct === 0.05)).toBe(true);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.avgStopPct === 0)).toBe(true);
    expect(averageDropCycleScenarios.some((scenario) => scenario.params.avgTakeProfitPct === 0.05)).toBe(true);
  });

  it("buys after a drop from average and sells after price rebounds above average", () => {
    const scenario = averageDropCycleScenarios.find(
      (item) =>
        item.params.averageWindowCandles === 5 &&
        item.params.entryDropPct === 0.01 &&
        item.params.avgStopPct === 0.05 &&
        item.params.avgTakeProfitPct === 0.01,
    );
    expect(scenario).toBeDefined();

    const candles = [100, 100, 100, 100, 100, 96, 96, 101, 102].map(candle);
    const result = runBacktest(averageDropCycleStrategy, scenario!, candles, {
      initialCash: 1_000_000,
      feeRate: 0,
      slippageRate: 0,
      guideRuleMode: "ignored",
    });

    expect(result.trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
    expect(result.trades[0].price).toBe(96);
    expect(result.trades[1].reasonCodes).toContain("price-above-average-take-profit");
  });
});
