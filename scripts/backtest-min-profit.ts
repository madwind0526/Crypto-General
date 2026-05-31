/**
 * B/C/D 전략에 minProfitPct=1% 적용 전후 비교
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { rangeGridStrategy, rangeGridScenario } from "../src/strategies/rangeGrid";
import { arbitrageStrategy, arbitrageScenario } from "../src/strategies/arbitrage";
import { rangeReentryStrategy, rangeReentryScenario } from "../src/strategies/rangeReentry";
import type { Candle, StrategyScenario } from "../src/types/trading";

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

const config = { ...defaultBacktestConfig, guideRuleMode: "ignored" as const };
const opts = { candidateMarketCount: 30, monitoringMarketCount: 15, guideRuleMode: "ignored" as const, config };

function makeRangeGridWithMinProfit(minProfitPct: number): typeof rangeGridStrategy {
  return {
    ...rangeGridStrategy,
    scenarios: rangeGridStrategy.scenarios?.map((s) => ({
      ...s,
      params: { ...s.params, minProfitPct },
    })),
    defaultScenario: { ...rangeGridScenario, params: { ...rangeGridScenario.params, minProfitPct } },
    decide(context: Parameters<typeof rangeGridStrategy.decide>[0], scenario = rangeGridStrategy.defaultScenario) {
      const base = rangeGridStrategy.decide(context, scenario);
      if (base.action !== "sell") return base;
      const pos = context.position;
      if (!pos) return base;
      const threshold: number = (scenario.params.minProfitPct as number | undefined) ?? 0;
      const candle = context.candles[context.candleIndex];
      const returnPct = (candle.close - pos.averagePrice) / pos.averagePrice;
      if (returnPct < threshold && pos.holdCandles < (scenario.params.maxHoldCandles ?? 9999)) {
        return { action: "hold" as const, confidence: 0, reasonCodes: ["min-profit-wait"], targetWeight: 0 };
      }
      return base;
    },
  } as typeof rangeGridStrategy;
}

const rangeGridWith05Pct = makeRangeGridWithMinProfit(0.005);
const rangeGridWith1Pct  = makeRangeGridWithMinProfit(0.01);

function makeArbWithMinProfit(minProfitPct: number) {
  return {
    ...arbitrageStrategy,
    scenarios: arbitrageStrategy.scenarios?.map((s) => ({
      ...s,
      params: { ...s.params, minProfitPct },
    })),
    defaultScenario: { ...arbitrageScenario, params: { ...arbitrageScenario.params, minProfitPct } },
  };
}

const arbWith05Pct = makeArbWithMinProfit(0.005);
const arbWith1Pct  = makeArbWithMinProfit(0.01);

// ── D 전략: profitTargetPct가 이미 2.5% → 변경 없음 ────────────────────────
// (참고용으로 현재 값 그대로 비교)

interface Row {
  label: string;
  markets: number;
  avgReturn: number;
  avgTrades: number;
  avgWinRate: number;
  avgDD: number;
  bestCoin: string;
  bestReturn: number;
}

async function measure(strategy: typeof rangeGridStrategy, label: string): Promise<Row> {
  const plan = buildTraderOptimizationPlan(strategy, candles7d, opts);
  const markets = plan.selectedMarkets;
  if (markets.length === 0) return { label, markets: 0, avgReturn: 0, avgTrades: 0, avgWinRate: 0, avgDD: 0, bestCoin: "-", bestReturn: 0 };
  const avgReturn = avg(markets.map((m) => m.bestResult.returnRate));
  const avgTrades = avg(markets.map((m) => m.bestResult.tradeCount));
  const avgWinRate = avg(markets.map((m) => m.bestResult.winRate));
  const avgDD = avg(markets.map((m) => m.bestResult.maxDrawdown));
  const best = markets.reduce((a, b) => (a.bestResult.returnRate > b.bestResult.returnRate ? a : b));
  return {
    label,
    markets: markets.length,
    avgReturn,
    avgTrades,
    avgWinRate,
    avgDD,
    bestCoin: best.market.replace("KRW-", ""),
    bestReturn: best.bestResult.returnRate,
  };
}

console.log("Computing... (takes ~60s)");
const rows = await Promise.all([
  measure(rangeGridStrategy,                                "B  현재"),
  measure(rangeGridWith05Pct,                               "B  0.5% 적용"),
  measure(rangeGridWith1Pct,                                "B  1% 적용"),
  measure(arbitrageStrategy as typeof rangeGridStrategy,    "C  현재"),
  measure(arbWith05Pct as unknown as typeof rangeGridStrategy, "C  0.5% 적용"),
  measure(arbWith1Pct as unknown as typeof rangeGridStrategy,  "C  1% 적용"),
  measure(rangeReentryStrategy as typeof rangeGridStrategy, "D  현재 (2.5% 목표)"),
]);

console.log("\n" + "=".repeat(72));
console.log("B/C/D — minProfitPct 1% 적용 전후 비교  (7일 1m backtest, ignored)");
console.log("=".repeat(72));
console.log(
  pad("전략", 20) + pad("수익률", 9) + pad("거래수", 7) + pad("승률", 8) + pad("MaxDD", 8) + "Best 코인"
);
console.log("-".repeat(72));

for (const r of rows) {
  console.log(
    pad(r.label, 20) +
    pad(pct(r.avgReturn), 9) +
    pad(r.avgTrades.toFixed(0), 7) +
    pad(pct(r.avgWinRate), 8) +
    pad(pct(r.avgDD), 8) +
    `${r.bestCoin} (${pct(r.bestReturn)})`
  );
  if (r.label === "B  1% 적용" || r.label === "C  1% 적용") console.log();
}

console.log("\n※ D는 profitTargetPct=2.5%가 이미 적용되어 있어 별도 변경 없음");

function avg(arr: number[]) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
