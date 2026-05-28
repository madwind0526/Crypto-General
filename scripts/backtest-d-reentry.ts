/**
 * General-D re-entry logic comparison:
 *   Current:  uptrend pullback entry uses fast EMA − pullbackPct (ignores lastSellPrice)
 *   Modified: additionally requires price <= lastSellPrice × (1 − reentryDropPct)
 *             (applied to both range and uptrend entries)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { bollinger, ema, rsi } from "../src/indicators/technical";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { selectTopMarketsByTradeValue } from "../src/simulation/traderOptimization";
import { rangeReentryStrategy } from "../src/strategies/rangeReentry";
import type { Candle, Strategy, StrategyContext, StrategyDecision, StrategyScenario } from "../src/types/trading";

interface MarketCachePayload { candlesByMarket: Record<string, Candle[]> }

const root = process.cwd();
const cachePath = path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
const maxCandles = 7 * 24 * 60;

const cache = JSON.parse(await readFile(cachePath, "utf8")) as MarketCachePayload;
const candles7d: Record<string, Candle[]> = {};
for (const [m, c] of Object.entries(cache.candlesByMarket)) candles7d[m] = c.slice(-maxCandles);

// ── Modified strategy ───────────────────────────────────────────────────────
const rangeReentryModifiedStrategy: Strategy = {
  ...rangeReentryStrategy,
  id: "general-d-modified",
  name: "General-D Modified (lastSellPrice re-entry)",
  decide(context: StrategyContext, scenario = rangeReentryStrategy.defaultScenario): StrategyDecision {
    const { candles, candleIndex, lastSellPrice, position } = context;
    const current = candles[candleIndex];

    const closes = candles.map((c) => c.close);
    const bands = bollinger(closes, scenario.params.period, scenario.params.deviations);
    const fastArr = ema(closes, scenario.params.fastEma);
    const slowArr = ema(closes, scenario.params.slowEma);
    const rsiArr = rsi(closes, scenario.params.rsiPeriod);

    const band = bands[candleIndex];
    const currentRsi = rsiArr[candleIndex];
    const fast = fastArr[candleIndex];
    const slow = slowArr[candleIndex];
    const slowPast = slowArr[Math.max(0, candleIndex - scenario.params.trendSlopeLookback)];

    if (band === null || currentRsi === null || fast === null || slow === null || slowPast === null || slowPast === 0) {
      return hold("warming-up");
    }

    const slowSlope = (slow - slowPast) / slowPast;
    const sideways = Math.abs(slowSlope) <= scenario.params.maxTrendSlopePct && band.widthPct <= scenario.params.bandWidthMax;
    const uptrend = fast > slow && slowSlope > scenario.params.maxTrendSlopePct;
    const downtrend = fast < slow && slowSlope < -scenario.params.maxTrendSlopePct;

    if (position) {
      const gainFromEntry = (current.close - position.averagePrice) / position.averagePrice;
      const lowFromEntry = (current.low - position.averagePrice) / position.averagePrice;
      const targetReached = position.highestPrice >= position.averagePrice * (1 + scenario.params.profitTargetPct);
      const trailingStop = position.highestPrice * (1 - scenario.params.trailingStopAfterProfitPct);

      if (lowFromEntry <= -scenario.params.emergencyStopPct || gainFromEntry <= -scenario.params.emergencyStopPct) {
        return sell([downtrend ? "emergency-downtrend-exit" : "emergency-stop-exit"]);
      }
      if (targetReached && uptrend && current.close <= trailingStop) {
        return sell(["profit-target-trailing-exit"]);
      }
      if (gainFromEntry >= scenario.params.profitTargetPct && !uptrend) {
        return sell(["profit-target-exit"]);
      }
      return hold(targetReached ? "profit-target-trailing" : "waiting-profit-target");
    }

    if (downtrend) return hold("downtrend-entry-blocked");

    // ── KEY CHANGE: gate on lastSellPrice ──────────────────────────────────
    // If we've previously sold, only re-enter after price drops reentryDropPct below that sell price.
    // On first entry (no lastSellPrice) this gate is open.
    const reentryDropPct = scenario.params.reentryDropPct as number;
    const reentryGateOpen = !lastSellPrice || current.close <= lastSellPrice * (1 - reentryDropPct);

    const rangeEntry = sideways && current.close <= band.lower && currentRsi <= scenario.params.rsiMaxEntry && reentryGateOpen;
    const uptrendPullbackEntry =
      uptrend &&
      current.close <= fast * (1 - scenario.params.pullbackPct) &&
      currentRsi <= Math.max(scenario.params.rsiMaxEntry, 52) &&
      reentryGateOpen;

    if (rangeEntry || uptrendPullbackEntry) {
      return {
        action: "buy",
        confidence: rangeEntry ? 0.66 : 0.6,
        reasonCodes: rangeEntry
          ? ["box-regime", "lower-band-touch", "rsi-oversold", "reentry-gate"]
          : ["uptrend-pullback", "ema-pullback", "reentry-gate"],
        targetWeight: 0.65,
      };
    }

    return hold("no-reentry-setup");
  },
};

// ── Run comparison ──────────────────────────────────────────────────────────
const config = { ...defaultBacktestConfig, guideRuleMode: "ignored" as const };
const candidates = selectTopMarketsByTradeValue(candles7d, 30);
const scenarios = rangeReentryStrategy.scenarios;

console.log("=".repeat(80));
console.log("General-D: Current vs Modified (lastSellPrice re-entry gate)  [7d, 1m, ignored]");
console.log("=".repeat(80));
console.log(pad("Coin", 8) + pad("Scenario", 26) + pad("Current Return", 16) + pad("Modified Return", 16) + pad("Cur Trades", 11) + pad("Mod Trades", 11) + "Diff");
console.log("-".repeat(100));

let totalCurrentReturn = 0;
let totalModifiedReturn = 0;
let count = 0;

for (const { market } of candidates.slice(0, 30)) {
  const candles = candles7d[market];
  if (!candles || candles.length < 120) continue;

  let bestCurrentReturn = -Infinity;
  let bestCurrentTrades = 0;
  let bestModifiedReturn = -Infinity;
  let bestModifiedTrades = 0;
  let bestScenarioName = "";

  for (const scenario of scenarios) {
    const cur = runBacktest(rangeReentryStrategy, scenario, candles, config);
    const mod = runBacktest(rangeReentryModifiedStrategy, scenario, candles, config);
    if (cur.returnRate > bestCurrentReturn) {
      bestCurrentReturn = cur.returnRate;
      bestCurrentTrades = cur.tradeCount;
      bestScenarioName = scenario.name.replace(" re-entry", "").replace("re-", "").trim();
    }
    if (mod.returnRate > bestModifiedReturn) {
      bestModifiedReturn = mod.returnRate;
      bestModifiedTrades = mod.tradeCount;
    }
  }

  if (bestCurrentTrades === 0 && bestModifiedTrades === 0) continue;

  const coin = market.replace("KRW-", "");
  const diff = bestModifiedReturn - bestCurrentReturn;
  const diffStr = (diff >= 0 ? "+" : "") + pct(diff);
  console.log(
    pad(coin, 8) +
    pad(bestScenarioName, 26) +
    pad(pct(bestCurrentReturn), 16) +
    pad(pct(bestModifiedReturn), 16) +
    pad(String(bestCurrentTrades), 11) +
    pad(String(bestModifiedTrades), 11) +
    diffStr,
  );
  totalCurrentReturn += bestCurrentReturn;
  totalModifiedReturn += bestModifiedReturn;
  count++;
}

console.log("─".repeat(100));
if (count > 0) {
  console.log(
    pad("AVG", 8) + pad("", 26) +
    pad(pct(totalCurrentReturn / count), 16) +
    pad(pct(totalModifiedReturn / count), 16),
  );
}

function pct(v: number) { return `${(v * 100).toFixed(2)}%`; }
function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }
function hold(reason: string): StrategyDecision { return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 }; }
function sell(reasonCodes: string[]): StrategyDecision { return { action: "sell", confidence: 0.68, reasonCodes, targetWeight: 0 }; }
