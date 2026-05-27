import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTraderOptimizationPlan,
  compareOptimizationsByPureReturn,
  type TraderOptimizationPlan,
} from "../src/simulation/traderOptimization";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { scoreBacktestResult } from "../src/simulation/optimizer";
import { strategies } from "../src/strategies";
import type { BacktestResult, Candle, GuideRuleMode, Strategy, StrategyScenario } from "../src/types/trading";

interface MarketCachePayload {
  source?: string;
  generatedAt?: string;
  candleUnitMinutes?: number;
  selectedMarkets?: string[];
  candlesByMarket: Record<string, Candle[]>;
}

interface UpbitMarket {
  market: string;
}

interface UpbitTicker {
  market: string;
  acc_trade_price_24h: number;
}

interface UpbitMinuteCandle {
  candle_acc_trade_price: number;
  candle_acc_trade_volume: number;
  high_price: number;
  low_price: number;
  market: string;
  opening_price: number;
  timestamp: number;
  trade_price: number;
}

const UPBIT_BASE_URL = "https://api.upbit.com";
const root = process.cwd();
const outputRoot = path.join(root, process.env.ROLLOVER_OUTPUT_ROOT ?? "data/local/traders");
const marketCachePath = path.join(root, process.env.ROLLOVER_MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-daily.json");
const publicMarketCachePath = path.join(root, "public/market/upbit-krw-1m-daily.json");
const candidateMarketCount = Number(process.env.ROLLOVER_CANDIDATE_MARKET_COUNT ?? 30);
const monitoringMarketCount = Number(process.env.ROLLOVER_MONITORING_MARKET_COUNT ?? 9);
const runDashboardBuild = process.env.ROLLOVER_BUILD_DASHBOARD !== "false";
const commandTimeoutMs = Number(process.env.ROLLOVER_COMMAND_TIMEOUT_MINUTES ?? 20) * 60 * 1000;
const refreshTopMarkets = process.env.ROLLOVER_REFRESH_TOP30 !== "false";
const writeMarketCache = process.env.ROLLOVER_WRITE_MARKET_CACHE !== "false";
const requestDelayMs = Number(process.env.UPBIT_REQUEST_DELAY_MS ?? 120);
const maxRetries = Number(process.env.UPBIT_MAX_RETRIES ?? 4);
const refitPreviousWeight = clamp(Number(process.env.ROLLOVER_REFIT_PREVIOUS_WEIGHT ?? 0.7), 0, 1);
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
const expectedWindowCandles = Math.max(1, Math.floor((windowEnd - windowStart) / 60_000));
const minCompletenessRatio = Number(process.env.ROLLOVER_MIN_COMPLETENESS_RATIO ?? 0.7);
const minCandles = Number(
  process.env.ROLLOVER_MIN_CANDLES ?? Math.floor(expectedWindowCandles * minCompletenessRatio),
);
const minEligibleMarkets = Number(process.env.ROLLOVER_MIN_ELIGIBLE_MARKETS ?? monitoringMarketCount);

if (windowEnd <= windowStart) {
  throw new Error("Rollover window end must be after window start.");
}

const payload = await loadRolloverMarketCache();
const windowCandlesByMarket = sliceCandlesByWindow(payload.candlesByMarket, windowStart, windowEnd);
const availableMarkets = Object.values(windowCandlesByMarket).filter((candles) => candles.length >= minCandles).length;

if (availableMarkets < minEligibleMarkets) {
  const reason = `Only ${availableMarkets} markets have at least ${minCandles}/${expectedWindowCandles} candles in the previous 24h window. Keeping existing parameters.`;
  console.warn(`Daily rollover skipped: ${reason}`);
  await writeRolloverStatus({
    skipped: true,
    skipReason: reason,
  });
  if (runDashboardBuild) {
    await runCommand(process.execPath, [path.join(root, "scripts", "build-dashboard-results.mjs")]);
  }
  process.exit(0);
}

console.log(
  `Daily rollover: ${formatKst(windowStart)} - ${formatKst(windowEnd)}, ${availableMarkets} eligible markets`,
);

for (const strategy of strategies) {
  await persistStrategy(strategy, payload, windowCandlesByMarket);
}

await writeRolloverStatus();

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
    const smoothedPlan = await smoothRefitPlan(strategy, plan, candlesByMarket, guideRuleMode, marketParamsDir);
    const compactPlan = compactOptimizationPlan(smoothedPlan);
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
        path: path.relative(root, marketCachePath),
        source: sourcePayload.source,
        generatedAt: sourcePayload.generatedAt,
        candleUnitMinutes: sourcePayload.candleUnitMinutes,
        cachedMarketCount: Object.keys(sourcePayload.candlesByMarket).length,
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
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

    if (guideRuleMode === "ignored") {
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

async function smoothRefitPlan(
  strategy: Strategy,
  plan: TraderOptimizationPlan,
  candlesByMarket: Record<string, Candle[]>,
  guideRuleMode: GuideRuleMode,
  marketParamsDir: string,
): Promise<TraderOptimizationPlan> {
  if (refitPreviousWeight <= 0) return plan;

  const optimizedMarkets = await Promise.all(
    plan.optimizedMarkets.map((item) =>
      smoothMarketOptimization(strategy, item, candlesByMarket[item.market] ?? [], guideRuleMode, marketParamsDir),
    ),
  );
  const rankedByReturn = optimizedMarkets
    .slice()
    .sort(compareOptimizationsByPureReturn);

  return {
    ...plan,
    optimizedMarkets: rankedByReturn.slice(),
    selectedMarkets: rankedByReturn.slice(0, monitoringMarketCount),
  };
}

async function smoothMarketOptimization(
  strategy: Strategy,
  item: TraderOptimizationPlan["optimizedMarkets"][number],
  candles: Candle[],
  guideRuleMode: GuideRuleMode,
  marketParamsDir: string,
) {
  const previous = await loadPreviousMarketParams(marketParamsDir, item.market, guideRuleMode);
  if (!previous?.params || candles.length === 0) return item;

  const blendedParams = blendScenarioParams(previous.params, item.bestResult.scenarioParams ?? {}, refitPreviousWeight);
  const snappedScenario = snapScenarioToGrid(strategy, blendedParams);
  const scenario = createRefitScenario(
    strategy,
    item.bestResult,
    snappedScenario?.params ?? blendedParams,
    snappedScenario
      ? {
          scenarioId: snappedScenario.id,
          scenarioName: snappedScenario.name,
        }
      : previous,
  );
  const bestResult = runBacktest(strategy, scenario, candles, {
    ...defaultBacktestConfig,
    guideRuleMode,
  });

  return {
    ...item,
    bestResult,
    score: scoreBacktestResult(bestResult),
  };
}

async function loadPreviousMarketParams(marketParamsDir: string, market: string, guideRuleMode: GuideRuleMode) {
  try {
    return JSON.parse(await readFile(path.join(marketParamsDir, `${market}.${guideRuleMode}.json`), "utf8")) as {
      params?: Record<string, number>;
      scenarioId?: string;
      scenarioName?: string;
    };
  } catch {
    return null;
  }
}

function blendScenarioParams(
  previousParams: Record<string, number>,
  nextParams: Record<string, number>,
  previousWeight: number,
) {
  const nextWeight = 1 - previousWeight;
  const keys = new Set([...Object.keys(previousParams), ...Object.keys(nextParams)]);
  const blended: Record<string, number> = {};

  for (const key of keys) {
    const previous = previousParams[key];
    const next = nextParams[key];
    if (Number.isFinite(previous) && Number.isFinite(next)) {
      const value = previous * previousWeight + next * nextWeight;
      blended[key] = Number.isInteger(previous) && Number.isInteger(next) ? Math.round(value) : value;
    } else if (Number.isFinite(next)) {
      blended[key] = next;
    } else if (Number.isFinite(previous)) {
      blended[key] = previous;
    }
  }

  return blended;
}

function createRefitScenario(
  strategy: Strategy,
  result: BacktestResult,
  params: Record<string, number>,
  previous?: { scenarioId?: string; scenarioName?: string } | null,
): StrategyScenario {
  const scenarioId = previous?.scenarioId ?? result.scenarioId;
  const base =
    strategy.scenarios?.find((scenario) => scenario.id === scenarioId) ??
    strategy.scenarios?.find((scenario) => scenario.id === result.scenarioId) ??
    strategy.scenarios?.[0] ??
    strategy.defaultScenario;

  return {
    ...base,
    id: scenarioId,
    name: previous?.scenarioName ?? result.scenarioName ?? base.name,
    params,
  };
}

function snapScenarioToGrid(strategy: Strategy, params: Record<string, number>): StrategyScenario | null {
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  if (scenarios.length === 0) return null;

  return scenarios.reduce((best, current) =>
    scenarioDistance(current.params, params) < scenarioDistance(best.params, params) ? current : best,
  );
}

function scenarioDistance(candidateParams: Record<string, number>, targetParams: Record<string, number>) {
  const keys = new Set([...Object.keys(candidateParams), ...Object.keys(targetParams)]);
  let distance = 0;

  for (const key of keys) {
    const candidate = candidateParams[key];
    const target = targetParams[key];
    if (!Number.isFinite(candidate) || !Number.isFinite(target)) {
      distance += 1;
      continue;
    }

    const scale = Math.max(Math.abs(candidate), Math.abs(target), 1);
    const normalized = (candidate - target) / scale;
    distance += normalized * normalized;
  }

  return distance;
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

async function loadRolloverMarketCache(): Promise<MarketCachePayload> {
  const cached = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
  if (!refreshTopMarkets) return cached;

  try {
    const topMarkets = await fetchTopKrwMarkets(candidateMarketCount);
    const candlesByMarket: Record<string, Candle[]> = {};

    console.log(`Refreshing rollover top ${topMarkets.length}: ${topMarkets.join(", ")}`);
    for (const market of topMarkets) {
      await sleep(requestDelayMs);
      const fetched = await fetchOneMinuteCandlesForWindow(market, windowStart, windowEnd);
      candlesByMarket[market] = mergeCandles(cached.candlesByMarket[market] ?? [], fetched);
      console.log(`Rollover cache ${market}: ${candlesByMarket[market].length} candles`);
    }

    const refreshed = {
      ...cached,
      generatedAt,
      marketCount: topMarkets.length,
      selectedMarkets: topMarkets,
      source: "upbit-public-api",
      candleUnitMinutes: 1,
      candlesByMarket,
    };

    if (writeMarketCache) {
      await writeJson(marketCachePath, refreshed);
      await writeJson(publicMarketCachePath, refreshed);
    }

    return refreshed;
  } catch (error) {
    console.warn(
      `Failed to refresh rollover top ${candidateMarketCount}; falling back to existing cache: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return cached;
  }
}

async function fetchTopKrwMarkets(count: number) {
  const markets = (await fetchJson("/v1/market/all?isDetails=false")) as UpbitMarket[];
  const krwMarkets = markets.filter((item) => item.market.startsWith("KRW-")).map((item) => item.market);
  const tickers = await fetchTickers(krwMarkets);
  return tickers
    .slice()
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h)
    .slice(0, count)
    .map((ticker) => ticker.market);
}

async function fetchTickers(markets: string[]) {
  const tickers: UpbitTicker[] = [];
  for (let index = 0; index < markets.length; index += 100) {
    await sleep(requestDelayMs);
    const params = new URLSearchParams({ markets: markets.slice(index, index + 100).join(",") });
    tickers.push(...((await fetchJson(`/v1/ticker?${params.toString()}`)) as UpbitTicker[]));
  }
  return tickers;
}

async function fetchOneMinuteCandlesForWindow(market: string, start: number, end: number) {
  const all: UpbitMinuteCandle[] = [];
  let to = new Date(end).toISOString();

  const PAGE_CAP = 12;
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const params = new URLSearchParams({
      count: "200",
      market,
      to,
    });
    const pageCandles = (await fetchJson(`/v1/candles/minutes/1?${params.toString()}`)) as UpbitMinuteCandle[];
    if (pageCandles.length === 0) break;

    all.push(...pageCandles);
    const oldestTimestamp = Math.min(...pageCandles.map((candle) => candle.timestamp));
    to = new Date(oldestTimestamp - 1).toISOString();
    if (oldestTimestamp <= start) break;

    if (page === PAGE_CAP - 1) {
      console.warn(`[rollover] ${market}: hit ${PAGE_CAP}-page cap fetching 1m candles; window may be incomplete`);
    }
    await sleep(requestDelayMs);
  }

  const byTimestamp = new Map<number, Candle>();
  for (const candle of all) {
    if (candle.timestamp < start || candle.timestamp >= end) continue;
    byTimestamp.set(candle.timestamp, {
      close: candle.trade_price,
      high: candle.high_price,
      low: candle.low_price,
      market: candle.market,
      open: candle.opening_price,
      quoteVolume: candle.candle_acc_trade_price,
      timestamp: candle.timestamp,
      volume: candle.candle_acc_trade_volume,
    });
  }

  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function mergeCandles(existing: Candle[], incoming: Candle[]) {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of existing) byTimestamp.set(candle.timestamp, candle);
  for (const candle of incoming) byTimestamp.set(candle.timestamp, candle);
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchJson(pathname: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${UPBIT_BASE_URL}${pathname}`, {
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await sleep(getRetryDelayMs(null, attempt));
      continue;
    }

    if (response.ok) return response.json();

    const text = await response.text();
    lastError = new Error(`Upbit request failed ${response.status}: ${text}`);
    if (!shouldRetry(response.status) || attempt === maxRetries) break;

    await sleep(getRetryDelayMs(response, attempt));
  }

  throw lastError;
}

function shouldRetry(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(response: Response | null, attempt: number) {
  const retryAfter = response?.headers?.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
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
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      reject(new Error(`${command} ${args.join(" ")} timed out after ${commandTimeoutMs / 60_000} minutes`));
    }, commandTimeoutMs);

    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cb();
    };

    child.on("exit", (code) => finish(() => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    }));
    child.on("error", (error) => finish(() => reject(error)));
  });
}

async function writeJson(filePath: string, value: unknown) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, filePath);
}

async function writeRolloverStatus(extra: Record<string, unknown> = {}) {
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
    expectedWindowCandles,
    minCandles,
    minEligibleMarkets,
    availableMarkets,
    guideRuleModes,
    refit: {
      previousWeight: refitPreviousWeight,
      newWeight: 1 - refitPreviousWeight,
      mode: "weighted-minor-adjustment",
    },
    ...extra,
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
