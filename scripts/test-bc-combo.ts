import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig } from "../src/simulation/backtest";
import { runPaperTradingSimulation, type PaperTradingResult } from "../src/simulation/paperTrading";
import type { MarketScenarioOptimization, TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { arbitrageStrategy } from "../src/strategies/arbitrage";
import { rangeGridStrategy } from "../src/strategies/rangeGrid";
import type { Candle, GuideRuleMode, SafetyMode, Strategy, StrategyScenario, Trade } from "../src/types/trading";

interface MarketCachePayload {
  candleUnitMinutes?: number;
  generatedAt?: string;
  candlesByMarket: Record<string, Candle[]>;
}

interface PlanPayload {
  plan: TraderOptimizationPlan;
}

interface Row {
  mode: string;
  guideRuleMode: GuideRuleMode;
  autoBlockMode: SafetyMode;
  finalValue: number;
  returnRate: number;
  trades: number;
  buys: number;
  sells: number;
  avgRoundTripReturn: number | null;
  winRate: number | null;
  selectedMarkets?: string;
}

const root = process.cwd();
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const marketCache = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const guideModes: GuideRuleMode[] = ["ignored", "strict"];
const safetyModes: SafetyMode[] = ["disabled", "enabled"];
const maxCandles = Number(process.env.PAPER_MAX_CANDLES ?? 2000);
const startAt = parseKstStartAt(process.env.PAPER_START_AT_KST ?? process.env.PAPER_START_AT);
const rows: Row[] = [];

for (const guideRuleMode of guideModes) {
  const bPlan = await loadPlan("range-grid", guideRuleMode);
  const cPlan = await loadPlan("arbitrage", guideRuleMode);

  for (const autoBlockMode of safetyModes) {
    const bOnly = run(rangeGridStrategy, bPlan, guideRuleMode, autoBlockMode, 1_000_000);
    const cOnly = run(arbitrageStrategy, cPlan, guideRuleMode, autoBlockMode, 1_000_000);
    const bHalf = run(rangeGridStrategy, bPlan, guideRuleMode, autoBlockMode, 500_000);
    const cHalf = run(arbitrageStrategy, cPlan, guideRuleMode, autoBlockMode, 500_000);

    rows.push(toRow("B only", bOnly));
    rows.push(toRow("C only", cOnly));
    rows.push(combineIndependent("B 50% + C 50%", bHalf, cHalf, guideRuleMode, autoBlockMode));

    const top9Plan = buildMergedPlan(bPlan, cPlan, 9);
    const top18Plan = buildMergedPlan(bPlan, cPlan, 18);
    const comboStrategy = buildCombinedStrategy();
    rows.push(toRow("B/C signals top9", run(comboStrategy, top9Plan, guideRuleMode, autoBlockMode, 1_000_000), top9Plan));
    rows.push(toRow("B/C signals top18", run(comboStrategy, top18Plan, guideRuleMode, autoBlockMode, 1_000_000), top18Plan));
  }
}

console.log(`Market cache: ${path.relative(root, marketCachePath)} (${marketCache.generatedAt ?? "unknown"})`);
console.log(`maxCandles=${maxCandles}, startAt=${startAt ? new Date(startAt).toISOString() : "auto"}`);
console.log("");
console.log("Live-like case: Guideline X / Safety X");
console.table(
  rows
    .filter((row) => row.guideRuleMode === "ignored" && row.autoBlockMode === "disabled")
    .map(formatRow),
);
console.log("");
console.log("All daily cases");
console.table(rows.map(formatRow));

async function loadPlan(strategyId: "range-grid" | "arbitrage", guideRuleMode: GuideRuleMode) {
  const planPath = path.join(root, "data", "local", "traders", strategyId, "scenarios", `optimization-${guideRuleMode}.json`);
  const payload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
  return payload.plan;
}

function run(
  strategy: Strategy,
  plan: TraderOptimizationPlan,
  guideRuleMode: GuideRuleMode,
  autoBlockMode: SafetyMode,
  initialCash: number,
) {
  return runPaperTradingSimulation(strategy, plan, marketCache.candlesByMarket, {
    autoBlockMode,
    guideRuleMode,
    maxCandles,
    startAt,
    config: {
      ...defaultBacktestConfig,
      initialCash,
    },
  });
}

function combineIndependent(
  mode: string,
  left: PaperTradingResult,
  right: PaperTradingResult,
  guideRuleMode: GuideRuleMode,
  autoBlockMode: SafetyMode,
): Row {
  const trades = [...left.trades, ...right.trades].sort((a, b) => a.timestamp - b.timestamp);
  const roundTrips = [...getRoundTripReturns(left.trades), ...getRoundTripReturns(right.trades)];
  const finalValue = left.finalValue + right.finalValue;
  return {
    mode,
    guideRuleMode,
    autoBlockMode,
    finalValue,
    returnRate: (finalValue - 1_000_000) / 1_000_000,
    trades: trades.length,
    buys: trades.filter((trade) => trade.side === "buy").length,
    sells: trades.filter((trade) => trade.side === "sell").length,
    avgRoundTripReturn: roundTrips.length > 0 ? average(roundTrips) : null,
    winRate: roundTrips.length > 0 ? roundTrips.filter((value) => value > 0).length / roundTrips.length : null,
  };
}

function buildCombinedStrategy(): Strategy {
  const scenarios = [
    ...rangeGridStrategy.scenarios.map((scenario) => prefixScenario("B", scenario)),
    ...arbitrageStrategy.scenarios.map((scenario) => prefixScenario("C", scenario)),
  ];
  return {
    id: "general-sum",
    name: "B/C Combined Signal Router",
    description: "Temporary experiment that delegates each selected market to its source B or C scenario.",
    defaultScenario: scenarios[0],
    scenarios,
    decide(context, scenario) {
      if (scenario.id.startsWith("B:")) {
        return rangeGridStrategy.decide(context, stripScenarioPrefix(scenario));
      }
      return arbitrageStrategy.decide(context, stripScenarioPrefix(scenario));
    },
  };
}

function buildMergedPlan(bPlan: TraderOptimizationPlan, cPlan: TraderOptimizationPlan, monitoringMarketCount: number): TraderOptimizationPlan {
  const merged = new Map<string, MarketScenarioOptimization>();
  for (const item of [
    ...bPlan.selectedMarkets.map((selected) => prefixSelected("B", selected)),
    ...cPlan.selectedMarkets.map((selected) => prefixSelected("C", selected)),
  ]) {
    const current = merged.get(item.market);
    if (!current || item.bestResult.returnRate > current.bestResult.returnRate) {
      merged.set(item.market, item);
    }
  }

  const selectedMarkets = [...merged.values()]
    .sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate)
    .slice(0, monitoringMarketCount);

  return {
    strategyId: "general-sum",
    strategyName: `B/C merged top${monitoringMarketCount}`,
    guideRuleMode: bPlan.guideRuleMode,
    candidateMarketCount: bPlan.candidateMarketCount + cPlan.candidateMarketCount,
    monitoringMarketCount,
    candidateMarkets: [...bPlan.candidateMarkets, ...cPlan.candidateMarkets],
    optimizedMarkets: selectedMarkets,
    selectedMarkets,
  };
}

