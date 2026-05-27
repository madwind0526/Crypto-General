import type { BacktestConfig, BacktestResult, Candle, GuideRuleMode, Strategy } from "../types/trading";
import { defaultBacktestConfig, runBacktest } from "./backtest";

export interface StrategyComparison {
  strategyName: string;
  bestResult: BacktestResult;
  testedMarkets: number;
  testedScenarios: number;
}

export interface StrategyGuideModeComparison {
  strategyName: string;
  ignored: StrategyComparison;
  strict: StrategyComparison;
  bestMode: GuideRuleMode;
}

export function compareStrategies(
  strategies: Strategy[],
  marketCandles: Record<string, Candle[]>,
  config?: BacktestConfig,
): StrategyComparison[] {
  return strategies.flatMap((strategy) => {
    const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
    const validMarketCandles = Object.values(marketCandles).filter((candles) => candles.length > 60);
    const results = validMarketCandles
      .flatMap((candles) => scenarios.map((scenario) => runBacktest(strategy, scenario, candles, config)));

    if (results.length === 0) return [];

    const bestResult = results.reduce((best, current) =>
      scoreBacktestResult(current) > scoreBacktestResult(best) ? current : best,
    );

    return {
      strategyName: strategy.name,
      bestResult,
      testedMarkets: validMarketCandles.length,
      testedScenarios: scenarios.length,
    };
  });
}

export function compareStrategiesByGuideMode(
  strategies: Strategy[],
  marketCandles: Record<string, Candle[]>,
  config?: BacktestConfig,
): StrategyGuideModeComparison[] {
  const baseConfig = config ?? defaultBacktestConfig;
  const ignored = compareStrategies(strategies, marketCandles, {
    ...baseConfig,
    guideRuleMode: "ignored",
  });
  const strict = compareStrategies(strategies, marketCandles, {
    ...baseConfig,
    guideRuleMode: "strict",
  });

  return strategies.flatMap((strategy) => {
    const ignoredComparison = ignored.find((comparison) => comparison.bestResult.strategyId === strategy.id);
    const strictComparison = strict.find((comparison) => comparison.bestResult.strategyId === strategy.id);
    if (!ignoredComparison || !strictComparison) {
      return [];
    }

    return {
      strategyName: strategy.name,
      ignored: ignoredComparison,
      strict: strictComparison,
      bestMode:
        compareByPureReturn(strictComparison.bestResult, ignoredComparison.bestResult) >= 0
          ? "strict"
          : "ignored",
    };
  });
}

export function scoreBacktestResult(result: BacktestResult): number {
  const drawdownPenalty = result.maxDrawdown * 1.5;
  const activityPenalty = result.tradeCount < 2 ? 0.08 : 0;
  // Clamp profitFactor contribution so a single lucky trade doesn't dominate.
  const pfBonus = Math.min(result.profitFactor, 3) * 0.03;
  return result.returnRate - drawdownPenalty + result.winRate * 0.05 + pfBonus - activityPenalty;
}

function compareByPureReturn(current: BacktestResult, best: BacktestResult) {
  return current.returnRate - best.returnRate;
}
