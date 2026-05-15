import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
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
const marketCachePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-5m.json");
const outputRoot = path.join(root, "data", "local", "traders");
const candidateMarketCount = Number(process.env.CANDIDATE_MARKET_COUNT ?? 30);
const monitoringMarketCount = Number(process.env.MONITORING_MARKET_COUNT ?? 30);
const optimizationLookbackCandles = Number(process.env.OPTIMIZATION_MAX_CANDLES ?? 3000);

const payload = JSON.parse(await readFile(marketCachePath, "utf8")) as MarketCachePayload;
const generatedAt = new Date().toISOString();

for (const strategy of strategies) {
  await persistStrategy(strategy, payload, generatedAt);
}

console.log(`Persisted trader plans under ${path.relative(root, outputRoot)}`);

async function persistStrategy(strategy: Strategy, payload: MarketCachePayload, generatedAt: string) {
  const traderDir = path.join(outputRoot, strategy.id);
  const marketParamsDir = path.join(traderDir, "market-params");
  await mkdir(path.join(traderDir, "scenarios"), { recursive: true });
  await mkdir(path.join(traderDir, "simulations"), { recursive: true });
  await mkdir(marketParamsDir, { recursive: true });

  for (const guideRuleMode of guideRuleModes) {
    const plan = buildTraderOptimizationPlan(strategy, payload.candlesByMarket, {
      candidateMarketCount,
      monitoringMarketCount,
      optimizationLookbackCandles,
      guideRuleMode,
    });
    const compactPlan = compactOptimizationPlan(plan);
    const exportPayload = {
      generatedAt,
      marketCache: {
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
      strategyId: strategy.id,
      strategyName: strategy.name,
      selectedMarkets: compactPlan.selectedMarkets,
    });
    await persistMarketParams(marketParamsDir, strategy, compactPlan, guideRuleMode, generatedAt);

    if (guideRuleMode === "strict") {
      await writeJson(path.join(traderDir, "selected-symbols.json"), {
        generatedAt,
        guideRuleMode,
        strategyId: strategy.id,
        strategyName: strategy.name,
        selectedMarkets: compactPlan.selectedMarkets,
      });
    }

    console.log(
      `${strategy.id}/${guideRuleMode}: ${plan.candidateMarkets.length} candidates, ${plan.selectedMarkets.length} selected`,
    );
  }
}

async function persistMarketParams(
  marketParamsDir: string,
  strategy: Strategy,
  plan: ReturnType<typeof compactOptimizationPlan>,
  guideRuleMode: GuideRuleMode,
  generatedAt: string,
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
      lookbackCandles: optimizationLookbackCandles,
      source: "daily-top-30-backtracking",
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
