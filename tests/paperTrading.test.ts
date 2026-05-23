import { describe, expect, it } from "vitest";
import { PaperTradingSession, runPaperTradingSimulation } from "../src/simulation/paperTrading";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import type { Candle, Strategy } from "../src/types/trading";

const strategy: Strategy = {
  id: "momentum",
  name: "Paper Test",
  description: "Synthetic paper strategy",
  defaultScenario: {
    id: "base",
    traderId: "momentum",
    name: "Base",
    description: "Synthetic",
    params: {},
  },
  decide(context) {
    if (!context.position && context.candleIndex === 5) {
      return {
        action: "buy",
        confidence: 0.9,
        reasonCodes: ["test-buy"],
        targetWeight: 1,
      };
    }
    if (context.position && context.candleIndex === 12) {
      return {
        action: "sell",
        confidence: 0.9,
        reasonCodes: ["test-sell"],
        targetWeight: 0,
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

describe("paper trading simulation", () => {
  it("runs a one-position paper loop from a persisted optimization plan shape", () => {
    const candles = createCandles("KRW-TEST", 20);
    const result = runPaperTradingSimulation(strategy, createPlan(), { "KRW-TEST": candles }, { guideRuleMode: "ignored" });

    expect(result.trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
    expect(result.decisions.some((decision) => decision.action === "buy")).toBe(true);
    expect(result.blockedSignals).toEqual([]);
    expect(result.finalValue).toBeGreaterThan(0);
  });

  it("records guideline and safety blocked buy signals", () => {
    const guideBlocked = runPaperTradingSimulation(
      strategy,
      createPlan(),
      { "KRW-TEST": createCandles("KRW-TEST", 20, -1) },
      { guideRuleMode: "strict" },
    );
    expect(guideBlocked.blockedSignals.some((signal) => signal.reason === "guide-rule")).toBe(true);

    const safetyBlocked = runPaperTradingSimulation(
      strategy,
      createPlan({ maxDrawdown: 0.2 }),
      { "KRW-TEST": createCandles("KRW-TEST", 20) },
      { autoBlockMode: "enabled", guideRuleMode: "ignored" },
    );
    expect(safetyBlocked.blockedSignals.some((signal) => signal.reason === "safety")).toBe(true);
    expect(safetyBlocked.safetyBlockedSignals).toBeGreaterThan(0);
  });

  it("does not re-enter the same market on the candle that triggered a hard stop", () => {
    const stopStrategy: Strategy = {
      ...strategy,
      defaultScenario: {
        ...strategy.defaultScenario,
        params: { stopLossPct: 0.05 },
      },
      decide(context) {
        if (!context.position && context.candleIndex >= 5) {
          return {
            action: "buy",
            confidence: 0.9,
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
    const candles = createCandles("KRW-TEST", 9);
    candles[6] = {
      ...candles[6],
      low: 90,
      close: 101,
    };

    const result = runPaperTradingSimulation(
      stopStrategy,
      createPlan(),
      { "KRW-TEST": candles },
      { guideRuleMode: "ignored" },
    );

    const stopTimestamp = candles[6].timestamp;
    const stopCandleTrades = result.trades.filter((trade) => trade.timestamp === stopTimestamp);
    expect(stopCandleTrades.map((trade) => trade.side)).toEqual(["sell"]);
    expect(stopCandleTrades[0].reasonCodes).toContain("risk-rule-exit");
  });

  it("applies take-profit risk exits in the paper loop", () => {
    const takeProfitStrategy: Strategy = {
      ...strategy,
      defaultScenario: {
        ...strategy.defaultScenario,
        params: { takeProfitPct: 0.05 },
      },
      decide(context) {
        if (!context.position && context.candleIndex === 5) {
          return {
            action: "buy",
            confidence: 0.9,
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
    const candles = createCandles("KRW-TEST", 9);
    candles[6] = {
      ...candles[6],
      high: candles[5].close * 1.08,
      close: candles[5].close * 1.07,
    };

    const result = runPaperTradingSimulation(
      takeProfitStrategy,
      createPlan(),
      { "KRW-TEST": candles },
      { guideRuleMode: "ignored" },
    );

    expect(result.trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
    expect(result.trades[1].reasonCodes).toContain("risk-rule-exit");
  });

  it("computes paper trailing stops from the previous high-water mark", () => {
    const trailingStrategy: Strategy = {
      ...strategy,
      defaultScenario: {
        ...strategy.defaultScenario,
        params: { trailingStopPct: 0.05 },
      },
      decide(context) {
        if (!context.position && context.candleIndex === 5) {
          return {
            action: "buy",
            confidence: 0.9,
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
    const candles = createCandles("KRW-TEST", 9);
    candles[6] = {
      ...candles[6],
      high: candles[5].close * 1.2,
      low: candles[5].close * 0.94,
      close: candles[5].close * 0.94,
    };

    const result = runPaperTradingSimulation(
      trailingStrategy,
      createPlan(),
      { "KRW-TEST": candles },
      { guideRuleMode: "ignored" },
    );

    expect(result.trades).toHaveLength(2);
    expect(result.trades[1].price).toBeCloseTo(result.trades[0].price * 0.95 * 0.9995, 6);
  });

  it("can risk-check a locked WS-O minute without evaluating new signals", () => {
    const wsStrategy: Strategy = {
      ...strategy,
      defaultScenario: {
        ...strategy.defaultScenario,
        params: { stopLossPct: 0.05 },
      },
      decide(context) {
        if (!context.position && context.candleIndex === 5) {
          return {
            action: "buy",
            confidence: 0.9,
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
    const candles = createCandles("KRW-TEST", 8);
    candles[6] = {
      ...candles[6],
      low: 90,
      close: 101,
    };
    const session = new PaperTradingSession(wsStrategy, createPlan(), { guideRuleMode: "ignored" });

    for (let index = 0; index <= 5; index += 1) {
      session.step(candles[index].timestamp, { "KRW-TEST": candles });
    }
    expect(session.result().trades.map((trade) => trade.side)).toEqual(["buy"]);

    session.step(candles[6].timestamp, { "KRW-TEST": candles }, { riskMarkets: new Set(["KRW-OTHER"]) });
    expect(session.result().trades.map((trade) => trade.side)).toEqual(["buy"]);

    session.step(candles[6].timestamp + 30_000, { "KRW-TEST": candles }, {
      riskMarkets: new Set(["KRW-TEST"]),
      signalMarkets: new Set(),
    });
    expect(session.result().trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
  });
});

function createPlan(overrides: Partial<TraderOptimizationPlan["selectedMarkets"][number]["bestResult"]> = {}): TraderOptimizationPlan {
  return {
    strategyId: "momentum",
    strategyName: "Paper Test",
    guideRuleMode: "ignored",
    candidateMarketCount: 1,
    monitoringMarketCount: 1,
    candidateMarkets: [{ market: "KRW-TEST", tradeValue: 1_000_000, candleCount: 20 }],
    optimizedMarkets: [],
    selectedMarkets: [
      {
        market: "KRW-TEST",
        candidateRank: 1,
        tradeValue: 1_000_000,
        score: 1,
        bestResult: {
          strategyId: "momentum",
          scenarioId: "base",
          scenarioName: "Base",
          market: "KRW-TEST",
          finalValue: 1_050_000,
          returnRate: 0.05,
          maxDrawdown: 0.01,
          winRate: 1,
          tradeCount: 2,
          profitFactor: 1,
          worstTradeReturn: 0,
          guideRuleMode: "ignored",
          guideRejectedSignals: 0,
          trades: [],
          signalAudit: [],
          equityCurve: [],
          ...overrides,
        },
      },
    ],
  };
}

function createCandles(market: string, count: number, direction = 1): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * direction;
    const close = open + direction;
    return {
      market,
      timestamp: Date.UTC(2026, 4, 12) + index * 60_000,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1000,
      quoteVolume: 1000 * close,
    };
  });
}
