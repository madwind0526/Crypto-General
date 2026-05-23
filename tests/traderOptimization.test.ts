import { describe, expect, it } from "vitest";
import {
  buildTraderOptimizationPlan,
  compareOptimizationsByPureReturn,
  selectTopMarketsByTradeValue,
} from "../src/simulation/traderOptimization";
import type { MarketScenarioOptimization } from "../src/simulation/traderOptimization";
import type { Candle, Strategy } from "../src/types/trading";

const testStrategy: Strategy = {
  id: "momentum",
  name: "Scenario Optimizer Test",
  description: "Synthetic test strategy",
  defaultScenario: {
    id: "hold",
    traderId: "momentum",
    name: "Hold",
    description: "No trade",
    params: { targetWeight: 0 },
  },
  scenarios: [
    {
      id: "hold",
      traderId: "momentum",
      name: "Hold",
      description: "No trade",
      params: { targetWeight: 0 },
    },
    {
      id: "active",
      traderId: "momentum",
      name: "Active",
      description: "Buy once",
      params: { targetWeight: 1 },
    },
  ],
  decide(context, scenario) {
    if (scenario.params.targetWeight > 0 && !context.position && context.candleIndex === 20) {
      return {
        action: "buy",
        confidence: 0.8,
        reasonCodes: ["synthetic-entry"],
        targetWeight: scenario.params.targetWeight,
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

describe("trader optimization", () => {
  it("selects top markets by recent quote trade value", () => {
    const selected = selectTopMarketsByTradeValue(
      {
        "KRW-LOW": createCandles("KRW-LOW", 140, 100, 0.001, 1_000),
        "KRW-HIGH": createCandles("KRW-HIGH", 140, 100, 0.001, 9_000),
        "KRW-MID": createCandles("KRW-MID", 140, 100, 0.001, 4_000),
      },
      2,
      40,
      100,
    );

    expect(selected.map((market) => market.market)).toEqual(["KRW-HIGH", "KRW-MID"]);
  });

  it("optimizes each candidate market and selects monitoring markets by return", () => {
    const plan = buildTraderOptimizationPlan(
      testStrategy,
      {
        "KRW-UP": createCandles("KRW-UP", 160, 100, 0.004, 8_000),
        "KRW-MID": createCandles("KRW-MID", 160, 100, 0.002, 7_000),
        "KRW-DOWN": createCandles("KRW-DOWN", 160, 100, -0.003, 9_000),
      },
      {
        candidateMarketCount: 3,
        monitoringMarketCount: 2,
        guideRuleMode: "ignored",
        minCandles: 100,
        tradeValueLookbackCandles: 80,
      },
    );

    expect(plan.candidateMarkets).toHaveLength(3);
    expect(plan.optimizedMarkets).toHaveLength(3);
    expect(plan.selectedMarkets).toHaveLength(2);
    expect(plan.selectedMarkets[0].market).toBe("KRW-UP");
    expect(plan.selectedMarkets.map((market) => market.bestResult.scenarioId)).toContain("active");
  });

  it("orders optimization rows by pure return before risk score", () => {
    const highReturnLowScore = createOptimizationRow("KRW-HIGH-RETURN", 0.1, -1);
    const lowerReturnHighScore = createOptimizationRow("KRW-HIGH-SCORE", 0.05, 10);

    expect([lowerReturnHighScore, highReturnLowScore].sort(compareOptimizationsByPureReturn)[0].market).toBe(
      "KRW-HIGH-RETURN",
    );
  });
});

function createOptimizationRow(market: string, returnRate: number, score: number): MarketScenarioOptimization {
  return {
    market,
    candidateRank: 1,
    tradeValue: 1_000,
    score,
    bestResult: {
      strategyId: "momentum",
      scenarioId: "test",
      scenarioName: "Test",
      scenarioParams: {},
      market,
      finalValue: 1_000_000 * (1 + returnRate),
      returnRate,
      maxDrawdown: 0.5,
      winRate: 0,
      tradeCount: 1,
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

function createCandles(
  market: string,
  count: number,
  startPrice: number,
  drift: number,
  baseVolume: number,
): Candle[] {
  let price = startPrice;
  const candles: Candle[] = [];

  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open * (1 + drift);
    candles.push({
      market,
      timestamp: Date.UTC(2026, 4, 1) + index * 5 * 60_000,
      open,
      high: Math.max(open, close) * 1.002,
      low: Math.min(open, close) * 0.998,
      close,
      volume: baseVolume,
      quoteVolume: baseVolume * close,
    });
    price = close;
  }

  return candles;
}
