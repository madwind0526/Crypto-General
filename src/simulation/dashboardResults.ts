import type { StrategyComparison } from "./optimizer";
import type { TraderOptimizationPlan } from "./traderOptimization";

export function planToComparisonByPureReturn(plan: TraderOptimizationPlan): StrategyComparison | null {
  if (plan.selectedMarkets.length === 0) return null;

  const bestResult = plan.selectedMarkets.reduce((best, current) =>
    current.bestResult.returnRate > best.bestResult.returnRate ? current : best,
  ).bestResult;

  return {
    strategyName: plan.strategyName,
    bestResult,
    testedMarkets: plan.selectedMarkets.length,
    testedScenarios: 1,
  };
}
