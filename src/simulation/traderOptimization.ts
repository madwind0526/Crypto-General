import type { BacktestConfig, BacktestResult, Candle, GuideRuleMode, Strategy } from "../types/trading";
import { defaultBacktestConfig, runBacktest } from "./backtest";
import { scoreBacktestResult } from "./optimizer";

export interface MarketTradeValueRank {
  market: string;
  tradeValue: number;
  candleCount: number;
  lastPrice?: number;
}

export interface MarketScenarioOptimization {
  market: string;
  candidateRank: number;
  tradeValue: number;
  score: number;
  bestResult: BacktestResult;
}

export interface TraderOptimizationOptions {
  candidateMarketCount: number;
  monitoringMarketCount: number;
  tradeValueLookbackCandles: number;
  optimizationLookbackCandles: number;
  minCandles: number;
  guideRuleMode: GuideRuleMode;
  config?: BacktestConfig;
  /** Minimum last-candle close price to include a market (inclusive). Default: 100 */
  minPrice?: number;
  /** Maximum last-candle close price to include a market (inclusive). Default: 10000 */
  maxPrice?: number;
}

export interface TraderOptimizationPlan {
  strategyId: Strategy["id"];
  strategyName: string;
  guideRuleMode: GuideRuleMode;
  candidateMarketCount: number;
  monitoringMarketCount: number;
  candidateMarkets: MarketTradeValueRank[];
  optimizedMarkets: MarketScenarioOptimization[];
  selectedMarkets: MarketScenarioOptimization[];
}

const defaultOptions: TraderOptimizationOptions = {
  candidateMarketCount: 30,
  monitoringMarketCount: 15,
  tradeValueLookbackCandles: 1440,
  optimizationLookbackCandles: Number.POSITIVE_INFINITY,
  minCandles: 120,
  guideRuleMode: "ignored",
  minPrice: 100,
  maxPrice: 10_000,
};

export function selectTopMarketsByTradeValue(
  candlesByMarket: Record<string, Candle[]>,
  count: number,
  lookbackCandles = defaultOptions.tradeValueLookbackCandles,
  minCandles = defaultOptions.minCandles,
  minPrice = defaultOptions.minPrice,
  maxPrice = defaultOptions.maxPrice,
): MarketTradeValueRank[] {
  return Object.entries(candlesByMarket)
    .map(([market, candles]) => ({
      market,
      tradeValue: sumRecentTradeValue(candles, lookbackCandles),
      candleCount: candles.length,
      lastPrice: candles.length > 0 ? candles[candles.length - 1].close : 0,
    }))
    .filter((rank) => {
      if (rank.candleCount < minCandles || rank.tradeValue <= 0) return false;
      if (minPrice !== undefined && rank.lastPrice < minPrice) return false;
      if (maxPrice !== undefined && rank.lastPrice > maxPrice) return false;
      return true;
    })
    .sort((a, b) => b.tradeValue - a.tradeValue)
    .slice(0, count);
}

export function buildTraderOptimizationPlan(
  strategy: Strategy,
  candlesByMarket: Record<string, Candle[]>,
  options: Partial<TraderOptimizationOptions> = {},
): TraderOptimizationPlan {
  const resolved = { ...defaultOptions, ...options };
  const config = {
    ...defaultBacktestConfig,
    ...resolved.config,
    guideRuleMode: resolved.guideRuleMode,
  };
  const candidateMarkets = selectTopMarketsByTradeValue(
    candlesByMarket,
    resolved.candidateMarketCount,
    resolved.tradeValueLookbackCandles,
    resolved.minCandles,
    resolved.minPrice,
    resolved.maxPrice,
  ).filter((rank) => !strategy.excludedMarkets?.has(rank.market));

  const optimizedMarkets = candidateMarkets
    .map((candidate, index) => {
      const candles = trimCandles(candlesByMarket[candidate.market] ?? [], resolved.optimizationLookbackCandles);
      const bestResult = optimizeStrategyForMarket(strategy, candles, config);
      if (!bestResult) return null;

      return {
        market: candidate.market,
        candidateRank: index + 1,
        tradeValue: candidate.tradeValue,
        score: scoreBacktestResult(bestResult),
        bestResult,
      };
    })
    .filter((result): result is MarketScenarioOptimization => result !== null)
    .sort(compareOptimizationsByPureReturn);
  const selectedMarkets = optimizedMarkets
    .filter((m) => m.bestResult.tradeCount > 0)
    .slice(0, resolved.monitoringMarketCount);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    guideRuleMode: resolved.guideRuleMode,
    candidateMarketCount: resolved.candidateMarketCount,
    monitoringMarketCount: resolved.monitoringMarketCount,
    candidateMarkets,
    optimizedMarkets,
    selectedMarkets,
  };
}

