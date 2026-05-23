import { describe, expect, it } from "vitest";
import { planToComparisonByPureReturn } from "../src/simulation/dashboardResults";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";

describe("dashboard result helpers", () => {
  it("returns null for empty selected market plans", () => {
    expect(planToComparisonByPureReturn(createPlan([]))).toBeNull();
  });

  it("chooses the best selected market by pure return", () => {
    const comparison = planToComparisonByPureReturn(
      createPlan([
        createSelectedMarket("KRW-LOW", 0.01),
        createSelectedMarket("KRW-HIGH", 0.08),
      ]),
    );

    expect(comparison?.bestResult.market).toBe("KRW-HIGH");
  });
});

function createPlan(selectedMarkets: TraderOptimizationPlan["selectedMarkets"]): TraderOptimizationPlan {
  return {
    strategyId: "momentum",
    strategyName: "Test Strategy",
    guideRuleMode: "ignored",
    candidateMarketCount: 30,
    monitoringMarketCount: 9,
    candidateMarkets: [],
    optimizedMarkets: selectedMarkets,
    selectedMarkets,
  };
}

function createSelectedMarket(market: string, returnRate: number): TraderOptimizationPlan["selectedMarkets"][number] {
  return {
    market,
    candidateRank: 1,
    tradeValue: 1_000,
    score: 0,
    bestResult: {
      strategyId: "momentum",
      scenarioId: "test",
      scenarioName: "Test",
      scenarioParams: {},
      market,
      finalValue: 1_000_000 * (1 + returnRate),
      returnRate,
      maxDrawdown: 0,
      winRate: 0,
      tradeCount: 0,
      profitFactor: 0,
      worstTradeReturn: 0,
      guideRuleMode: "ignored",
      guideRejectedSignals: 0,
      trades: [],
      signalAudit: [],
      equityCurve: [],
    },
  };
}
