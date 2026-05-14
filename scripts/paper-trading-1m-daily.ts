import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPaperTradingSimulation, type PaperTradingResult } from "../src/simulation/paperTrading";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { Candle, GuideRuleMode, Strategy } from "../src/types/trading";

interface MarketCachePayload {
  candleUnitMinutes?: number;
  generatedAt?: string;
  selectedMarkets?: string[];
  candlesByMarket: Record<string, Candle[]>;
}

interface PlanPayload {
  plan: TraderOptimizationPlan;
}

interface SummaryRow {
  strategyId: Strategy["id"];
  strategyName: string;
  guideRuleMode: GuideRuleMode;
  finalValue: number;
  returnRate: number;
  trades: number;
  decisions: number;
  startedAt: number;
  endedAt: number;
}

const root = process.cwd();
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const outputRoot = path.join(root, process.env.PAPER_OUTPUT_DIR ?? "data/local/paper-trading-1m-daily");
const publicOutputPath = path.join(root, "public", "market", "paper-trading-1m-daily-results.json");
const maxCandles = Number(process.env.PAPER_MAX_CANDLES ?? 1440);
const guideModes: GuideRuleMode[] = parseGuideModes(process.env.GUIDE_RULE_MODE);
const marketCache = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const rows: SummaryRow[] = [];
const results: Record<GuideRuleMode, Partial<Record<Strategy["id"], PaperTradingResult>>> = {
  ignored: {},
  strict: {},
};

for (const strategy of strategies) {
  for (const guideRuleMode of guideModes) {
    const planPath = path.join(root, "data", "local", "traders", strategy.id, "scenarios", `optimization-${guideRuleMode}.json`);
    const planPayload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
    const result = runPaperTradingSimulation(strategy, planPayload.plan, marketCache.candlesByMarket, {
      guideRuleMode,
      maxCandles,
    });
    results[guideRuleMode][strategy.id] = result;
    const outputDir = path.join(outputRoot, strategy.id, guideRuleMode);

    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "latest-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputDir, "decisions.jsonl"),
      result.decisions.map((decision) => JSON.stringify(decision)).join("\n") + "\n",
      "utf8",
    );

    rows.push(toSummaryRow(result));
    console.log(
      `${strategy.id}/${guideRuleMode}: final ${Math.round(result.finalValue).toLocaleString("ko-KR")} KRW, return ${(
        result.returnRate * 100
      ).toFixed(2)}%, trades ${result.trades.length}, decisions ${result.decisions.length}`,
    );
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  marketCache: {
    path: path.relative(root, marketCachePath),
    generatedAt: marketCache.generatedAt,
    candleUnitMinutes: marketCache.candleUnitMinutes,
    selectedMarkets: marketCache.selectedMarkets,
  },
  maxCandles,
  rows,
  results,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await mkdir(path.dirname(publicOutputPath), { recursive: true });
await writeFile(publicOutputPath, `${JSON.stringify(summary)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputRoot)}`);
console.log(`Wrote ${path.relative(root, publicOutputPath)}`);

function parseGuideModes(value: string | undefined): GuideRuleMode[] {
  if (value === "strict" || value === "ignored") return [value];
  return ["strict", "ignored"];
}

function toSummaryRow(result: PaperTradingResult): SummaryRow {
  return {
    strategyId: result.strategyId,
    strategyName: result.strategyName,
    guideRuleMode: result.guideRuleMode,
    finalValue: result.finalValue,
    returnRate: result.returnRate,
    trades: result.trades.length,
    decisions: result.decisions.length,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  };
}
