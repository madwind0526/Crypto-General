/**
 * 저가 코인(< 100원) 최소 수익률 상향 전후 비교 backtest
 * 비교: 현재(0.5%) vs 저가 2% / vs 저가 3%
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { arbitrageStrategy, arbitrageScenario } from "../src/strategies/arbitrage";
import type { Candle, Strategy, StrategyScenario } from "../src/types/trading";

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

// 저가 코인 목록 (< 100원)
const LOW_PRICE_THRESHOLD = 100;
const lowPriceMarkets = Object.entries(candles7d)
  .filter(([, c]) => c.length > 0 && c[c.length - 1].close < LOW_PRICE_THRESHOLD)
  .map(([m]) => m);
const highPriceMarkets = Object.entries(candles7d)
  .filter(([, c]) => c.length > 0 && c[c.length - 1].close >= LOW_PRICE_THRESHOLD)
  .map(([m]) => m);

console.log(`\n저가 코인 (< ${LOW_PRICE_THRESHOLD}원): ${lowPriceMarkets.map((m) => m.replace("KRW-", "")).join(", ")}`);
console.log(`고가 코인 (>= ${LOW_PRICE_THRESHOLD}원): ${highPriceMarkets.map((m) => m.replace("KRW-", "")).join(", ")}\n`);

const config = { ...defaultBacktestConfig, guideRuleMode: "ignored" as const };
const opts = { candidateMarketCount: 30, monitoringMarketCount: 15, guideRuleMode: "ignored" as const, config };

function makeArbWithLowPriceThreshold(lowPriceMinProfitPct: number): Strategy {
  const patchScenario = (s: StrategyScenario): StrategyScenario => ({
    ...s,
    params: {
      ...s.params,
      lowPriceThreshold: LOW_PRICE_THRESHOLD,
      lowPriceMinProfitPct,
    },
  });
  return {
    ...arbitrageStrategy,
    scenarios: arbitrageStrategy.scenarios?.map(patchScenario),
    defaultScenario: patchScenario(arbitrageScenario),
  };
}

const arbCurrent  = arbitrageStrategy;
const arbLow2pct  = makeArbWithLowPriceThreshold(0.02);
const arbLow3pct  = makeArbWithLowPriceThreshold(0.03);

interface Row {
  label: string;
  markets: number;
  avgReturn: number;
  avgTrades: number;
  avgWinRate: number;
  avgDD: number;
}

interface CoinRow {
  market: string;
  price: number;
  current: number;
  low2pct: number;
  low3pct: number;
  trades_current: number;
  trades_low2: number;
}

async function measure(strategy: Strategy, label: string): Promise<Row> {
  const plan = buildTraderOptimizationPlan(strategy, candles7d, opts);
  const markets = plan.selectedMarkets;
  if (markets.length === 0) return { label, markets: 0, avgReturn: 0, avgTrades: 0, avgWinRate: 0, avgDD: 0 };
  return {
    label,
    markets: markets.length,
    avgReturn: avg(markets.map((m) => m.bestResult.returnRate)),
    avgTrades: avg(markets.map((m) => m.bestResult.tradeCount)),
    avgWinRate: avg(markets.map((m) => m.bestResult.winRate)),
    avgDD: avg(markets.map((m) => m.bestResult.maxDrawdown)),
  };
}

// 코인별 상세 비교: 저가 코인 + live-trader 대상 코인만
const liveMarkets = ["KRW-DOGE", "KRW-PENGU", "KRW-META", "KRW-ALT", "KRW-UP2", "KRW-NEAR", "KRW-SAFE", "KRW-ZBT", "KRW-NXPC"];

async function measurePerCoin(): Promise<CoinRow[]> {
  const rows: CoinRow[] = [];
  for (const market of liveMarkets) {
    const c = candles7d[market];
    if (!c || c.length === 0) continue;
    const lastPrice = c[c.length - 1].close;
    const scenarios = arbitrageStrategy.scenarios ?? [arbitrageScenario];

    const bestFor = (strat: Strategy) => {
      const bestScenario = scenarios.reduce(
        (best, scenario) => {
          const result = runBacktest(strat, scenario, c, config);
          return result.returnRate > best.returnRate ? result : best;
        },
        { returnRate: -Infinity, tradeCount: 0 },
      );
      return bestScenario;
    };

    const r0 = bestFor(arbCurrent);
    const r2 = bestFor(arbLow2pct);
    const r3 = bestFor(arbLow3pct);
    rows.push({
      market: market.replace("KRW-", ""),
      price: lastPrice,
      current: r0.returnRate,
      low2pct: r2.returnRate,
      low3pct: r3.returnRate,
      trades_current: r0.tradeCount,
      trades_low2: r2.tradeCount,
    });
  }
  return rows;
}

console.log("Computing... (7일 backtest, 약 30초 소요)");
const [summaryRows, coinRows] = await Promise.all([
  Promise.all([
    measure(arbCurrent, "현재 (저가 0.5%)"),
    measure(arbLow2pct, "저가 코인 2%"),
    measure(arbLow3pct, "저가 코인 3%"),
  ]),
  measurePerCoin(),
]);

// ── 전체 요약 ──────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(70));
console.log("전략별 전체 요약 (7일 1m backtest, guideline=ignored)");
console.log("=".repeat(70));
console.log(pad("전략", 22) + pad("코인수", 7) + pad("평균수익", 9) + pad("거래수", 7) + pad("승률", 8) + "MaxDD");
console.log("-".repeat(70));
for (const r of summaryRows) {
  console.log(
    pad(r.label, 22) +
    pad(String(r.markets), 7) +
    pad(pct(r.avgReturn), 9) +
    pad(r.avgTrades.toFixed(0), 7) +
    pad(pct(r.avgWinRate), 8) +
    pct(r.avgDD),
  );
}

// ── 코인별 상세 ─────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(80));
console.log("Live-trader 대상 코인별 수익률 비교");
console.log("=".repeat(80));
console.log(pad("코인", 8) + pad("현재가", 9) + pad("현재(0.5%)", 12) + pad("저가2%", 10) + pad("저가3%", 10) + pad("거래수↓", 10) + "비고");
console.log("-".repeat(80));
for (const r of coinRows) {
  const isLow = r.price < LOW_PRICE_THRESHOLD;
  const diff2 = r.low2pct - r.current;
  const marker = isLow
    ? (diff2 > 0 ? "▲ 개선" : diff2 < -0.001 ? "▼ 악화" : "— 유사")
    : "(고가, 영향없음)";
  console.log(
    pad(r.market, 8) +
    pad(`${r.price.toFixed(1)}원`, 9) +
    pad(pct(r.current), 12) +
    pad(isLow ? pct(r.low2pct) : "—", 10) +
    pad(isLow ? pct(r.low3pct) : "—", 10) +
    pad(isLow ? `${r.trades_current}→${r.trades_low2}` : "—", 10) +
    marker,
  );
}

console.log(`\n※ 저가 기준: ${LOW_PRICE_THRESHOLD}원 미만`);
console.log("※ 저가 코인 2%/3% 적용 시 고가 코인은 기존 시나리오 그대로 유지됨");

function avg(arr: number[]) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
