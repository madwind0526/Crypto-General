import { readFile } from "node:fs/promises";
import path from "node:path";
import { runPaperTradingSimulation, type PaperTradingResult } from "../src/simulation/paperTrading";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { arbitrageStrategy } from "../src/strategies/arbitrage";
import type { Candle, GuideRuleMode, SafetyMode, Strategy, StrategyScenario, Trade } from "../src/types/trading";

interface MarketCachePayload {
  candleUnitMinutes?: number;
  generatedAt?: string;
  candlesByMarket: Record<string, Candle[]>;
}

interface PlanPayload {
  plan: TraderOptimizationPlan;
}

const root = process.cwd();
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const planRoot = path.join(root, "data", "local", "traders", "arbitrage", "scenarios");
const thresholds = [0.005, 0.007, 0.01];
const guideModes: GuideRuleMode[] = ["ignored", "strict"];
const safetyModes: SafetyMode[] = ["disabled", "enabled"];
const maxCandles = Number(process.env.PAPER_MAX_CANDLES ?? 2000);
const startAt = parseKstStartAt(process.env.PAPER_START_AT_KST ?? process.env.PAPER_START_AT);

const marketCache = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const results: Array<{
  threshold: number;
  guideRuleMode: GuideRuleMode;
  autoBlockMode: SafetyMode;
  finalValue: number;
  returnRate: number;
  trades: number;
  buys: number;
  sells: number;
  riskSells: number;
  maxHoldSells: number;
  signalProfitSells: number;
  avgRoundTripReturn: number | null;
  winRate: number | null;
}> = [];

for (const threshold of thresholds) {
  const strategy = withMinProfitPct(arbitrageStrategy, threshold);
  for (const guideRuleMode of guideModes) {
    const planPath = path.join(planRoot, `optimization-${guideRuleMode}.json`);
    const planPayload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
    for (const autoBlockMode of safetyModes) {
      const result = runPaperTradingSimulation(strategy, planPayload.plan, marketCache.candlesByMarket, {
        autoBlockMode,
        guideRuleMode,
        maxCandles,
        startAt,
      });
      results.push(toRow(threshold, result));
    }
  }
}

console.log(`Market cache: ${path.relative(root, marketCachePath)} (${marketCache.generatedAt ?? "unknown"})`);
console.log(`maxCandles=${maxCandles}, startAt=${startAt ? new Date(startAt).toISOString() : "auto"}`);
console.log("");
console.log("Live-like case: Guideline X / Safety X");
console.table(
  results
    .filter((row) => row.guideRuleMode === "ignored" && row.autoBlockMode === "disabled")
    .map(formatRow),
);
console.log("");
console.log("All daily cases");
console.table(results.map(formatRow));

function withMinProfitPct(strategy: Strategy, minProfitPct: number): Strategy {
  const scenarios = strategy.scenarios.map((scenario) => overrideScenario(scenario, minProfitPct));
  return {
    ...strategy,
    defaultScenario: overrideScenario(strategy.defaultScenario, minProfitPct),
    scenarios,
  };
}

function overrideScenario(scenario: StrategyScenario, minProfitPct: number): StrategyScenario {
  return {
    ...scenario,
    params: {
      ...scenario.params,
      minProfitPct,
    },
  };
}

function toRow(threshold: number, result: PaperTradingResult) {
  const sells = result.trades.filter((trade) => trade.side === "sell");
  const roundTrips = getRoundTripReturns(result.trades);
  const wins = roundTrips.filter((value) => value > 0).length;
  return {
    threshold,
    guideRuleMode: result.guideRuleMode,
    autoBlockMode: result.autoBlockMode,
    finalValue: result.finalValue,
    returnRate: result.returnRate,
    trades: result.trades.length,
    buys: result.trades.filter((trade) => trade.side === "buy").length,
    sells: sells.length,
    riskSells: sells.filter((trade) => trade.reasonCodes.includes("risk-rule-exit")).length,
    maxHoldSells: sells.filter((trade) => trade.reasonCodes.includes("max-hold-exit")).length,
    signalProfitSells: sells.filter((trade) => trade.reasonCodes.includes("profit-target")).length,
    avgRoundTripReturn: roundTrips.length > 0 ? average(roundTrips) : null,
    winRate: roundTrips.length > 0 ? wins / roundTrips.length : null,
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

function formatRow(row: (typeof results)[number]) {
  return {
    threshold: `${(row.threshold * 100).toFixed(1)}%`,
    guide: row.guideRuleMode === "ignored" ? "X" : "O",
    safety: row.autoBlockMode === "disabled" ? "X" : "O",
    final: Math.round(row.finalValue).toLocaleString("ko-KR"),
    return: `${(row.returnRate * 100).toFixed(2)}%`,
    trades: row.trades,
    buys: row.buys,
    sells: row.sells,
    riskSells: row.riskSells,
    maxHoldSells: row.maxHoldSells,
    profitSells: row.signalProfitSells,
    avgRoundTrip: row.avgRoundTripReturn === null ? "-" : `${(row.avgRoundTripReturn * 100).toFixed(2)}%`,
    winRate: row.winRate === null ? "-" : `${(row.winRate * 100).toFixed(1)}%`,
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