export function compareOptimizationsByPureReturn(a: MarketScenarioOptimization, b: MarketScenarioOptimization) {
  return b.bestResult.returnRate - a.bestResult.returnRate || b.score - a.score;
}

export function buildSumOptimizationPlan(
  strategy: Strategy,
  sourcePlans: TraderOptimizationPlan[],
  candlesByMarket: Record<string, Candle[]>,
  options: Partial<TraderOptimizationOptions> = {},
): TraderOptimizationPlan {
  const resolved = { ...defaultOptions, ...options };
  const config = { ...defaultBacktestConfig, ...resolved.config, guideRuleMode: resolved.guideRuleMode };

  // Score markets by overlap: rank 1 in a plan earns planLength points, rank N earns 1 point.
  const scoreMap = new Map<string, number>();
  for (const plan of sourcePlans) {
    plan.selectedMarkets.forEach((m, idx) => {
      const rankScore = plan.selectedMarkets.length - idx;
      scoreMap.set(m.market, (scoreMap.get(m.market) ?? 0) + rankScore);
    });
  }

  const overlapCandidates: MarketTradeValueRank[] = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, resolved.candidateMarketCount)
    .map(([market, overlapScore]) => ({
      market,
      tradeValue: overlapScore,
      candleCount: candlesByMarket[market]?.length ?? 0,
      lastPrice: candlesByMarket[market]?.[candlesByMarket[market].length - 1]?.close ?? 0,
    }))
    .filter((c) => c.candleCount >= resolved.minCandles)
    .filter((c) => resolved.minPrice === undefined || c.lastPrice >= resolved.minPrice)
    .filter((c) => resolved.maxPrice === undefined || c.lastPrice <= resolved.maxPrice)
    .filter((c) => !strategy.excludedMarkets?.has(c.market));

  const optimizedMarkets = overlapCandidates
    .map((candidate, index) => {
      const candles = trimCandles(candlesByMarket[candidate.market] ?? [], resolved.optimizationLookbackCandles);
      const bestResult = optimizeStrategyForMarket(strategy, candles, config);
      if (!bestResult) return null;
      return {
        market: candidate.market,
        candidateRank: index + 1,
        tradeValue: candidate.tradeValue,
        score: scoreBacktestResult(bestResult),
        bestResult,
      };
    })
    .filter((result): result is MarketScenarioOptimization => result !== null)
    .sort(compareOptimizationsByPureReturn);

  const selectedMarkets = optimizedMarkets
    .filter((m) => m.bestResult.tradeCount > 0)
    .slice(0, resolved.monitoringMarketCount);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    guideRuleMode: resolved.guideRuleMode,
    candidateMarketCount: resolved.candidateMarketCount,
    monitoringMarketCount: resolved.monitoringMarketCount,
    candidateMarkets: overlapCandidates,
    optimizedMarkets,
    selectedMarkets,
  };
}

export function buildTraderOptimizationPlans(
  strategies: Strategy[],
  candlesByMarket: Record<string, Candle[]>,
  options: Partial<TraderOptimizationOptions> = {},
): TraderOptimizationPlan[] {
  return strategies.map((strategy) => buildTraderOptimizationPlan(strategy, candlesByMarket, options));
}

function optimizeStrategyForMarket(
  strategy: Strategy,
  candles: Candle[],
  config: BacktestConfig,
): BacktestResult | null {
  if (candles.length === 0) return null;
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  if (scenarios.length === 0 || !scenarios[0]) return null;
  const results = scenarios.map((scenario) => runBacktest(strategy, scenario, candles, config));
  return results.reduce((best, current) =>
    scoreBacktestResult(current) > scoreBacktestResult(best) ? current : best,
  );
}

function sumRecentTradeValue(candles: Candle[], lookbackCandles: number) {
  return candles
    .slice(Math.max(0, candles.length - lookbackCandles))
    .reduce((sum, candle) => sum + candle.quoteVolume, 0);
}

function trimCandles(candles: Candle[], maxCandles: number) {
  if (!Number.isFinite(maxCandles) || maxCandles <= 0 || candles.length <= maxCandles) return candles;
  return candles.slice(candles.length - maxCandles);
}
