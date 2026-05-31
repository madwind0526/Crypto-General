import { evaluateGuideRules } from "../guideRules/evaluator";
import type {
  BacktestConfig,
  BlockedSignal,
  Candle,
  GuideRuleMode,
  Position,
  SafetyMode,
  Strategy,
  StrategyScenario,
  Trade,
} from "../types/trading";
import { defaultBacktestConfig } from "./backtest";
import { decideDailyOperation, type DailyOperationDecision, type DailySignal } from "./dailyOperation";
import { evaluateSafetyBlock, getDailyReturnAtCandleIndex } from "./safety";
import type { TraderOptimizationPlan } from "./traderOptimization";

export interface PaperTradingOptions {
  autoBlockMode: SafetyMode;
  guideRuleMode: GuideRuleMode;
  maxCandles: number;
  startAt: number | null;
  config: BacktestConfig;
}

export interface PaperTradingDecisionLog {
  timestamp: number;
  action: DailyOperationDecision["action"];
  buyMarket?: string;
  sellMarket?: string;
  portfolioValue: number;
  cash: number;
  positionMarket?: string;
  reasonCodes: string[];
}

export interface PaperTradingResult {
  strategyId: Strategy["id"];
  strategyName: string;
  guideRuleMode: GuideRuleMode;
  startedAt: number;
  endedAt: number;
  initialCash: number;
  finalValue: number;
  returnRate: number;
  autoBlockMode: SafetyMode;
  safetyBlockedSignals: number;
  safetyBlockedByMarket: Record<string, number>;
  blockedSignals: BlockedSignal[];
  trades: Trade[];
  decisions: PaperTradingDecisionLog[];
  equityCurve: Array<{ timestamp: number; value: number }>;
}

export interface PaperTradingStepOptions {
  executionPrices?: Map<string, number>;
  riskMarkets?: Set<string>;
  signalMarkets?: Set<string>;
}

const defaultOptions: PaperTradingOptions = {
  autoBlockMode: "disabled",
  guideRuleMode: "strict",
  maxCandles: 288,
  startAt: null,
  config: defaultBacktestConfig,
};

export class PaperTradingSession {
  readonly initialCash: number;
  readonly selectedMarkets: TraderOptimizationPlan["selectedMarkets"];

  private cash: number;
  private readonly config: BacktestConfig;
  private readonly slip: (price: number) => number;
  private readonly guideRuleMode: GuideRuleMode;
  private readonly autoBlockMode: SafetyMode;
  private readonly scenarioById: Map<string, StrategyScenario>;
  private readonly marketPointers = new Map<string, number>();
  private position: Position | null = null;
  private lastSellPriceByMarket = new Map<string, number>();
  private lastPositionCandleTimestamp: number | null = null;
  private trades: Trade[] = [];
  private decisions: PaperTradingDecisionLog[] = [];
  private equityCurve: Array<{ timestamp: number; value: number }> = [];
  private safetyBlockedSignals = 0;
  private safetyBlockedByMarket: Record<string, number> = {};
  private blockedSignals: BlockedSignal[] = [];

  constructor(
    private readonly strategy: Strategy,
    private readonly plan: TraderOptimizationPlan,
    options: Partial<PaperTradingOptions> = {},
  ) {
    const resolved = resolveOptions(options);
    this.config = resolved.config;
    this.slip = (price: number) => resolved.config.dynamicSlippage ? resolved.config.dynamicSlippage(price) : resolved.config.slippageRate;
    this.guideRuleMode = resolved.guideRuleMode;
    this.autoBlockMode = resolved.autoBlockMode;
    this.initialCash = resolved.config.initialCash;
    this.cash = resolved.config.initialCash;
    this.selectedMarkets = plan.selectedMarkets;
    this.scenarioById = getScenarioById(strategy);
  }

