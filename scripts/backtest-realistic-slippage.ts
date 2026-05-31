/**
 * 현실적 slippage(업비트 틱 기반) 적용 전후 최적화 비교
 *
 * 업비트 틱 단위:
 *   < 10원    → 0.01원  (예: 7원 코인 → 0.14%)
 *   10~100원  → 0.1원   (예: 14원 ALT → 0.71%)
 *   100~500원 → 1원     (예: 150원 DOGE → 0.67%)
 *   500~1000원→ 5원     (예: 600원 → 0.83%)
 *   1000~2000원→10원    (예: 1500원 → 0.67%)
 *   2000~5000원→50원    (예: 3000원 NEAR → 1.67%) ← 실제 체결은 호가 단위라 50원 아닐 수 있음
 *   ※ 실제 업비트: NEAR는 1원 틱 (KRW 시장 현물 틱)
 *
 * 보수적으로 반올림: 시장가 매수 → ask 체결, 시장가 매도 → bid 체결
 * 왕복 slippage = ask-bid 스프레드 / mid ≈ 1 tick / price
 * 단방향 slippage = 0.5 tick / price
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig } from "../src/simulation/backtest";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { arbitrageStrategy, arbitrageScenario } from "../src/strategies/arbitrage";
import type { Candle } from "../src/types/trading";

interface MarketCachePayload {
  candlesByMarket: Record<string, Candle[]>;
}

const root = process.cwd();
const cache = JSON.parse(
  await readFile(path.join(root, "data", "market", "upbit-krw-1m-backtracking.json"), "utf8"),
) as MarketCachePayload;

const maxCandles = 7 * 24 * 60;
const candles7d: Record<string, Candle[]> = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);

// ── 업비트 틱 단위 기반 단방향 slippage ──────────────────────────────────────
function upbitTickSlippage(price: number): number {
  // 단방향 슬리피지 = 틱 1개 / 가격 (시장가 주문이 최우선호가에 체결된다고 가정)
  if (price < 10)    return 0.01  / price;
  if (price < 100)   return 0.1   / price;
  if (price < 500)   return 1     / price;
  if (price < 1000)  return 5     / price;
  if (price < 5000)  return 10    / price;
  if (price < 10000) return 50    / price;
  return 100 / price;
}

// ── 설정 ─────────────────────────────────────────────────────────────────────
const opts = { candidateMarketCount: 30, monitoringMarketCount: 15, guideRuleMode: "ignored" as const };

const configCurrent = {
  ...defaultBacktestConfig,
  guideRuleMode: "ignored" as const,
  // 현재: 0.05% 고정 slippage
};

const configRealistic = {
  ...defaultBacktestConfig,
  guideRuleMode: "ignored" as const,
  slippageRate: 0,  // fallback 0 — dynamicSlippage가 모든 케이스를 처리
  dynamicSlippage: upbitTickSlippage,
};

// ── 실행 ─────────────────────────────────────────────────────────────────────
console.log("Computing... (현재 slippage vs 틱 기반 slippage 비교, 약 60초 소요)");

const [planCurrent, planRealistic] = await Promise.all([
  Promise.resolve(buildTraderOptimizationPlan(arbitrageStrategy, candles7d, { ...opts, config: configCurrent })),
  Promise.resolve(buildTraderOptimizationPlan(arbitrageStrategy, candles7d, { ...opts, config: configRealistic })),
]);

// ── 선택된 코인 목록 ──────────────────────────────────────────────────────────
const currentMarkets  = planCurrent.selectedMarkets.map((m) => m.market);
const realisticMarkets = planRealistic.selectedMarkets.map((m) => m.market);

const removed = currentMarkets.filter((m) => !realisticMarkets.includes(m));
const added   = realisticMarkets.filter((m) => !currentMarkets.includes(m));
const kept    = currentMarkets.filter((m) => realisticMarkets.includes(m));

// ── 출력 ─────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(80));
console.log("Arbitrage 전략 — 현재 slippage(0.05%) vs 현실적 slippage(틱 기반) 비교");
console.log("=".repeat(80));

// 전체 요약
const avgR = (plan: typeof planCurrent) =>
  plan.selectedMarkets.reduce((s, m) => s + m.bestResult.returnRate, 0) / plan.selectedMarkets.length;
const avgT = (plan: typeof planCurrent) =>
  plan.selectedMarkets.reduce((s, m) => s + m.bestResult.tradeCount, 0) / plan.selectedMarkets.length;
const avgW = (plan: typeof planCurrent) =>
  plan.selectedMarkets.reduce((s, m) => s + m.bestResult.winRate, 0) / plan.selectedMarkets.length;
const avgD = (plan: typeof planCurrent) =>
  plan.selectedMarkets.reduce((s, m) => s + m.bestResult.maxDrawdown, 0) / plan.selectedMarkets.length;

console.log("\n" + pad("설정", 26) + pad("평균수익", 10) + pad("거래수", 8) + pad("승률", 9) + "MaxDD");
console.log("-".repeat(60));
console.log(pad("현재 (0.05% 고정)", 26) + pad(pct(avgR(planCurrent)), 10) + pad(avgT(planCurrent).toFixed(0), 8) + pad(pct(avgW(planCurrent)), 9) + pct(avgD(planCurrent)));
console.log(pad("틱 기반 슬리피지", 26) + pad(pct(avgR(planRealistic)), 10) + pad(avgT(planRealistic).toFixed(0), 8) + pad(pct(avgW(planRealistic)), 9) + pct(avgD(planRealistic)));

// 코인별 상세
console.log("\n" + "=".repeat(80));
console.log("코인별 상세 비교 (현재 → 현실 slippage 적용 후)");
console.log("=".repeat(80));

// 합집합
const allMarkets = Array.from(new Set([...currentMarkets, ...realisticMarkets]));
console.log(pad("코인", 8) + pad("현재가", 9) + pad("슬리피지", 10) + pad("현재수익", 11) + pad("현실수익", 11) + pad("거래수↓", 10) + "선택");
console.log("-".repeat(80));

for (const market of allMarkets) {
  const c = candles7d[market];
  const lastPrice = c && c.length > 0 ? c[c.length - 1].close : 0;
  const slipPct = upbitTickSlippage(lastPrice) * 100;

  const inCurrent  = planCurrent.selectedMarkets.find((m) => m.market === market);
  const inRealistic = planRealistic.selectedMarkets.find((m) => m.market === market);

  const r0 = inCurrent   ? inCurrent.bestResult.returnRate   : null;
  const r1 = inRealistic ? inRealistic.bestResult.returnRate : null;
  const t0 = inCurrent   ? inCurrent.bestResult.tradeCount   : null;
  const t1 = inRealistic ? inRealistic.bestResult.tradeCount : null;

  let status = "";
  if (inCurrent && inRealistic)  status = "유지";
  else if (inCurrent && !inRealistic) status = "❌ 제외";
  else if (!inCurrent && inRealistic) status = "✅ 신규";

  console.log(
    pad(market.replace("KRW-", ""), 8) +
    pad(`${lastPrice.toFixed(1)}원`, 9) +
    pad(`${slipPct.toFixed(2)}%`, 10) +
    pad(r0 !== null ? pct(r0) : "—", 11) +
    pad(r1 !== null ? pct(r1) : "—", 11) +
    pad(t0 !== null && t1 !== null ? `${t0}→${t1}` : t0 !== null ? `${t0}→—` : `—→${t1}`, 10) +
    status,
  );
}

console.log("\n변경 요약:");
console.log(`  제외 (${removed.length}개): ${removed.map((m) => m.replace("KRW-", "")).join(", ") || "없음"}`);
console.log(`  신규 (${added.length}개):   ${added.map((m) => m.replace("KRW-", "")).join(", ") || "없음"}`);
console.log(`  유지 (${kept.length}개):  ${kept.map((m) => m.replace("KRW-", "")).join(", ")}`);

// ── 현실 slippage 기준 새 플랜을 파일로도 저장 (확인용) ────────────────────
const outPath = path.join(root, "data", "local", "traders", "arbitrage", "selected-symbols.realistic.json");
await writeFile(outPath, JSON.stringify(planRealistic, null, 2));
console.log(`\n현실 slippage 기준 플랜 저장: ${outPath}`);
console.log("※ 실제 전략 적용 시 이 파일을 selected-symbols.ignored.json으로 교체하면 됩니다.");

function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
