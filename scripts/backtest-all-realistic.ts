/**
 * 전략 A–E 전체: 현재 slippage(0.05%) vs 현실적 slippage(업비트 틱 기반) 비교
 * 결과를 보여주고 현실 slippage 기준 플랜을 각 전략 디렉토리에 저장
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig } from "../src/simulation/backtest";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { momentumStrategy }        from "../src/strategies/momentum";
import { rangeGridStrategy }        from "../src/strategies/rangeGrid";
import { arbitrageStrategy }        from "../src/strategies/arbitrage";
import { rangeReentryStrategy }     from "../src/strategies/rangeReentry";
import { averageDropCycleStrategy } from "../src/strategies/averageDropCycle";
import type { BacktestConfig, Candle, Strategy } from "../src/types/trading";

// ── 전략 목록 ────────────────────────────────────────────────────────────────
const STRATEGIES: { label: string; strategy: Strategy; dir: string }[] = [
  { label: "A (Momentum)",   strategy: momentumStrategy,         dir: "momentum"   },
  { label: "B (Range-Grid)", strategy: rangeGridStrategy,         dir: "range-grid" },
  { label: "C (Arbitrage)",  strategy: arbitrageStrategy,         dir: "arbitrage"  },
  { label: "D (RangeReentry)", strategy: rangeReentryStrategy,    dir: "general-d"  },
  { label: "E (AvgDrop)",    strategy: averageDropCycleStrategy,  dir: "general-e"  },
];

// ── 업비트 틱 기반 단방향 slippage ────────────────────────────────────────────
function upbitTickSlippage(price: number): number {
  if (price < 10)     return 0.01  / price;
  if (price < 100)    return 0.1   / price;
  if (price < 500)    return 1     / price;
  if (price < 1000)   return 5     / price;
  if (price < 5000)   return 10    / price;
  if (price < 10_000) return 50    / price;
  return 100 / price;
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────
interface MarketCachePayload { candlesByMarket: Record<string, Candle[]> }
const root = process.cwd();
const cache = JSON.parse(
  await readFile(path.join(root, "data", "market", "upbit-krw-1m-backtracking.json"), "utf8"),
) as MarketCachePayload;

const maxCandles = 7 * 24 * 60;
const candles7d: Record<string, Candle[]> = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);

// ── 최적화 옵션 ───────────────────────────────────────────────────────────────
const candidateMarketCount = Number(process.env.CANDIDATE_MARKET_COUNT ?? 30);
const monitoringMarketCount = Number(process.env.MONITORING_MARKET_COUNT ?? 15);
const minPrice = process.env.MIN_PRICE ? Number(process.env.MIN_PRICE) : 100;
const maxPrice = process.env.MAX_PRICE ? Number(process.env.MAX_PRICE) : 10_000;
const BASE_OPTS = { candidateMarketCount, monitoringMarketCount, guideRuleMode: "ignored" as const, minPrice, maxPrice };

const configCurrent: BacktestConfig = { ...defaultBacktestConfig, guideRuleMode: "ignored" };

const configRealistic: BacktestConfig = {
  ...defaultBacktestConfig,
  guideRuleMode: "ignored",
  slippageRate: 0,
  dynamicSlippage: upbitTickSlippage,
};

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log("전략 A–E: 현재 slippage vs 틱 기반 현실 slippage 비교 최적화");
console.log("데이터: 7일 1분봉 backtracking, guideline=ignored");
console.log("Computing... (약 3~5분 소요)\n");

const results = await Promise.all(
  STRATEGIES.map(async ({ label, strategy, dir }) => {
    const [planOld, planNew] = await Promise.all([
      Promise.resolve(buildTraderOptimizationPlan(strategy, candles7d, { ...BASE_OPTS, config: configCurrent })),
      Promise.resolve(buildTraderOptimizationPlan(strategy, candles7d, { ...BASE_OPTS, config: configRealistic })),
    ]);
    return { label, dir, planOld, planNew };
  }),
);

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function planStats(plan: ReturnType<typeof buildTraderOptimizationPlan>) {
  const ms = plan.selectedMarkets;
  if (ms.length === 0) return { avgReturn: 0, avgTrades: 0, avgWin: 0, avgDD: 0 };
  return {
    avgReturn: ms.reduce((s, m) => s + m.bestResult.returnRate, 0) / ms.length,
    avgTrades: ms.reduce((s, m) => s + m.bestResult.tradeCount, 0) / ms.length,
    avgWin:    ms.reduce((s, m) => s + m.bestResult.winRate, 0)    / ms.length,
    avgDD:     ms.reduce((s, m) => s + m.bestResult.maxDrawdown, 0) / ms.length,
  };
}
function pct(v: number)         { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return (s + " ".repeat(n)).slice(0, n); }
function diff(a: number, b: number) {
  const d = (b - a) * 100;
  return (d >= 0 ? "+" : "") + d.toFixed(2) + "%p";
}

// ── 전략별 요약 출력 ──────────────────────────────────────────────────────────
console.log("=".repeat(90));
console.log("전략별 요약 비교");
console.log("=".repeat(90));
console.log(pad("전략", 20) + pad("설정", 16) + pad("평균수익", 11) + pad("거래수", 8) + pad("승률", 9) + pad("MaxDD", 9) + "수익변화");
console.log("-".repeat(90));

for (const { label, planOld, planNew } of results) {
  const o = planStats(planOld);
  const n = planStats(planNew);
  console.log(pad(`General-${label}`, 20) + pad("현재(0.05%)", 16) + pad(pct(o.avgReturn), 11) + pad(o.avgTrades.toFixed(0), 8) + pad(pct(o.avgWin), 9) + pct(o.avgDD));
  console.log(pad("", 20) + pad("틱 기반 slippage", 16) + pad(pct(n.avgReturn), 11) + pad(n.avgTrades.toFixed(0), 8) + pad(pct(n.avgWin), 9) + pad(pct(n.avgDD), 9) + diff(o.avgReturn, n.avgReturn));
  console.log();
}

// ── 코인별 상세 (전략별) ───────────────────────────────────────────────────────
for (const { label, planOld, planNew } of results) {
  const oldMarkets  = planOld.selectedMarkets.map((m) => m.market);
  const newMarkets  = planNew.selectedMarkets.map((m) => m.market);
  const allMarkets  = Array.from(new Set([...oldMarkets, ...newMarkets]));
  const removed = oldMarkets.filter((m) => !newMarkets.includes(m));
  const added   = newMarkets.filter((m) => !oldMarkets.includes(m));

  console.log("─".repeat(90));
  console.log(`General-${label}  |  제외: ${removed.map((m) => m.replace("KRW-","")).join(", ") || "없음"}  |  신규: ${added.map((m) => m.replace("KRW-","")).join(", ") || "없음"}`);
  console.log("─".repeat(90));
  console.log(pad("코인", 8) + pad("현재가", 10) + pad("slip%", 8) + pad("현재수익", 11) + pad("현실수익", 11) + pad("거래수", 11) + "변경");
  console.log("-".repeat(70));

  for (const market of allMarkets) {
    const c = candles7d[market];
    const price = c && c.length > 0 ? c[c.length - 1].close : 0;
    const slipPct = (upbitTickSlippage(price) * 100).toFixed(2);
    const inOld = planOld.selectedMarkets.find((m) => m.market === market);
    const inNew = planNew.selectedMarkets.find((m) => m.market === market);
    const status = inOld && inNew ? "유지" : inOld ? "❌ 제외" : "✅ 신규";
    const r0 = inOld ? pct(inOld.bestResult.returnRate) : "—";
    const r1 = inNew ? pct(inNew.bestResult.returnRate) : "—";
    const t0 = inOld ? inOld.bestResult.tradeCount : null;
    const t1 = inNew ? inNew.bestResult.tradeCount : null;
    const trades = t0 !== null && t1 !== null ? `${t0}→${t1}` : t0 !== null ? `${t0}→—` : `—→${t1}`;
    console.log(pad(market.replace("KRW-",""), 8) + pad(`${price >= 1000 ? (price/1000).toFixed(0)+"k" : price.toFixed(1)}원`, 10) + pad(`${slipPct}%`, 8) + pad(r0, 11) + pad(r1, 11) + pad(trades, 11) + status);
  }
  console.log();
}

// ── 현실 slippage 기준 플랜 저장 ──────────────────────────────────────────────
console.log("=".repeat(90));
console.log("현실 slippage 기준 플랜 저장 중...");
for (const { dir, planNew } of results) {
  const outDir  = path.join(root, "data", "local", "traders", dir);
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "selected-symbols.realistic.json");
  await writeFile(outPath, JSON.stringify(planNew, null, 2));
  const coins = planNew.selectedMarkets.map((m) => m.market.replace("KRW-","")).join(", ");
  console.log(`  ${dir.padEnd(12)} → ${outPath.split("\\").slice(-3).join("/")}  [${coins}]`);
}

console.log("\n※ 전략 실제 적용 시: selected-symbols.realistic.json → selected-symbols.ignored.json 으로 교체");
