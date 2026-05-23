import { describe, expect, it } from "vitest";
import { runBacktest } from "../src/simulation/backtest";
import type { Candle, Strategy } from "../src/types/trading";

const buyOnceStrategy: Strategy = {
  id: "momentum",
  name: "Buy Once",
  description: "Synthetic buy once strategy",
  defaultScenario: {
    id: "stop-loss-only",
    traderId: "momentum",
    name: "Stop loss only",
    description: "Uses stop loss without trailing stop",
    params: {
      stopLossPct: 0.05,
    },
  },
  decide(context) {
    if (!context.position && context.candleIndex === 0) {
      return {
        action: "buy",
        confidence: 1,
        reasonCodes: ["test-buy"],
        targetWeight: 1,
      };
    }

    return {
      action: "hold",
      confidence: 0,
      reasonCodes: ["wait"],
      targetWeight: 0,
    };
  },
};

describe("backtest risk exits", () => {
  it("does not use the highest price as a stop exit when trailing stop is disabled", () => {
    const result = runBacktest(buyOnceStrategy, buyOnceStrategy.defaultScenario, createCandles(), {
      initialCash: 1_000_000,
      feeRate: 0,
      slippageRate: 0,
      guideRuleMode: "ignored",
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[1].price).toBe(95);
    expect(result.returnRate).toBeCloseTo(-0.05, 6);
  });

  it("uses the conservative stop price when stop loss and take profit both trigger in one candle", () => {
    const scenario = {
      ...buyOnceStrategy.defaultScenario,
      params: {
        stopLossPct: 0.05,
        takeProfitPct: 0.05,
      },
    };
    const result = runBacktest(buyOnceStrategy, scenario, createCandles(), {
      initialCash: 1_000_000,
      feeRate: 0,
      slippageRate: 0,
      guideRuleMode: "ignored",
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[1].price).toBe(95);
    expect(result.returnRate).toBeCloseTo(-0.05, 6);
  });

  it("does not re-enter on the same candle after a risk exit", () => {
    const alwaysBuyAfterStart: Strategy = {
      ...buyOnceStrategy,
      decide(context) {
        if (!context.position) {
          return {
            action: "buy",
            confidence: 1,
            reasonCodes: ["test-buy"],
            targetWeight: 1,
          };
        }

        return {
          action: "hold",
          confidence: 0,
          reasonCodes: ["wait"],
          targetWeight: 0,
        };
      },
    };
    const result = runBacktest(alwaysBuyAfterStart, alwaysBuyAfterStart.defaultScenario, createCandles(), {
      initialCash: 1_000_000,
      feeRate: 0,
      slippageRate: 0,
      guideRuleMode: "ignored",
    });

    expect(result.trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
    expect(result.trades[1].timestamp).toBe(createCandles()[1].timestamp);
  });

  it("computes trailing stops from the previous high-water mark", () => {
    const scenario = {
      ...buyOnceStrategy.defaultScenario,
      params: {
        trailingStopPct: 0.05,
      },
    };
    const result = runBacktest(buyOnceStrategy, scenario, createCandles(), {
      initialCash: 1_000_000,
      feeRate: 0,
      slippageRate: 0,
      guideRuleMode: "ignored",
    });

    expect(result.trades).toHaveLength(2);
    expect(result.trades[1].price).toBe(95);
  });
});

function createCandles(): Candle[] {
  return [
    {
      market: "KRW-TEST",
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 100,
      quoteVolume: 10_000,
    },
    {
      market: "KRW-TEST",
      timestamp: 1_700_000_060_000,
      open: 100,
      high: 110,
      low: 94,
      close: 94,
      volume: 100,
      quoteVolume: 9_400,
    },
  ];
}
