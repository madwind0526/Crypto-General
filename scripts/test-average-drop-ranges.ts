import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig } from "../src/simulation/backtest";
import { runPaperTradingSimulation } from "../src/simulation/paperTrading";
import { buildTraderOptimizationPlan, type TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { averageDropCycleStrategy } from "../src/strategies/averageDropCycle";
import type { BacktestConfig, Candle, Strategy, StrategyScenario } from "../src/types/trading";

interface MarketCachePayload {
  generatedAt?: string;
  candlesByMarket: Record<string, Candle[]>;
}

interface GridDefinition {
  id: string;
  label: string;
  entryPcts: number[];
  stopPcts: number[];
  takePcts: number[];
}

function upbitTickSlippage(price: number): number {
  if (price < 10) return 0.01 / price;
  if (price < 100) return 0.1 / price;
  if (price < 500) return 1 / price;
  if (price < 1000) return 5 / price;
  if (price < 5000) return 10 / price;
  if (price < 10_000) return 50 / price;
  return 100 / price;
}

const root = process.cwd();
const cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
const outputPath = path.join(root, "data", "local", "experiments", "general-e-range-comparison.json");
const payload = JSON.parse(await readFile(cachePath, "utf8")) as MarketCachePayload;
const realisticConfig: BacktestConfig = {
  ...defaultBacktestConfig,
  slippageRate: 0,
  dynamicSlippage: upbitTickSlippage,
};

const grids: GridDefinition[] = [
  {
    id: "current",
    label: "Current: entry -1..-5 by 1, stop -1..-6 by 1, take +1..+5 by 1",
    entryPcts: [0.01, 0.02, 0.03, 0.04, 0.05],
    stopPcts: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06],
    takePcts: [0.01, 0.02, 0.03, 0.04, 0.05],
  },
  {
    id: "narrowed",
    label: "Narrowed: entry -1..-3 by 0.5, stop -1..-5 by 1, take +1..+3 by 0.5",
    entryPcts: [0.01, 0.015, 0.02, 0.025, 0.03],
    stopPcts: [0.01, 0.02, 0.03, 0.04, 0.05],
    takePcts: [0.01, 0.015, 0.02, 0.025, 0.03],
  },
];

const runs = grids.map((grid) => {
  const strategy = withGrid(grid);
  const plan = buildTraderOptimizationPlan(strategy, payload.candlesByMarket, {
    candidateMarketCount: 30,
    monitoringMarketCount: 15,
    tradeValueLookbackCandles: 1440,
    optimizationLookbackCandles: 10_080,
    minPrice: 100,
    maxPrice: 10_000,
    guideRuleMode: "ignored",
    config: realisticConfig,
  });
  const paper = runPaperTradingSimulation(strategy, plan, payload.candlesByMarket, {
    autoBlockMode: "disabled",
    guideRuleMode: "ignored",
    maxCandles: 10_080,
    startAt: null,
    config: realisticConfig,
  });
  return { grid, strategy, plan, paper };
});

