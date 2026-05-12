import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPaperTradingSimulation } from "../src/simulation/paperTrading";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { Candle, GuideRuleMode } from "../src/types/trading";

interface MarketCachePayload {
  candlesByMarket: Record<string, Candle[]>;
}

interface PlanPayload {
  plan: TraderOptimizationPlan;
}

const root = process.cwd();
const strategyId = process.env.TRADER_ID ?? "momentum";
const guideRuleMode = parseGuideRuleMode(process.env.GUIDE_RULE_MODE ?? "strict");
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-5m.json");
const planPath = path.join(
  root,
  process.env.TRADER_PLAN_PATH ?? `data/local/traders/${strategyId}/scenarios/optimization-${guideRuleMode}.json`,
);
const outputDir = path.join(root, process.env.PAPER_OUTPUT_DIR ?? `data/local/paper-trading/${strategyId}`);
const maxCandles = Number(process.env.PAPER_MAX_CANDLES ?? 288);

const strategy = strategies.find((item) => item.id === strategyId);
if (!strategy) throw new Error(`Unknown strategy: ${strategyId}`);

const marketCache = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const planPayload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
const result = runPaperTradingSimulation(strategy, planPayload.plan, marketCache.candlesByMarket, {
  guideRuleMode,
  maxCandles,
});

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "latest-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await writeFile(
  path.join(outputDir, "decisions.jsonl"),
  result.decisions.map((decision) => JSON.stringify(decision)).join("\n") + "\n",
  "utf8",
);

console.log(
  `${strategyId}/${guideRuleMode}: final ${Math.round(result.finalValue).toLocaleString("ko-KR")} KRW, return ${(
    result.returnRate * 100
  ).toFixed(2)}%, trades ${result.trades.length}`,
);
console.log(`Wrote ${path.relative(root, outputDir)}`);

function parseGuideRuleMode(value: string): GuideRuleMode {
  return value === "ignored" ? "ignored" : "strict";
}
