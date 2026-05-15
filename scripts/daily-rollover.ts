import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTraderOptimizationPlan, type TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { BacktestResult, Candle, GuideRuleMode, Strategy } from "../src/types/trading";

interface MarketCachePayload {
  source?: string;
  generatedAt?: string;
  candleUnitMinutes?: number;
  selectedMarkets?: string[];
  candlesByMarket: Record<string, Candle[]>;
}

const root = process.cwd();
const outputRoot = path.join(root, process.env.ROLLOVER_OUTPUT_ROOT ?? "data/local/traders");
const marketCachePath = path.join(root, process.env.ROLLOVER_MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const candidateMarketCount = Number(process.env.ROLLOVER_CANDIDATE_MARKET_COUNT ?? 30);
const monitoringMarketCount = Number(process.env.ROLLOVER_MONITORING_MARKET_COUNT ?? 30);
const minCandles = Number(process.env.ROLLOVER_MIN_CANDLES ?? 240);
const runDashboardBuild = process.env.ROLLOVER_BUILD_DASHBOARD !== "false";
const guideRuleModes: GuideRuleMode[] = (process.env.ROLLOVER_GUIDE_RULE_MODES ?? "strict,ignored")
  .split(",")
  .map((mode) => mode.trim())
  .filter((mode): mode is GuideRuleMode => mode === "strict" || mode === "ignored");
const rolloverAt = parseKstTime(process.env.ROLLOVER_AT_KST ?? process.env.ROLLOVER_AT) ?? Date.now();
const explicitWindowStart = parseKstTime(process.env.ROLLOVER_WINDOW_START_KST ?? process.env.ROLLOVER_WINDOW_START);
const explicitWindowEnd = parseKstTime(process.env.ROLLOVER_WINDOW_END_KST ?? process.env.ROLLOVER_WINDOW_END);
const windowEnd = explicitWindowEnd ?? getKstDayStart(rolloverAt);
const windowStart = explicitWindowStart ?? windowEnd - 24 * 60 * 60 * 1000;
const generatedAt = new Date().toISOString();

if (windowEnd <= windowStart) {
  throw new Error("Rollover window end must be after window start.");
}

const payload = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const windowCandlesByMarket = sliceCandlesByWindow(payload.candlesByMarket, windowStart, windowEnd);
const availableMarkets = Object.values(windowCandlesByMarket).filter((candles) => candles.length >= minCandles).length;

if (availableMarkets === 0) {
  throw new Error(
    `No markets have at least ${minCandles} candles in rollover window ${new Date(windowStart).toISOString()} - ${new Date(
      windowEnd,
    ).toISOString()}.`,
  );
}

console.log(
  `Daily rollover: ${formatKst(windowStart)} - ${formatKst(windowEnd)}, ${availableMarkets} eligible markets`,
);

for (const strategy of strategies) {
  await persistStrategy(strategy, payload, windowCandlesByMarket);
}

await writeJson(path.join(outputRoot, "daily-rollover-status.json"), {
  generatedAt,
  marketCache: {
    path: path.relative(root, marketCachePath),
    source: payload.source,
    generatedAt: payload.generatedAt,
    candleUnitMinutes: payload.candleUnitMinutes,
  },
  window: {
    start: new Date(windowStart).toISOString(),
    end: new Date(windowEnd).toISOString(),
    startKst: formatKst(windowStart),
    endKst: formatKst(windowEnd),
  },
  candidateMarketCount,
  monitoringMarketCount,
  minCandles,
  guideRuleModes,
});

if (runDashboardBuild) {
  await runCommand(process.execPath, [path.join(root, "scripts", "build-dashboard-results.mjs")]);
}

async function persistStrategy(
  strategy: Strategy,
  sourcePayload: MarketCachePayload,
  candlesByMarket: Record<string, Candle[]>,
) {
  const traderDir = path.join(outputRoot, strategy.id);
  const marketParamsDir = path.join(traderDir, "market-params");
  await mkdir(path.join(traderDir, "scenarios"), { recursive: true });
  await mkdir(path.join(traderDir, "simulations"), { recursive: true });
  await mkdir(marketParamsDir, { recursive: true });

  for (const guideRuleMode of guideRuleModes) {
    const plan = buildTraderOptimizationPlan(strategy, candlesByMarket, {
      candidateMarketCount,
      monitoringMarketCount,
      tradeValueLookbackCandles: Number.POSITIVE_INFINITY,
      optimizationLookbackCandles: Number.POSITIVE_INFINITY,
      minCandles,
      guideRuleMode,
    });
    const compactPlan = compactOptimizationPlan(plan);
    const exportPayload = {
      generatedAt,
      rollover: {
        source: "daily-rollover-1m",
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        windowStartKst: formatKst(windowStart),
        windowEndKst: formatKst(windowEnd),
        minCandles,
      },
      marketCache: {
        source: sourcePayload.source,
        generatedAt: sourcePayload.generatedAt,
        candleUnitMinutes: sourcePayload.candleUnitMinutes,
        cachedMarketCount: Object.keys(sourcePayload.candlesByMarket).length,
      },
      plan: compactPlan,
    };
    const scenarioPath = path.join(traderDir, "scenarios", `optimization-${guideRuleMode}.json`);
    const selectedPath = path.join(traderDir, `selected-symbols.${guideRuleMode}.json`);

    await writeJson(scenarioPath, exportPayload);
    await writeJson(selectedPath, {
      generatedAt,
      guideRuleMode,
      strategyId: strategy.id,
      strategyName: strategy.name,
      selectedMarkets: compactPlan.selectedMarkets,
      rollover: exportPayload.rollover,
    });
    await persistMarketParams(marketParamsDir, strategy, compactPlan, guideRuleMode);

    if (guideRuleMode === "strict") {
      await writeJson(path.join(traderDir, "selected-symbols.json"), {
        generatedAt,
        guideRuleMode,
        strategyId: strategy.id,
        strategyName: strategy.name,
        selectedMarkets: compactPlan.selectedMarkets,
        rollover: exportPayload.rollover,
      });
    }

    console.log(
      `${strategy.id}/${guideRuleMode}: ${compactPlan.candidateMarkets.length} candidates, ${compactPlan.selectedMarkets.length} monitoring`,
    );
  }
}

async function persistMarketParams(
  marketParamsDir: string,
  strategy: Strategy,
  plan: ReturnType<typeof compactOptimizationPlan>,
  guideRuleMode: GuideRuleMode,
) {
  for (const item of plan.selectedMarkets) {
    await writeJson(path.join(marketParamsDir, `${item.market}.${guideRuleMode}.json`), {
      generatedAt,
      guideRuleMode,
      market: item.market,
      strategyId: strategy.id,
      strategyName: strategy.name,
      scenarioId: item.bestResult.scenarioId,
      scenarioName: item.bestResult.scenarioName,
      params: item.bestResult.scenarioParams,
      source: "daily-rollover-1m",
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
      candidateRank: item.candidateRank,
      score: item.score,
      returnRate: item.bestResult.returnRate,
      tradeCount: item.bestResult.tradeCount,
      maxDrawdown: item.bestResult.maxDrawdown,
    });
  }
}

function compactOptimizationPlan(plan: TraderOptimizationPlan) {
  return {
    ...plan,
    optimizedMarkets: plan.optimizedMarkets.map(compactMarketOptimization),
    selectedMarkets: plan.selectedMarkets.map(compactMarketOptimization),
  };
}

function compactMarketOptimization(item: TraderOptimizationPlan["optimizedMarkets"][number]) {
  return {
    market: item.market,
    candidateRank: item.candidateRank,
    tradeValue: item.tradeValue,
    score: item.score,
    bestResult: compactBacktestResult(item.bestResult),
  };
}

function compactBacktestResult(result: BacktestResult): BacktestResult {
  return {
    strategyId: result.strategyId,
    scenarioId: result.scenarioId,
    scenarioName: result.scenarioName,
    scenarioParams: result.scenarioParams,
    market: result.market,
    finalValue: result.finalValue,
    returnRate: result.returnRate,
    maxDrawdown: result.maxDrawdown,
    winRate: result.winRate,
    tradeCount: result.tradeCount,
    profitFactor: result.profitFactor,
    worstTradeReturn: result.worstTradeReturn,
    guideRuleMode: result.guideRuleMode,
    guideRejectedSignals: result.guideRejectedSignals,
    trades: [],
    signalAudit: [],
    equityCurve: [],
  };
}

function sliceCandlesByWindow(candlesByMarket: Record<string, Candle[]>, start: number, end: number) {
  return Object.fromEntries(
    Object.entries(candlesByMarket).map(([market, candles]) => [
      market,
      candles.filter((candle) => candle.timestamp >= start && candle.timestamp < end),
    ]),
  );
}

function getKstDayStart(timestamp: number) {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const shifted = new Date(timestamp + kstOffsetMs);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - kstOffsetMs;
}

function parseKstTime(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+09:00`;
  const timestamp = Date.parse(withZone);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid KST time value: ${value}`);
  return timestamp;
}

function formatKst(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
