import { describe, expect, it } from "vitest";
import { runPaperTradingSimulation } from "../src/simulation/paperTrading";
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
