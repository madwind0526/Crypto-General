import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { planToComparisonByPureReturn } from "../src/simulation/dashboardResults";
import { defaultBacktestConfig, runBacktest } from "../src/simulation/backtest";
import { evaluateSafetyBlock, getDailyReturnAtCandleIndex } from "../src/simulation/safety";
import type { StrategyComparison, StrategyGuideModeComparison } from "../src/simulation/optimizer";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { BacktestResult, Candle, GuideRuleMode, SafetyMode, Strategy, Trade } from "../src/types/trading";

interface OptimizationPayload {
  marketCache?: {
    path?: string;
    windowEnd?: string;
    windowStart?: string;
  };
  plan: TraderOptimizationPlan;
}

interface MarketCachePayload {
  candlesByMarket: Record<string, Candle[]>;
}

const root = process.cwd();
const candleCache = new Map<string, Record<string, Candle[]>>();
const resultCandles = new Map<string, Candle[]>();
const strictPlans = await buildPlans("strict");
const ignoredPlans = await buildPlans("ignored");
const comparisons = plansToComparisonsByPureReturn(ignoredPlans);
const guideModeComparisons = strictPlans.flatMap((strictPlan) => {
  const ignoredPlan = ignoredPlans.find((plan) => plan.strategyId === strictPlan.strategyId);
  if (!ignoredPlan) return [];
  const strict = planToComparisonByPureReturn(strictPlan);
  const ignored = planToComparisonByPureReturn(ignoredPlan);
  if (!strict || !ignored) return [];
  return {
    strategyName: strictPlan.strategyName,
    strict,
    ignored,
    bestMode: strict.bestResult.returnRate >= ignored.bestResult.returnRate ? "strict" : "ignored",
  } satisfies StrategyGuideModeComparison;
});

const payload = {
  generatedAt: new Date().toISOString(),
  caseComparisonRows: buildGeneratedCaseComparisonRows(guideModeComparisons),
  guideRuleMode: "ignored" as GuideRuleMode,
  comparisons,
  comparisonsByGuideMode: {
    strict: plansToComparisonsByPureReturn(strictPlans),
    ignored: plansToComparisonsByPureReturn(ignoredPlans),
  },
  guideModeComparisons,
  optimizationPlans: ignoredPlans,
  optimizationPlansByGuideMode: {
    strict: strictPlans,
    ignored: ignoredPlans,
  },
};

const outputPath = path.join(root, "public", "market", "dashboard-results.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath)}`);

async function buildPlans(guideRuleMode: GuideRuleMode): Promise<TraderOptimizationPlan[]> {
  const plans: TraderOptimizationPlan[] = [];

  for (const strategy of strategies) {
    const optimizationPath = path.join(
      root,
      "data",
      "local",
      "traders",
      strategy.id,
      "scenarios",
      `optimization-${guideRuleMode}.json`,
    );
    const optimizationPayload = JSON.parse(await readFile(optimizationPath, "utf8")) as OptimizationPayload;
    const plan = optimizationPayload.plan;
    const candlesByMarket = await loadCandlesForOptimization(optimizationPayload);
    const selectedMarkets = plan.selectedMarkets.map((item) => ({
      ...item,
      bestResult: hydrateSelectedBacktestResult(strategy, guideRuleMode, item.bestResult, candlesByMarket),
    }));

    plans.push({
      ...plan,
      guideRuleMode,
      monitoringMarketCount: selectedMarkets.length,
      candidateMarkets: plan.candidateMarkets,
      optimizedMarkets: plan.optimizedMarkets.map((item) => ({
        ...item,
        bestResult: hydrateBacktestResult(item.bestResult),
      })),
      selectedMarkets,
    });
  }

  return plans;
}

function hydrateBacktestResult(result: BacktestResult): BacktestResult {
  return {
    ...result,
    trades: result.trades ?? [],
    signalAudit: result.signalAudit ?? [],
    equityCurve: result.equityCurve ?? [],
  };
}

function hydrateSelectedBacktestResult(
  strategy: Strategy,
  guideRuleMode: GuideRuleMode,
  result: BacktestResult,
  candlesByMarket: Record<string, Candle[]>,
): BacktestResult {
  const candles = candlesByMarket[result.market] ?? [];
  if (candles.length === 0) return hydrateBacktestResult(result);
  resultCandles.set(resultCandleKey(result), candles);

  return runBacktest(
    strategy,
    {
      id: result.scenarioId,
      traderId: strategy.id,
      name: result.scenarioName,
      description: "Persisted optimized scenario",
      params: result.scenarioParams,
    },
    candles,
    {
      ...defaultBacktestConfig,
      guideRuleMode,
    },
  );
}

function plansToComparisonsByPureReturn(plans: TraderOptimizationPlan[]): StrategyComparison[] {
  return plans
    .map(planToComparisonByPureReturn)
    .filter((comparison): comparison is StrategyComparison => comparison !== null)
    .sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate);
}