const [current, narrowed] = runs;
const report = {
  generatedAt: new Date().toISOString(),
  cache: {
    path: path.relative(root, cachePath),
    generatedAt: payload.generatedAt,
  },
  mode: {
    guideRuleMode: "ignored",
    safetyMode: "disabled",
    candidateMarkets: 30,
    monitoringMarkets: 15,
    optimizationCandles: 10_080,
    constraint: "stopPct >= entryDropPct + 1 percentage point",
  },
  summaries: runs.map(summarizeRun),
  selectionChanges: {
    kept: intersect(markets(current.plan), markets(narrowed.plan)),
    removed: subtract(markets(current.plan), markets(narrowed.plan)),
    added: subtract(markets(narrowed.plan), markets(current.plan)),
  },
  selectedMarkets: runs.map(({ grid, plan }) => ({
    grid: grid.id,
    markets: plan.selectedMarkets.map(toMarketRow),
  })),
  unionComparison: buildUnionComparison(current.plan, narrowed.plan),
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Cache: ${path.relative(root, cachePath)} (${payload.generatedAt ?? "unknown"})`);
console.log(`Report: ${path.relative(root, outputPath)}`);
console.log("Mode: Guideline X / Safety X, realistic Upbit tick slippage, top-30 -> top-15");
console.log("Constraint: stopPct >= entryDropPct + 1 percentage point");
console.log("");
console.table(report.summaries.map(formatSummary));
console.log("");
console.log(`Kept (${report.selectionChanges.kept.length}): ${report.selectionChanges.kept.join(", ")}`);
console.log(`Removed (${report.selectionChanges.removed.length}): ${report.selectionChanges.removed.join(", ") || "-"}`);
console.log(`Added (${report.selectionChanges.added.length}): ${report.selectionChanges.added.join(", ") || "-"}`);
console.log("");
console.log("Narrowed top-15");
console.table(narrowed.plan.selectedMarkets.map((item) => ({
  market: item.market.replace("KRW-", ""),
  scenario: item.bestResult.scenarioName,
  return: fmtPct(item.bestResult.returnRate),
  maxDD: fmtPct(item.bestResult.maxDrawdown),
  trades: item.bestResult.tradeCount,
})));

function withGrid(grid: GridDefinition): Strategy {
  const scenarios = buildScenarios(grid);
  return {
    ...averageDropCycleStrategy,
    scenarios,
    defaultScenario: scenarios[0],
  };
}

function buildScenarios(grid: GridDefinition): StrategyScenario[] {
  const scenarios: StrategyScenario[] = [];
  for (const averageWindowCandles of [5, 10, 30, 60]) {
    for (const entryDropPct of grid.entryPcts) {
      for (const avgStopPct of grid.stopPcts) {
        if (avgStopPct + 1e-12 < entryDropPct + 0.01) continue;
        for (const avgTakeProfitPct of grid.takePcts) {
          const entry = fmtGridPct(entryDropPct);
          const stop = fmtGridPct(avgStopPct);
          const take = fmtGridPct(avgTakeProfitPct);
          scenarios.push({
            id: `${grid.id}-average-drop-cycle-${averageWindowCandles}m-entry-${entry}-stop-${stop}-take-${take}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / drop-${entry}% / stop-${stop}% / take-${take}%`,
            description: "Temporary backtracking range-comparison scenario.",
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

function summarizeRun(run: (typeof runs)[number]) {
  const selected = run.plan.selectedMarkets;
  const paperDrawdown = maxDrawdown(run.paper.equityCurve.map((point) => point.value));
  return {
    grid: run.grid.id,
    label: run.grid.label,
    scenarios: run.strategy.scenarios.length,
    candidates: run.plan.candidateMarkets.length,
    selected: selected.length,
    averageSelectedReturn: average(selected.map((item) => item.bestResult.returnRate)),
    medianSelectedReturn: median(selected.map((item) => item.bestResult.returnRate)),
    worstSelectedReturn: Math.min(...selected.map((item) => item.bestResult.returnRate)),
    averageSelectedMaxDrawdown: average(selected.map((item) => item.bestResult.maxDrawdown)),
    selectedBacktestTrades: selected.reduce((sum, item) => sum + item.bestResult.tradeCount, 0),
    portfolioReturn: run.paper.returnRate,
    portfolioFinalValue: run.paper.finalValue,
    portfolioMaxDrawdown: paperDrawdown,
    portfolioTrades: run.paper.trades.length,
  };
}

function formatSummary(summary: ReturnType<typeof summarizeRun>) {
  return {
    grid: summary.grid,
    scenarios: summary.scenarios,
    candidates: summary.candidates,
    selected: summary.selected,
    avgSelected: fmtPct(summary.averageSelectedReturn),
    medianSelected: fmtPct(summary.medianSelectedReturn),
    worstSelected: fmtPct(summary.worstSelectedReturn),
    avgMaxDD: fmtPct(summary.averageSelectedMaxDrawdown),
    selectedTrades: summary.selectedBacktestTrades,
    portfolioReturn: fmtPct(summary.portfolioReturn),
    portfolioFinal: Math.round(summary.portfolioFinalValue).toLocaleString("ko-KR"),
    portfolioMaxDD: fmtPct(summary.portfolioMaxDrawdown),
    portfolioTrades: summary.portfolioTrades,
  };
}

function buildUnionComparison(currentPlan: TraderOptimizationPlan, narrowedPlan: TraderOptimizationPlan) {
  const currentByMarket = new Map(currentPlan.optimizedMarkets.map((item) => [item.market, item]));
  const narrowedByMarket = new Map(narrowedPlan.optimizedMarkets.map((item) => [item.market, item]));
  const union = [...new Set([...markets(currentPlan), ...markets(narrowedPlan)])].sort();
  return union.map((market) => ({
    market,
    current: currentByMarket.has(market) ? toMarketRow(currentByMarket.get(market)!) : null,
    narrowed: narrowedByMarket.has(market) ? toMarketRow(narrowedByMarket.get(market)!) : null,
  }));
}

function toMarketRow(item: TraderOptimizationPlan["optimizedMarkets"][number]) {
  return {
    market: item.market,
    scenarioId: item.bestResult.scenarioId,
    scenarioName: item.bestResult.scenarioName,
    returnRate: item.bestResult.returnRate,
    maxDrawdown: item.bestResult.maxDrawdown,
    tradeCount: item.bestResult.tradeCount,
    winRate: item.bestResult.winRate,
  };
}

function markets(plan: TraderOptimizationPlan) {
  return plan.selectedMarkets.map((item) => item.market);
}

function intersect(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function subtract(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function maxDrawdown(values: number[]) {
  let peak = values[0] ?? 0;
  let result = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) result = Math.max(result, (peak - value) / peak);
  }
  return result;
}

function fmtGridPct(value: number) {
  return Number((value * 100).toFixed(1)).toString();
}

function fmtPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}