  step(
    timestamp: number,
    candlesByMarket: Record<string, Candle[]>,
    options: PaperTradingStepOptions = {},
  ): DailyOperationDecision {
    const signals: DailySignal[] = [];
    const candlesAtTime = new Map<string, { candle: Candle; candleIndex: number }>();

    for (const selected of this.selectedMarkets) {
      const candles = candlesByMarket[selected.market] ?? [];
      const candleIndex = findCandleIndexAtOrBefore(candles, timestamp, this.marketPointers.get(selected.market) ?? 0);
      if (candleIndex < 0) continue;
      this.marketPointers.set(selected.market, candleIndex);
      const candle = candles[candleIndex];
      candlesAtTime.set(selected.market, { candle, candleIndex });
    }

    const riskExitedMarkets = this.updateOpenPosition(candlesAtTime, timestamp, options.riskMarkets);

    if (riskExitedMarkets.size === 0) {
      for (const selected of this.selectedMarkets) {
      if (options.signalMarkets && !options.signalMarkets.has(selected.market)) continue;
      if (riskExitedMarkets.has(selected.market)) continue;
      const candleInfo = candlesAtTime.get(selected.market);
      if (!candleInfo) continue;

      const { candleIndex } = candleInfo;
      const candles = candlesByMarket[selected.market] ?? [];
      const scenario = this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
      const marketPosition = this.position?.market === selected.market ? this.position : null;
      const decision = this.strategy.decide(
        {
          market: selected.market,
          candles,
          candleIndex,
          lastSellPrice: this.lastSellPriceByMarket.get(selected.market),
          position: marketPosition,
          portfolioValue: this.getPortfolioValue(candlesAtTime),
        },
        scenario,
      );
      const guideRuleEvaluation = evaluateGuideRules({
        candles,
        candleIndex,
        decision,
        mode: this.guideRuleMode,
      });
      let finalAction = decision.action;
      const guideBlocked = decision.action === "buy" && this.guideRuleMode === "strict" && !guideRuleEvaluation.passed;
      if (guideBlocked) {
        finalAction = "hold";
        this.blockedSignals.push({
          market: selected.market,
          timestamp,
          reason: "guide-rule",
          reasonCodes: [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
          guideRuleMode: this.guideRuleMode,
          safetyMode: this.autoBlockMode,
        });
      }
      if (decision.action === "buy" && !guideBlocked && this.autoBlockMode === "enabled") {
        const candlesUntilDecision = candles.slice(0, candleIndex + 1);
        const currentReturn = getDailyReturnAtCandleIndex(candles, candleIndex);
        const safetyEvaluation = evaluateSafetyBlock(selected.bestResult, candlesUntilDecision, currentReturn);
        if (safetyEvaluation.blocked) {
          finalAction = "hold";
          this.safetyBlockedSignals += 1;
          this.safetyBlockedByMarket[selected.market] = (this.safetyBlockedByMarket[selected.market] ?? 0) + 1;
          this.blockedSignals.push({
            market: selected.market,
            timestamp,
            reason: "safety",
            reasonCodes: [...decision.reasonCodes, ...guideRuleEvaluation.reasons, ...safetyEvaluation.reasons],
            guideRuleMode: this.guideRuleMode,
            safetyMode: this.autoBlockMode,
          });
        }
      }

      if (finalAction !== "hold") {
        signals.push({
          market: selected.market,
          action: finalAction,
          strength: decision.confidence,
          qualityScore: scoreSelectedMarket(selected.score, selected.bestResult.returnRate, selected.bestResult.maxDrawdown),
          timestamp,
          reasonCodes: [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
        });
      }
      }
    }

    const decision = decideDailyOperation({
      currentPosition: this.position
        ? {
            market: this.position.market,
            entryPrice: this.position.averagePrice,
            currentPrice: candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice,
            quantity: this.position.quantity,
            openedAt: this.position.openedAt,
          }
        : null,
      now: timestamp,
      options: this.strategy.id === "general-d" || this.strategy.id === "general-e"
        ? { rotationAdvantage: Number.POSITIVE_INFINITY }
        : undefined,
      signals,
    });

    if ((decision.action === "sell" || decision.action === "rotate") && this.position) {
      const candle = candlesAtTime.get(this.position.market)?.candle;
      if (candle) {
        const basePrice = options.executionPrices?.get(this.position.market) ?? candle.close;
        const exitPrice = basePrice * (1 - this.slip(basePrice));
        this.cash += this.closePosition(this.position, exitPrice, timestamp, decision.reasonCodes);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
      }
    }

    if ((decision.action === "buy" || decision.action === "rotate") && decision.buyMarket && !this.position) {
      const candle = candlesAtTime.get(decision.buyMarket)?.candle;
      if (candle && this.cash > 0) {
        const budget = this.cash;
        const basePrice = options.executionPrices?.get(decision.buyMarket) ?? candle.close;
        const fillPrice = basePrice * (1 + this.slip(basePrice));
        const fee = budget * this.config.feeRate;
        const quantity = Math.max(0, (budget - fee) / fillPrice);
        if (quantity > 0) {
          this.cash -= budget;
          this.position = {
            market: decision.buyMarket,
            quantity,
            averagePrice: fillPrice,
            openedAt: timestamp,
            highestPrice: fillPrice,
            holdCandles: 0,
          };
          this.lastPositionCandleTimestamp = candlesAtTime.get(decision.buyMarket)?.candle.timestamp ?? null;
          this.trades.push({
            market: decision.buyMarket,
            side: "buy",
            timestamp,
            price: fillPrice,
            quantity,
            fee,
            reasonCodes: decision.reasonCodes,
            guideRuleMode: this.guideRuleMode,
          });
        }
      }
    }

    const portfolioValue = this.getPortfolioValue(candlesAtTime);
    this.decisions.push({
      timestamp,
      action: decision.action,
      buyMarket: decision.buyMarket,
      sellMarket: decision.sellMarket,
      portfolioValue,
      cash: this.cash,
      positionMarket: this.position?.market,
      reasonCodes: decision.reasonCodes,
    });
    this.equityCurve.push({ timestamp, value: portfolioValue });
    return decision;
  }

  finalize(candlesByMarket: Record<string, Candle[]>, closeOpenPosition: boolean) {
    if (closeOpenPosition && this.position) {
      const candles = candlesByMarket[this.position.market] ?? [];
      const last = candles[this.marketPointers.get(this.position.market) ?? candles.length - 1] ?? candles[candles.length - 1];
      if (last) {
        const exitPrice = last.close * (1 - this.slip(last.close));
        this.cash += this.closePosition(this.position, exitPrice, last.timestamp, ["paper-final-close"]);
        this.lastSellPriceByMarket.set(this.position.market, exitPrice);
        this.position = null;
        this.lastPositionCandleTimestamp = null;
        this.equityCurve.push({ timestamp: last.timestamp, value: this.cash });
      }
    }

    return this.result();
  }

  result(): PaperTradingResult {
    const finalValue = this.equityCurve[this.equityCurve.length - 1]?.value ?? this.getCurrentValue();
    return {
      strategyId: this.strategy.id,
      strategyName: this.strategy.name,
      guideRuleMode: this.guideRuleMode,
      startedAt: this.equityCurve[0]?.timestamp ?? 0,
      endedAt: this.equityCurve[this.equityCurve.length - 1]?.timestamp ?? 0,
      initialCash: this.initialCash,
      finalValue,
      returnRate: (finalValue - this.initialCash) / this.initialCash,
      autoBlockMode: this.autoBlockMode,
      blockedSignals: this.blockedSignals.slice(),
      safetyBlockedByMarket: { ...this.safetyBlockedByMarket },
      safetyBlockedSignals: this.safetyBlockedSignals,
      trades: this.trades.slice(),
      decisions: this.decisions.slice(),
      equityCurve: this.equityCurve.slice(),
    };
  }

  getTradeCount() {
    return this.trades.length;
  }

  getPositionMarket() {
    return this.position?.market ?? null;
  }

  private updateOpenPosition(
    candlesAtTime: Map<string, { candle: Candle; candleIndex: number }>,
    timestamp: number,
    riskMarkets?: Set<string>,
  ) {
    const riskExitedMarkets = new Set<string>();
    if (!this.position) return riskExitedMarkets;
    if (riskMarkets && !riskMarkets.has(this.position.market)) return riskExitedMarkets;
    const candle = candlesAtTime.get(this.position.market)?.candle;
    if (!candle) return riskExitedMarkets;
    const previousHighestPrice = this.position.highestPrice;
    if (this.lastPositionCandleTimestamp !== candle.timestamp) {
      this.position.holdCandles += 1;
      this.lastPositionCandleTimestamp = candle.timestamp;
    }

    const scenario = this.getScenarioForMarket(this.position.market);
    const stopLossPct = scenario?.params.stopLossPct ?? scenario?.params.emergencyStopPct ?? 0;
    const trailingStopPct = scenario?.params.trailingStopPct ?? 0;
    const takeProfitPct = scenario?.params.takeProfitPct ?? 0;
    const stopPrice = this.position.averagePrice * (1 - stopLossPct);
    const trailingStop = previousHighestPrice * (1 - trailingStopPct);
    const takeProfit = this.position.averagePrice * (1 + takeProfitPct);
    const triggeredStops = [
      stopLossPct > 0 && candle.low <= stopPrice ? stopPrice : null,
      trailingStopPct > 0 && candle.low <= trailingStop ? trailingStop : null,
    ].filter((price): price is number => price !== null);
    const takeProfitTriggered = takeProfitPct > 0 && candle.high >= takeProfit;

    if (triggeredStops.length > 0 || takeProfitTriggered) {
      const exitedMarket = this.position.market;
      const exitBasePrice = triggeredStops.length > 0 ? Math.max(...triggeredStops) : takeProfit;
      const exitPrice = exitBasePrice * (1 - this.slip(exitBasePrice));
      this.cash += this.closePosition(this.position, exitPrice, timestamp, ["risk-rule-exit"]);
      this.lastSellPriceByMarket.set(exitedMarket, exitPrice);
      riskExitedMarkets.add(exitedMarket);
      this.position = null;
      this.lastPositionCandleTimestamp = null;
    }

    if (this.position) {
      this.position.highestPrice = Math.max(this.position.highestPrice, candle.high);
    }

    return riskExitedMarkets;
  }

  private getScenarioForMarket(market: string) {
    const selected = this.selectedMarkets.find((item) => item.market === market);
    if (!selected) return null;
    return this.scenarioById.get(selected.bestResult.scenarioId) ?? this.strategy.defaultScenario;
  }

  private getPortfolioValue(candlesAtTime: Map<string, { candle: Candle; candleIndex: number }>) {
    if (!this.position) return this.cash;
    const currentPrice = candlesAtTime.get(this.position.market)?.candle.close ?? this.position.averagePrice;
    return this.cash + this.position.quantity * currentPrice;
  }

  private getCurrentValue() {
    return this.equityCurve[this.equityCurve.length - 1]?.value ?? this.cash;
  }

  private closePosition(positionToClose: Position, price: number, timestamp: number, reasonCodes: string[]) {
    const proceeds = positionToClose.quantity * price;
    const fee = proceeds * this.config.feeRate;
    this.trades.push({
      market: positionToClose.market,
      side: "sell",
      timestamp,
      price,
      quantity: positionToClose.quantity,
      fee,
      reasonCodes,
      guideRuleMode: this.guideRuleMode,
    });
    return proceeds - fee;
  }
}

export function runPaperTradingSimulation(
  strategy: Strategy,
  plan: TraderOptimizationPlan,
  candlesByMarket: Record<string, Candle[]>,
  options: Partial<PaperTradingOptions> = {},
): PaperTradingResult {
  const resolved = resolveOptions(options);
  const selectedMarkets = plan.selectedMarkets.filter((item) => (candlesByMarket[item.market] ?? []).length > 0);
  const timestamps = getSimulationTimestamps(selectedMarkets.map((item) => candlesByMarket[item.market] ?? []))
    .filter((timestamp) => resolved.startAt === null || timestamp >= resolved.startAt)
    .slice(-resolved.maxCandles);
  const session = new PaperTradingSession(strategy, plan, resolved);

  for (const timestamp of timestamps) {
    session.step(timestamp, candlesByMarket);
  }

  return session.finalize(candlesByMarket, true);
}

function resolveOptions(options: Partial<PaperTradingOptions>) {
  return {
    ...defaultOptions,
    ...options,
    config: {
      ...defaultOptions.config,
      ...options.config,
      guideRuleMode: options.guideRuleMode ?? options.config?.guideRuleMode ?? defaultOptions.guideRuleMode,
    },
  };
}

function getScenarioById(strategy: Strategy) {
  const scenarios = strategy.scenarios?.length ? strategy.scenarios : [strategy.defaultScenario];
  return new Map<string, StrategyScenario>(scenarios.map((scenario) => [scenario.id, scenario]));
}

function getSimulationTimestamps(candleSets: Candle[][]) {
  const timestamps = new Set<number>();
  for (const candles of candleSets) {
    for (const candle of candles) timestamps.add(candle.timestamp);
  }
  return [...timestamps].sort((a, b) => a - b);
}

function findCandleIndexAtOrBefore(candles: Candle[], timestamp: number, startIndex: number) {
  if (candles.length === 0) return -1;
  const boundedStart = Math.min(Math.max(0, startIndex), candles.length - 1);
  if (candles[boundedStart].timestamp <= timestamp) {
    const nextIndex = boundedStart + 1;
    if (nextIndex >= candles.length || candles[nextIndex].timestamp > timestamp) return boundedStart;
    return findLastIndexAtOrBefore(candles, timestamp, nextIndex, candles.length - 1);
  }

  return findLastIndexAtOrBefore(candles, timestamp, 0, boundedStart);
}

function findLastIndexAtOrBefore(candles: Candle[], timestamp: number, low: number, high: number) {
  let left = low;
  let right = high;
  let result = -1;

  while (left <= right) {
    const middle = Math.floor((left + right) / 2);
    if (candles[middle].timestamp <= timestamp) {
      result = middle;
      left = middle + 1;
    } else {
      right = middle - 1;
    }
  }

  return result;
}

function scoreSelectedMarket(score: number, returnRate: number, maxDrawdown: number) {
  const normalizedScore = Number.isFinite(score) ? (Math.tanh(score) + 1) / 2 : 0.5;
  return clamp01(normalizedScore * 0.45 + clamp01(returnRate + 0.5) * 0.35 + (1 - clamp01(maxDrawdown)) * 0.2);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
