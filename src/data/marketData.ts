import { createSampleMarketSet } from "./sampleData";
import type { StrategyComparison, StrategyGuideModeComparison } from "../simulation/optimizer";
import type { TraderOptimizationPlan } from "../simulation/traderOptimization";
import type { Candle } from "../types/trading";

export interface DashboardMarketData {
  source: string;
  generatedAt: string;
  markets: string[];
  candlesByMarket: Record<string, Candle[]>;
  isRealUpbitData: boolean;
}

export interface DashboardResults {
  generatedAt: string;
  comparisons: StrategyComparison[];
  comparisonsByGuideMode?: Record<"strict" | "ignored", StrategyComparison[]>;
  guideModeComparisons: StrategyGuideModeComparison[];
  optimizationPlans: TraderOptimizationPlan[];
  optimizationPlansByGuideMode?: Record<"strict" | "ignored", TraderOptimizationPlan[]>;
}

interface UpbitMarketCachePayload {
  source: string;
  generatedAt: string;
  candleUnitMinutes: number;
  dashboardWindowCandles?: number;
  selectedMarkets: string[];
  candlesByMarket: Record<string, Candle[]>;
}

export async function loadDashboardMarketData(): Promise<DashboardMarketData> {
  const cached = await loadUpbitPublicCache();
  if (cached) {
    return {
      source: `${cached.source}:${cached.candleUnitMinutes}m`,
      generatedAt: cached.generatedAt,
      markets: cached.selectedMarkets,
      candlesByMarket: cached.candlesByMarket,
      isRealUpbitData: true,
    };
  }

  return loadSampleMarketData();
}

export function loadSampleMarketData(): DashboardMarketData {
  const sample = createSampleMarketSet();
  return {
    source: "sample",
    generatedAt: "",
    markets: Object.keys(sample),
    candlesByMarket: sample,
    isRealUpbitData: false,
  };
}

export async function loadDashboardResults(): Promise<DashboardResults | null> {
  try {
    const response = await fetch("/market/dashboard-results.json", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as DashboardResults;
  } catch {
    return null;
  }
}

async function loadUpbitPublicCache(): Promise<UpbitMarketCachePayload | null> {
  const dashboardCache = await fetchMarketCache("/market/upbit-krw-5m-dashboard.json");
  if (dashboardCache) return dashboardCache;
  return fetchMarketCache("/market/upbit-krw-5m.json");
}

async function fetchMarketCache(url: string): Promise<UpbitMarketCachePayload | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as UpbitMarketCachePayload;
  } catch {
    return null;
  }
}
