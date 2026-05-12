import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { scoreBacktestResult, type StrategyComparison, type StrategyGuideModeComparison } from "../src/simulation/optimizer";
import type { TraderOptimizationPlan } from "../src/simulation/traderOptimization";
import { strategies } from "../src/strategies";
import type { BacktestResult, GuideRuleMode, Strategy } from "../src/types/trading";

interface CompactSelectedPayload {
  generatedAt: string;
  guideRuleMode: GuideRuleMode;
  strategyId: Strategy["id"];
  strategyName: string;
  selectedMarkets: Array<{
    market: string;
    candidateRank: number;
    tradeValue: number;
    score: number;
    bestResult: BacktestResult;
  }>;
}

const root = process.cwd();
const strictPlans = await buildPlans("strict");
const ignoredPlans = await buildPlans("ignored");
const comparisons = strictPlans.map(planToComparison).sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate);
const guideModeComparisons = strictPlans.map((strictPlan) => {
  const ignoredPlan = ignoredPlans.find((plan) => plan.strategyId === strictPlan.strategyId);
  if (!ignoredPlan) throw new Error(`Missing ignored plan for ${strictPlan.strategyId}`);
  const strict = planToComparison(strictPlan);
  const ignored = planToComparison(ignoredPlan);
  return {
    strategyName: strictPlan.strategyName,
    strict,
    ignored,
    bestMode: scoreBacktestResult(strict.bestResult) >= scoreBacktestResult(ignored.bestResult) ? "strict" : "ignored",
  } satisfies StrategyGuideModeComparison;
});

const payload = {
  generatedAt: new Date().toISOString(),
  guideRuleMode: "strict" as GuideRuleMode,
  comparisons,
  comparisonsByGuideMode: {
    strict: strictPlans.map(planToComparison).sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate),
    ignored: ignoredPlans.map(planToComparison).sort((a, b) => b.bestResult.returnRate - a.bestResult.returnRate),
  },
  guideModeComparisons,
  optimizationPlans: strictPlans,
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
    const selectedPath = path.join(root, "data", "local", "traders", strategy.id, `selected-symbols.${guideRuleMode}.json`);
    const selectedPayload = JSON.parse(await readFile(selectedPath, "utf8")) as CompactSelectedPayload;
    const selectedMarkets = selectedPayload.selectedMarkets.map((item) => {
      return {
        market: item.market,
        candidateRank: item.candidateRank,
        tradeValue: item.tradeValue,
        score: item.score,
        bestResult: hydrateBacktestResult(item.bestResult),
      };
    });

    plans.push({
      strategyId: strategy.id,
      strategyName: strategy.name,
      guideRuleMode,
      candidateMarketCount: 30,
      monitoringMarketCount: 12,
      candidateMarkets: selectedMarkets.map((item) => ({
        market: item.market,
        tradeValue: item.tradeValue,
        candleCount: 0,
      })),
      optimizedMarkets: selectedMarkets,
      selectedMarkets,
    });
  }

  return plans;
}

function planToComparison(plan: TraderOptimizationPlan): StrategyComparison {
  const bestResult = plan.selectedMarkets.reduce((best, current) =>
    scoreBacktestResult(current.bestResult) > scoreBacktestResult(best.bestResult) ? current : best,
  ).bestResult;

  return {
    strategyName: plan.strategyName,
    bestResult,
    testedMarkets: plan.selectedMarkets.length,
    testedScenarios: 1,
  };
}

function hydrateBacktestResult(result: BacktestResult): BacktestResult {
  return {
    ...result,
    trades: result.trades ?? [],
    signalAudit: result.signalAudit ?? [],
    equityCurve: result.equityCurve ?? [],
  };
}
