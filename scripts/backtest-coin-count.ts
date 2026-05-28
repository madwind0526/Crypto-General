/**
 * Compare returns when selecting top-1 vs top-3 vs top-9 coins per strategy.
 * Shows best/median/worst within each selection to illustrate concentration risk.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { Candle } from "../src/types/trading";

interface MarketCachePayload { candlesByMarket: Record<string, Candle[]> }

const root = process.cwd();
const cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
const maxCandles = 7 * 24 * 60;

const cache = JSON.parse(await readFile(cachePath, "utf8")) as MarketCachePayload;
const candles7d: Record<string, Candle[]> = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);

const config = { ...defaultBacktestConfig, guideRuleMode: "ignored" as const };
const opts = { candidateMarketCount: 30, monitoringMarketCount: 9, guideRuleMode: "ignored" as const, config };

const labels: Record<string, string> = {
  momentum:    "A (Momentum)",
  "range-grid":"B (Range)   ",
  arbitrage:   "C (Arb)     ",
  "general-d": "D (Re-entry)",
  "general-e": "E (AvgDrop) ",
};

console.log("=".repeat(100));
console.log("Top-N 코인 선택 비교  [7일 1분봉, 백테스트 기준 최적 시나리오, guide=ignored]");
console.log("=".repeat(100));
console.log(
  pad("전략", 14) +
  pad("N=1  best", 13) +
  pad("N=3  avg", 13) + pad("best", 9) + pad("worst", 9) +
  pad("N=9  avg", 13) + pad("best", 9) + pad("worst", 9) +
  "N=9 중 손실 코인수"
);
console.log("-".repeat(100));

for (const strategy of strategies) {
  const label = labels[strategy.id] ?? strategy.id;
  const plan = buildTraderOptimizationPlan(strategy, candles7d, opts);

  // sorted best→worst by backtest return (already sorted in plan)
  const ranked = plan.optimizedMarkets
    .filter((m) => m.bestResult.tradeCount > 0)
    .sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate);

  if (ranked.length === 0) {
    console.log(pad(label, 14) + "  (no trades)");
    continue;
  }

  // N=1
  const top1 = ranked[0].bestResult.returnRate;

  // N=3
  const top3 = ranked.slice(0, 3);
  const avg3 = mean(top3.map((m) => m.bestResult.returnRate));
  const best3 = top3[0].bestResult.returnRate;
  const worst3 = top3[top3.length - 1].bestResult.returnRate;

  // N=9
  const top9 = ranked.slice(0, 9);
  const avg9 = mean(top9.map((m) => m.bestResult.returnRate));
  const best9 = top9[0].bestResult.returnRate;
  const worst9 = top9[top9.length - 1].bestResult.returnRate;
  const losers9 = top9.filter((m) => m.bestResult.returnRate < 0).length;

  console.log(
    pad(label, 14) +
    pad(pct(top1), 13) +
    pad(pct(avg3), 13) + pad(pct(best3), 9) + pad(pct(worst3), 9) +
    pad(pct(avg9), 13) + pad(pct(best9), 9) + pad(pct(worst9), 9) +
    `${losers9}개`,
  );
}

// ── 상세: 전략별 코인 순위 분포 ──────────────────────────────────────────────
console.log("\n" + "=".repeat(100));
console.log("전략별 코인 수익률 분포 (30개 후보 중 상위 9개)");
console.log("=".repeat(100));

for (const strategy of strategies) {
  const label = labels[strategy.id] ?? strategy.id;
  const plan = buildTraderOptimizationPlan(strategy, candles7d, opts);
  const ranked = plan.optimizedMarkets
    .filter((m) => m.bestResult.tradeCount > 0)
    .sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate)
    .slice(0, 9);

  if (ranked.length === 0) continue;

  console.log(`\n  General-${label.trim().split(" ")[0]}`);
  console.log("  " + pad("순위", 5) + pad("코인", 10) + pad("수익률", 12) + pad("거래수", 8) + "시나리오");
  for (let i = 0; i < ranked.length; i++) {
    const m = ranked[i];
    const coin = m.market.replace("KRW-", "");
    const mark = i === 0 ? "★" : i < 3 ? "▲" : " ";
    console.log(
      `  ${mark} ` +
      pad(`${i + 1}위`, 4) +
      pad(coin, 10) +
      pad(pct(m.bestResult.returnRate), 12) +
      pad(String(m.bestResult.tradeCount), 8) +
      (m.bestResult.scenarioId ?? "-"),
    );
  }
  const returns = ranked.map((m) => m.bestResult.returnRate);
  console.log(`  → 평균: ${pct(mean(returns))}  |  중앙값: ${pct(median(returns))}  |  표준편차: ${pct(std(returns))}`);
}

function mean(arr: number[]) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function median(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function std(arr: number[]) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
