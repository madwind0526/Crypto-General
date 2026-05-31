import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runPaperTradingSimulation, type PaperTradingResult } from "../src/simulation/paperTrading";
import { defaultBacktestConfig } from "../src/simulation/backtest";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { BacktestConfig, Candle, GuideRuleMode, SafetyMode, Strategy } from "../src/types/trading";

// 업비트 틱 단위 기반 단방향 slippage (시장가 주문 현실 반영)
function upbitTickSlippage(price: number): number {
  if (price < 10)     return 0.01  / price;
  if (price < 100)    return 0.1   / price;
  if (price < 500)    return 1     / price;
  if (price < 1000)   return 5     / price;
  if (price < 5000)   return 10    / price;
  if (price < 10_000) return 50    / price;
  return 100 / price;
}

const realisticConfig: BacktestConfig = {
  ...defaultBacktestConfig,
  slippageRate: 0,
  dynamicSlippage: upbitTickSlippage,
};

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
  autoBlockMode: SafetyMode;
  finalValue: number;
  returnRate: number;
  trades: number;
  safetyBlockedSignals: number;
  decisions: number;
  startedAt: number;
  endedAt: number;
}

const root = process.cwd();
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const outputRoot = path.join(root, process.env.PAPER_OUTPUT_DIR ?? "data/local/paper-trading-1m-daily");
const publicOutputPath = path.join(
  root,
  process.env.PAPER_PUBLIC_OUTPUT_PATH ?? "public/market/paper-trading-1m-daily-results.json",
);
const maxCandles = Number(process.env.PAPER_MAX_CANDLES ?? 1440);
const guideModes: GuideRuleMode[] = parseGuideModes(process.env.GUIDE_RULE_MODE);
const safetyModes: SafetyMode[] = parseSafetyModes(process.env.SAFETY_MODE);
const marketCache = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const startAt = parseKstStartAt(process.env.PAPER_START_AT_KST ?? process.env.PAPER_START_AT);
const rows: SummaryRow[] = [];
const results: Record<GuideRuleMode, Partial<Record<Strategy["id"], PaperTradingResult>>> = {
  ignored: {},
  strict: {},
};
const caseResults: Record<GuideRuleMode, Record<SafetyMode, Partial<Record<Strategy["id"], PaperTradingResult>>>> = {
  ignored: { disabled: {}, enabled: {} },
  strict: { disabled: {}, enabled: {} },
};

for (const strategy of strategies) {
  for (const guideRuleMode of guideModes) {
    for (const autoBlockMode of safetyModes) {
      const planPath = path.join(root, "data", "local", "traders", strategy.id, "scenarios", `optimization-${guideRuleMode}.json`);
      let planPayload: PlanPayload;
      try {
        planPayload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
      } catch (error) {
        console.warn(`[paper-sim] Skipping ${strategy.id}/${guideRuleMode}: plan file missing or unreadable (${planPath})`);
        continue;
      }
      const result = runPaperTradingSimulation(strategy, planPayload.plan, marketCache.candlesByMarket, {
        autoBlockMode,
        guideRuleMode,
        maxCandles,
        startAt,
        config: realisticConfig,
      });
      caseResults[guideRuleMode][autoBlockMode][strategy.id] = result;
      if (autoBlockMode === "disabled") results[guideRuleMode][strategy.id] = result;
      const outputDir = path.join(outputRoot, strategy.id, guideRuleMode, autoBlockMode);

      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, "latest-summary.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
      if (result.decisions.length > 0) {
        await writeFile(
          path.join(outputDir, "decisions.jsonl"),
          result.decisions.map((decision) => JSON.stringify(decision)).join("\n") + "\n",
          "utf8",
        );
      }

      rows.push(toSummaryRow(result));
      console.log(
        `${strategy.id}/${guideRuleMode}/${autoBlockMode}: final ${Math.round(result.finalValue).toLocaleString(
          "ko-KR",
        )} KRW, return ${(result.returnRate * 100).toFixed(2)}%, trades ${result.trades.length}, blocks ${
          result.safetyBlockedSignals
        }, decisions ${result.decisions.length}`,
      );
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  marketCache: {
    path: path.relative(root, marketCachePath),
    generatedAt: marketCache.generatedAt,
    candleUnitMinutes: marketCache.candleUnitMinutes,
    selectedMarkets: marketCache.selectedMarkets,
    startAt: startAt ? new Date(startAt).toISOString() : undefined,
  },
  maxCandles,
  caseResults,
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

function parseSafetyModes(value: string | undefined): SafetyMode[] {
  if (value === "enabled" || value === "disabled") return [value];
  return ["enabled", "disabled"];
}

function parseKstStartAt(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+09:00`;
  const timestamp = Date.parse(withZone);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid PAPER_START_AT value: ${value}`);
  return timestamp;
}

function toSummaryRow(result: PaperTradingResult): SummaryRow {
  return {
    strategyId: result.strategyId,
    strategyName: result.strategyName,
    guideRuleMode: result.guideRuleMode,
    autoBlockMode: result.autoBlockMode,
    finalValue: result.finalValue,
    returnRate: result.returnRate,
    trades: result.trades.length,
    safetyBlockedSignals: result.safetyBlockedSignals,
    decisions: result.decisions.length,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  };
}