function prefixSelected(prefix: "B" | "C", selected: MarketScenarioOptimization): MarketScenarioOptimization {
  return {
    ...selected,
    bestResult: {
      ...selected.bestResult,
      strategyId: "general-sum",
      scenarioId: `${prefix}:${selected.bestResult.scenarioId}`,
      scenarioName: `${prefix}:${selected.bestResult.scenarioName ?? selected.bestResult.scenarioId}`,
    },
  };
}

function prefixScenario(prefix: "B" | "C", scenario: StrategyScenario): StrategyScenario {
  return {
    ...scenario,
    id: `${prefix}:${scenario.id}`,
    traderId: "general-sum",
    name: `${prefix}:${scenario.name}`,
  };
}

function stripScenarioPrefix(scenario: StrategyScenario): StrategyScenario {
  const [, id = scenario.id] = scenario.id.split(":");
  return {
    ...scenario,
    id,
    traderId: scenario.id.startsWith("B:") ? "range-grid" : "arbitrage",
  };
}

function toRow(mode: string, result: PaperTradingResult, plan?: TraderOptimizationPlan): Row {
  const roundTrips = getRoundTripReturns(result.trades);
  return {
    mode,
    guideRuleMode: result.guideRuleMode,
    autoBlockMode: result.autoBlockMode,
    finalValue: result.finalValue,
    returnRate: result.returnRate,
    trades: result.trades.length,
    buys: result.trades.filter((trade) => trade.side === "buy").length,
    sells: result.trades.filter((trade) => trade.side === "sell").length,
    avgRoundTripReturn: roundTrips.length > 0 ? average(roundTrips) : null,
    winRate: roundTrips.length > 0 ? roundTrips.filter((value) => value > 0).length / roundTrips.length : null,
    selectedMarkets: plan?.selectedMarkets.map((item) => `${item.market.replace("KRW-", "")}:${item.bestResult.scenarioId[0]}`).join(", "),
  };
}

function getRoundTripReturns(trades: Trade[]) {
  const returns: number[] = [];
  let buy: Trade | null = null;
  for (const trade of trades) {
    if (trade.side === "buy") buy = trade;
    else if (buy) {
      returns.push((trade.price - buy.price) / buy.price);
      buy = null;
    }
  }
  return returns;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatRow(row: Row) {
  return {
    mode: row.mode,
    guide: row.guideRuleMode === "ignored" ? "X" : "O",
    safety: row.autoBlockMode === "disabled" ? "X" : "O",
    final: Math.round(row.finalValue).toLocaleString("ko-KR"),
    return: `${(row.returnRate * 100).toFixed(2)}%`,
    trades: row.trades,
    buys: row.buys,
    sells: row.sells,
    avgRoundTrip: row.avgRoundTripReturn === null ? "-" : `${(row.avgRoundTripReturn * 100).toFixed(2)}%`,
    winRate: row.winRate === null ? "-" : `${(row.winRate * 100).toFixed(1)}%`,
    selected: row.selectedMarkets ?? "",
  };
}

function parseKstStartAt(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+09:00`;
  const timestamp = Date.parse(withZone);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid PAPER_START_AT value: ${value}`);
  return timestamp;
}