async function loadCandlesForOptimization(payload: OptimizationPayload) {
  const configuredPath = payload.marketCache?.path
    ? path.resolve(root, payload.marketCache.path)
    : path.join(root, "data", "market", "upbit-krw-1m-backtracking.json");
  const cachePath = [
    path.relative(root, configuredPath),
    payload.marketCache?.windowStart ?? "",
    payload.marketCache?.windowEnd ?? "",
  ].join("|");
  if (candleCache.has(cachePath)) return candleCache.get(cachePath) ?? {};
  const cache = JSON.parse(await readFile(configuredPath, "utf8")) as MarketCachePayload;
  const rawCandles = cache.candlesByMarket ?? {};
  const windowStart = parseOptionalTime(payload.marketCache?.windowStart);
  const windowEnd = parseOptionalTime(payload.marketCache?.windowEnd);
  const candles = windowStart !== undefined && windowEnd !== undefined
    ? sliceCandlesByWindow(rawCandles, windowStart, windowEnd)
    : rawCandles;
  candleCache.set(cachePath, candles);
  return candles;
}

function buildGeneratedCaseComparisonRows(guideModeComparisons: StrategyGuideModeComparison[]) {
  return guideModeComparisons.map((comparison) => {
    const cases = [
      buildGeneratedCaseMetric(comparison.strict.bestResult, "enabled"),
      buildGeneratedCaseMetric(comparison.strict.bestResult, "disabled"),
      buildGeneratedCaseMetric(comparison.ignored.bestResult, "enabled"),
      buildGeneratedCaseMetric(comparison.ignored.bestResult, "disabled"),
    ];
    const bestCase = cases.reduce((best, current) => (current.returnRate > best.returnRate ? current : best));
    return {
      bestCase,
      cases,
      strategyName: comparison.strategyName,
    };
  });
}

function buildGeneratedCaseMetric(result: BacktestResult, autoBlockMode: SafetyMode) {
  if (autoBlockMode === "disabled") {
    return {
      autoBlockMode,
      blocked: 0,
      guideMode: result.guideRuleMode,
      label: `${formatGuideModeLabel(result.guideRuleMode)} / Safety X`,
      maxDrawdown: result.maxDrawdown,
      returnRate: result.returnRate,
      trades: result.tradeCount,
    };
  }

  const candles = resultCandles.get(resultCandleKey(result)) ?? [];
  const safeTrades = filterTradesBySafety(result, candles);
  const equity = rebuildEquityCurve(safeTrades, candles);
  const initialCash = defaultBacktestConfig.initialCash;
  const finalValue = equity[equity.length - 1]?.value ?? initialCash;

  return {
    autoBlockMode,
    blocked: countBlockedBuysBySafety(result),
    guideMode: result.guideRuleMode,
    label: `${formatGuideModeLabel(result.guideRuleMode)} / Safety O`,
    maxDrawdown: getEquityMaxDrawdown(equity),
    returnRate: (finalValue - initialCash) / initialCash,
    trades: safeTrades.length,
  };
}

