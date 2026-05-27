import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSumOptimizationPlan, buildTraderOptimizationPlan, type TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { generalSumStrategy, strategies } from "../src/strategies";
import type { Candle, GuideRuleMode, Strategy } from "../src/types/trading";

interface MarketCachePayload {
  source: string;
  generatedAt: string;
  candleUnitMinutes: number;
  selectedMarkets: string[];
  candlesByMarket: Record<string, Candle[]>;
}

const root = process.cwd();
const guideRuleModes: GuideRuleMode[] = (process.env.GUIDE_RULE_MODES ?? "strict,ignored")
  .split(",")
  .map((mode) => mode.trim())
  .filter((mode): mode is GuideRuleMode => mode === "strict" || mode === "ignored");
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-1m-backtracking.json");
const outputRoot = path.join(root, "data", "local", "traders");
const candidateMarketCount = Number(process.env.CANDIDATE_MARKET_COUNT ?? 30);
const monitoringMarketCount = Number(process.env.MONITORING_MARKET_COUNT ?? 9);
const tradeValueLookbackCandles = Number(process.env.TRADE_VALUE_LOOKBACK_CANDLES ?? 1440);
const optimizationLookbackCandles = Number(process.env.OPTIMIZATION_MAX_CANDLES ?? 10_080);

const payload = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const generatedAt = new Date().toISOString();

// Keep full plans in memory so General-Sum can derive its overlap plan from them.
const fullPlansByMode: Partial<Record<GuideRuleMode, TraderOptimizationPlan[]>> = {};

for (const strategy of strategies) {
  const plansByMode = await persistStrategy(strategy, payload, generatedAt);
  for (const [mode, plan] of Object.entries(plansByMode) as [GuideRuleMode, TraderOptimizationPlan][]) {
    if (!fullPlansByMode[mode]) fullPlansByMode[mode] = [];
    fullPlansByMode[mode]!.push(plan);
  }
}

// Persist General-Sum plan (overlap of base strategy plans).
for (const guideRuleMode of guideRuleModes) {
  const basePlans = fullPlansByMode[guideRuleMode] ?? [];
  if (basePlans.length === 0) continue;
  const sumPlan = buildSumOptimizationPlan(generalSumStrategy, basePlans, payload.candlesByMarket, {
    candidateMarketCount,
    monitoringMarketCount,
    tradeValueLookbackCandles,
    optimizationLookbackCandles,
    guideRuleMode,
  });
  await persistSumPlan(sumPlan, payload, guideRuleMode, generatedAt);
}

console.log(`Persisted trader plans under ${path.relative(root, outputRoot)}`);

async function persistStrategy(
  strategy: Strategy,
  payload: MarketCachePayload,
  generatedAt: string,
): Promise<Partial<Record<GuideRuleMode, TraderOptimizationPlan>>> {
  const traderDir = path.join(outputRoot, strategy.id);
  const marketParamsDir = path.join(traderDir, "market-params");
  await mkdir(path.join(traderDir, "scenarios"), { recursive: true });
  await mkdir(path.join(traderDir, "simulations"), { recursive: true });
  await mkdir(marketParamsDir, { recursive: true });

  const result: Partial<Record<GuideRuleMode, TraderOptimizationPlan>> = {};

  for (const guideRuleMode of guideRuleModes) {
    const plan = buildTraderOptimizationPlan(strategy, payload.candlesByMarket, {
      candidateMarketCount,
      monitoringMarketCount,
      tradeValueLookbackCandles,
      optimizationLookbackCandles,
      guideRuleMode,
    });
    result[guideRuleMode] = plan;
    await savePlanFiles(strategy.id, strategy.name, plan, payload, guideRuleMode, generatedAt);
    console.log(
      `${strategy.id}/${guideRuleMode}: ${plan.candidateMarkets.length} candidates, ${plan.selectedMarkets.length} selected`,
    );
  }

  return result;
}

