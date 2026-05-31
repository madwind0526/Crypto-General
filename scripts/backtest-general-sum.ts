import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { buildSumOptimizationPlan, buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { generalSumStrategy, strategies } from "../src/strategies";
import type { Candle } from "../src/types/trading";

interface MarketCachePayload {
  candlesByMarket: Record<string, Candle[]>;
}

const root = process.cwd();
const cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
const maxCandles = 7 * 24 * 60; // 7일 = 10,080 분봉

const cache = JSON.parse(await readFile(cachePath, "utf8")) as MarketCachePayload;
const allCandles = cache.candlesByMarket;

// 7일치만 사용
const candles7d: Record<string, Candle[]> = {};
for (const [market, candles] of Object.entries(allCandles)) {
  candles7d[market] = candles.slice(-maxCandles);
}

const config = { ...defaultBacktestConfig, guideRuleMode: "ignored" as const };
const opts = { candidateMarketCount: 30, monitoringMarketCount: 15, guideRuleMode: "ignored" as const, config };

console.log("=".repeat(70));
console.log("7-Day Backtest: General-Sum vs A-E  (1m candles, ignored guide)");
console.log("=".repeat(70));

// Step 1: A-E 전략별 최적화 플랜 계산
process.stdout.write("Computing A-E plans...");
const basePlans = strategies.map((strategy) => buildTraderOptimizationPlan(strategy, candles7d, opts));
console.log(" done");

// Step 2: General-Sum 플랜 (중복 코인 선택)
process.stdout.write("Computing General-Sum overlap plan...");
const sumPlan = buildSumOptimizationPlan(generalSumStrategy, basePlans, candles7d, opts);
console.log(" done\n");

// Step 3: A-E 결과 출력
console.log("─".repeat(70));
console.log(pad("Strategy", 22) + pad("Coins", 4) + pad("Return", 10) + pad("WinRate", 10) + pad("Trades", 8) + pad("MaxDD", 9) + "Best Coin");
console.log("─".repeat(70));

const allPlans = [...basePlans, sumPlan];
const planLabels: Record<string, string> = {
  "momentum": "General-A (Momentum)",
  "range-grid": "General-B (Range)",
  "arbitrage": "General-C (Arb)",
  "general-d": "General-D (Re-entry)",
  "general-e": "General-E (AvgDrop)",
  "general-sum": "General-Sum (Router)",
};

for (const plan of allPlans) {
  const label = planLabels[plan.strategyId] ?? plan.strategyId;
  const markets = plan.selectedMarkets;
  if (markets.length === 0) {
    console.log(pad(label, 22) + pad(String(0), 4) + "  (no markets selected)");
    continue;
  }
  const returns = markets.map((m) => m.bestResult.returnRate);
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const avgWinRate = markets.map((m) => m.bestResult.winRate).reduce((s, r) => s + r, 0) / markets.length;
  const avgTrades = markets.map((m) => m.bestResult.tradeCount).reduce((s, r) => s + r, 0) / markets.length;
  const avgDD = markets.map((m) => m.bestResult.maxDrawdown).reduce((s, r) => s + r, 0) / markets.length;
  const best = markets.reduce((a, b) => (a.bestResult.returnRate > b.bestResult.returnRate ? a : b));
  const bestName = best.market.replace("KRW-", "");

  const isSumRow = plan.strategyId === "general-sum";
  const line =
    pad(label, 22) +
    pad(String(markets.length), 4) +
    pad(fmtPct(avgReturn), 10) +
    pad(fmtPct(avgWinRate), 10) +
    pad(avgTrades.toFixed(0), 8) +
    pad(fmtPct(avgDD), 9) +
    `${bestName} (${fmtPct(best.bestResult.returnRate)})`;
  console.log(isSumRow ? `\n${line}` : line);
}

// Step 4: General-Sum 코인별 상세 + 어떤 전략이 선택됐는지
console.log("\n" + "─".repeat(70));
console.log("General-Sum — selected coins and best scenario:");
console.log("─".repeat(70));
console.log(pad("Coin", 12) + pad("Scenario", 32) + pad("Return", 10) + pad("Trades", 8) + "MaxDD");
for (const m of sumPlan.selectedMarkets) {
  const coin = m.market.replace("KRW-", "");
  const scenario = m.bestResult.scenarioId ?? "-";
  console.log(pad(coin, 12) + pad(scenario, 32) + pad(fmtPct(m.bestResult.returnRate), 10) + pad(String(m.bestResult.tradeCount), 8) + fmtPct(m.bestResult.maxDrawdown));
}

// Step 5: Sum 전략 코인들이 어느 전략에 중복 등장했는지 보여주기
console.log("\n" + "─".repeat(70));
console.log("Overlap score — how many A-E strategies selected each coin:");
console.log("─".repeat(70));
const scoreMap = new Map<string, string[]>();
for (const plan of basePlans) {
  for (const m of plan.selectedMarkets) {
    if (!scoreMap.has(m.market)) scoreMap.set(m.market, []);
    scoreMap.get(m.market)!.push(planLabels[plan.strategyId]?.split(" ")[0] ?? plan.strategyId);
  }
}
const sumCoins = new Set(sumPlan.selectedMarkets.map((m) => m.market));
const sorted = [...scoreMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
for (const [market, tags] of sorted) {
  const coin = market.replace("KRW-", "");
  const mark = sumCoins.has(market) ? "★" : " ";
  console.log(`${mark} ${pad(coin, 10)} [${tags.length}개 전략] ${tags.join(", ")}`);
}
console.log("\n★ = General-Sum 선정 코인");

function fmtPct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}
function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