function filterTradesBySafety(result: BacktestResult, candles: Candle[]) {
  if (candles.length === 0) return result.trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  const safeTrades: Trade[] = [];
  let includesOpenPosition = false;

  for (const trade of result.trades.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    if (trade.side === "buy") {
      const candleIndex = findCandleIndexAtOrBefore(candles, trade.timestamp);
      const candlesUntilTrade = candleIndex >= 0 ? candles.slice(0, candleIndex + 1) : candles;
      const currentReturn = candleIndex >= 0 ? getDailyReturnAtCandleIndex(candles, candleIndex) : 0;
      const blocked = evaluateSafetyBlock(result, candlesUntilTrade, currentReturn).blocked;
      includesOpenPosition = !blocked;
      if (!blocked) safeTrades.push(trade);
      continue;
    }

    if (includesOpenPosition) {
      safeTrades.push(trade);
      includesOpenPosition = false;
    }
  }

  return safeTrades;
}

function countBlockedBuysBySafety(result: BacktestResult) {
  const candles = resultCandles.get(resultCandleKey(result)) ?? [];
  if (candles.length === 0) return 0;
  let blocked = 0;
  for (const trade of result.trades) {
    if (trade.side !== "buy") continue;
    const candleIndex = findCandleIndexAtOrBefore(candles, trade.timestamp);
    const candlesUntilTrade = candleIndex >= 0 ? candles.slice(0, candleIndex + 1) : candles;
    const currentReturn = candleIndex >= 0 ? getDailyReturnAtCandleIndex(candles, candleIndex) : 0;
    if (evaluateSafetyBlock(result, candlesUntilTrade, currentReturn).blocked) blocked += 1;
  }
  return blocked;
}

function rebuildEquityCurve(trades: Trade[], candles: Candle[]) {
  const sortedTrades = trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  let tradeIndex = 0;
  let cash = defaultBacktestConfig.initialCash;
  let position: { quantity: number } | null = null;

  return candles.map((candle) => {
    while (tradeIndex < sortedTrades.length && sortedTrades[tradeIndex].timestamp <= candle.timestamp) {
      const trade = sortedTrades[tradeIndex];
      if (trade.side === "buy" && !position) {
        cash -= trade.price * trade.quantity + trade.fee;
        position = { quantity: trade.quantity };
      } else if (trade.side === "sell" && position) {
        cash += trade.price * trade.quantity - trade.fee;
        position = null;
      }
      tradeIndex += 1;
    }

    return {
      timestamp: candle.timestamp,
      value: cash + (position ? position.quantity * candle.close : 0),
    };
  });
}

function getEquityMaxDrawdown(equity: Array<{ value: number }>) {
  let peak = equity[0]?.value ?? 0;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.max(maxDrawdown, peak === 0 ? 0 : (peak - point.value) / peak);
  }
  return maxDrawdown;
}

function formatGuideModeLabel(mode: GuideRuleMode) {
  return mode === "strict" ? "Guideline O" : "Guideline X";
}

function findCandleIndexAtOrBefore(candles: Candle[], timestamp: number) {
  let left = 0;
  let right = candles.length - 1;
  let found = -1;
  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle].timestamp <= timestamp) {
      found = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }
  return found;
}

function resultCandleKey(result: BacktestResult) {
  return `${result.strategyId}:${result.guideRuleMode}:${result.market}:${result.scenarioId}`;
}

function parseOptionalTime(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function sliceCandlesByWindow(candlesByMarket: Record<string, Candle[]>, windowStart: number, windowEnd: number) {
  return Object.fromEntries(
    Object.entries(candlesByMarket).map(([market, candles]) => [
      market,
      candles.filter((candle) => candle.timestamp >= windowStart && candle.timestamp < windowEnd),
    ]),
  );
}