async function persistSumPlan(
  plan: TraderOptimizationPlan,
  payload: MarketCachePayload,
  guideRuleMode: GuideRuleMode,
  generatedAt: string,
) {
  await savePlanFiles(plan.strategyId, plan.strategyName, plan, payload, guideRuleMode, generatedAt);
  console.log(
    `${plan.strategyId}/${guideRuleMode}: ${plan.candidateMarkets.length} overlap candidates, ${plan.selectedMarkets.length} selected`,
  );
}

async function savePlanFiles(
  strategyId: string,
  strategyName: string,
  plan: TraderOptimizationPlan,
  payload: MarketCachePayload,
  guideRuleMode: GuideRuleMode,
  generatedAt: string,
) {
  const traderDir = path.join(outputRoot, strategyId);
  const marketParamsDir = path.join(traderDir, "market-params");
  await mkdir(path.join(traderDir, "scenarios"), { recursive: true });
  await mkdir(marketParamsDir, { recursive: true });

  const compactPlan = compactOptimizationPlan(plan);
  const exportPayload = {
    generatedAt,
    marketCache: {
      path: path.relative(root, marketCachePath),
      source: payload.source,
      generatedAt: payload.generatedAt,
      candleUnitMinutes: payload.candleUnitMinutes,
      cachedMarketCount: payload.selectedMarkets.length,
    },
    plan: compactPlan,
  };
  const scenarioPath = path.join(traderDir, "scenarios", `optimization-${guideRuleMode}.json`);
  const selectedPath = path.join(traderDir, `selected-symbols.${guideRuleMode}.json`);
  await writeJson(scenarioPath, exportPayload);
  await writeJson(selectedPath, {
    generatedAt,
    guideRuleMode,
    strategyId,
    strategyName,
    selectedMarkets: compactPlan.selectedMarkets,
  });
  await persistMarketParams(marketParamsDir, strategyId, compactPlan, guideRuleMode, generatedAt);

  if (guideRuleMode === "ignored") {
    await writeJson(path.join(traderDir, "selected-symbols.json"), {
      generatedAt,
      guideRuleMode,
      strategyId,
      strategyName,
      selectedMarkets: compactPlan.selectedMarkets,
    });
  }
}

async function persistMarketParams(
  marketParamsDir: string,
  strategyId: string,
  plan: ReturnType<typeof compactOptimizationPlan>,
  guideRuleMode: GuideRuleMode,
  generatedAt: string,
) {
  for (const item of plan.selectedMarkets) {
    await writeJson(path.join(marketParamsDir, `${item.market}.${guideRuleMode}.json`), {
      generatedAt,
      guideRuleMode,
      market: item.market,
      strategyId,
      scenarioId: item.bestResult.scenarioId,
      scenarioName: item.bestResult.scenarioName,
      params: item.bestResult.scenarioParams,
      lookbackCandles: optimizationLookbackCandles,
      tradeValueLookbackCandles,
      source: "1m-7d-backtracking",
    });
  }
}

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function compactOptimizationPlan(plan: ReturnType<typeof buildTraderOptimizationPlan>) {
  return {
    ...plan,
    optimizedMarkets: plan.optimizedMarkets.map(compactMarketOptimization),
    selectedMarkets: plan.selectedMarkets.map(compactMarketOptimization),
  };
}

function compactMarketOptimization(item: ReturnType<typeof buildTraderOptimizationPlan>["optimizedMarkets"][number]) {
  return {
    market: item.market,
    candidateRank: item.candidateRank,
    tradeValue: item.tradeValue,
    score: item.score,
    bestResult: {
      strategyId: item.bestResult.strategyId,
      scenarioId: item.bestResult.scenarioId,
      scenarioName: item.bestResult.scenarioName,
      scenarioParams: item.bestResult.scenarioParams,
      market: item.bestResult.market,
      finalValue: item.bestResult.finalValue,
      returnRate: item.bestResult.returnRate,
      maxDrawdown: item.bestResult.maxDrawdown,
      winRate: item.bestResult.winRate,
      tradeCount: item.bestResult.tradeCount,
      profitFactor: item.bestResult.profitFactor,
      worstTradeReturn: item.bestResult.worstTradeReturn,
      guideRuleMode: item.bestResult.guideRuleMode,
      guideRejectedSignals: item.bestResult.guideRejectedSignals,
    },
  };
}
