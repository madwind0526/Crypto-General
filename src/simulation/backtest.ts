import type {
  BacktestConfig,
  BacktestResult,
  Candle,
  GuideRuleEvaluation,
  GuideRuleMode,
  Position,
  SignalAudit,
  Strategy,
  StrategyScenario,
  Trade,
} from "../types/trading";
import { evaluateGuideRules } from "../guideRules/evaluator";

export const defaultBacktestConfig: BacktestConfig = {
  initialCash: 1_000_000,
  feeRate: 0.0005,
  slippageRate: 0.0005,
};

export function runBacktest(
  strategy: Strategy,
  scenario: StrategyScenario,
  candles: Candle[],
  config: BacktestConfig = defaultBacktestConfig,
): BacktestResult {
  const guideRuleMode: GuideRuleMode = config.guideRuleMode ?? "ignored";
  const slip = (price: number) => config.dynamicSlippage ? config.dynamicSlippage(price) : config.slippageRate;
  let cash = config.initialCash;
  let position: Position | null = null;
  const trades: Trade[] = [];
  const signalAudit: SignalAudit[] = [];
  const equityCurve: Array<{ timestamp: number; value: number }> = [];
  let lastSellPrice: number | undefined;
  let lastSellCandleIndex: number | undefined;
  let currentCandleIndex = 0;
  let peakValue = config.initialCash;
  let maxDrawdown = 0;
  const roundTripReturns: number[] = [];

  for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
    currentCandleIndex = candleIndex;
    const candle = candles[candleIndex];
    let riskExited = false;
    if (position) {
      position.holdCandles += 1;
      const previousHighestPrice = position.highestPrice;

      const stopLossPct = scenario.params.stopLossPct ?? scenario.params.emergencyStopPct ?? 0;
      const trailingStopPct = scenario.params.trailingStopPct ?? 0;
      const takeProfitPct = scenario.params.takeProfitPct ?? 0;
      const stopPrice = position.averagePrice * (1 - stopLossPct);
      const trailingStop = previousHighestPrice * (1 - trailingStopPct);
      const takeProfit = position.averagePrice * (1 + takeProfitPct);
      const triggeredStops = [
        stopLossPct > 0 && candle.low <= stopPrice ? stopPrice : null,
        trailingStopPct > 0 && candle.low <= trailingStop ? trailingStop : null,
      ].filter((price): price is number => price !== null);
      const takeProfitTriggered = takeProfitPct > 0 && candle.high >= takeProfit;

      if (triggeredStops.length > 0 || takeProfitTriggered) {
        // When multiple stops trigger on the same candle, use the highest price
        // (trailing stop >= fixed stop by construction, so trailing always wins — intentional).
        const exitPrice = triggeredStops.length > 0 ? Math.max(...triggeredStops) : takeProfit;
        const roundTripReturn = closePosition(exitPrice * (1 - slip(exitPrice)), ["risk-rule-exit"], candle.timestamp);
        roundTripReturns.push(roundTripReturn);
        riskExited = true;
      }

      if (position) {
        position.highestPrice = Math.max(position.highestPrice, candle.high);
      }
    }

    const portfolioValue = cash + (position ? position.quantity * candle.close : 0);
    if (riskExited) {
      peakValue = Math.max(peakValue, portfolioValue);
      maxDrawdown = Math.max(maxDrawdown, peakValue === 0 ? 0 : (peakValue - portfolioValue) / peakValue);
      equityCurve.push({ timestamp: candle.timestamp, value: portfolioValue });
      continue;
    }

    const decision = strategy.decide(
      {
        market: candle.market,
        candles,
        candleIndex,
        lastSellPrice,
        lastSellCandleIndex,
        position,
        portfolioValue,
      },
      scenario,
    );
    const guideRuleEvaluation =
      decision.action === "hold"
        ? createPassedGuideRuleEvaluation(guideRuleMode)
        : evaluateGuideRules({
            candles,
            candleIndex,
            decision,
            mode: guideRuleMode,
          });
    const finalAction =
      decision.action === "buy" && guideRuleMode === "strict" && !guideRuleEvaluation.passed
        ? "hold"
        : decision.action;

    if (decision.action !== "hold" || !guideRuleEvaluation.passed) {
      signalAudit.push({
        market: candle.market,
        timestamp: candle.timestamp,
        rawAction: decision.action,
        finalAction,
        confidence: decision.confidence,
        guideRuleMode,
        guideRulePassed: guideRuleEvaluation.passed,
        guideRuleScore: guideRuleEvaluation.score,
        reasonCodes: decision.reasonCodes,
        guideRuleReasons: guideRuleEvaluation.reasons,
        guideRuleBlockers: guideRuleEvaluation.blockers,
        guideRuleWarnings: guideRuleEvaluation.warnings,
      });
    }

    if (finalAction === "buy" && !position && decision.targetWeight > 0) {
      const budget = cash * Math.min(decision.targetWeight, 1);
      const fillPrice = candle.close * (1 + slip(candle.close));
      const fee = budget * config.feeRate;
      const quantity = Math.max(0, (budget - fee) / fillPrice);

      if (quantity > 0) {
        cash -= budget;
        // Include buy-side fee in cost basis so closePosition's PnL is accurate.
        const costBasis = (quantity * fillPrice + fee) / quantity;
        position = {
          market: candle.market,
          quantity,
          averagePrice: costBasis,
          openedAt: candle.timestamp,
          highestPrice: fillPrice,
          holdCandles: 0,
          partialProfitTaken: false,
        };
        trades.push({
          market: candle.market,
          side: "buy",
          timestamp: candle.timestamp,
          price: fillPrice,
          quantity,
          fee,
          reasonCodes: [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
          guideRuleMode,
          guideRuleEvaluation,
        });
      }
    }

    if (finalAction === "sell" && position) {
      // targetWeight in (0,1) means partial close: keep that fraction, sell the rest
      const keepFraction =
        decision.targetWeight > 0 && decision.targetWeight < 1 ? decision.targetWeight : undefined;
      const roundTripReturn = closePosition(
        candle.close * (1 - slip(candle.close)),
        [...decision.reasonCodes, ...guideRuleEvaluation.reasons],
        candle.timestamp,
        guideRuleEvaluation,
        keepFraction,
      );
      roundTripReturns.push(roundTripReturn);
    }

    const currentValue = cash + (position ? position.quantity * candle.close : 0);
    peakValue = Math.max(peakValue, currentValue);
    maxDrawdown = Math.max(maxDrawdown, peakValue === 0 ? 0 : (peakValue - currentValue) / peakValue);
    equityCurve.push({ timestamp: candle.timestamp, value: currentValue });
  }

  if (position) {
    const last = candles[candles.length - 1];
    const roundTripReturn = closePosition(last.close * (1 - slip(last.close)), ["final-close"], last.timestamp);
    roundTripReturns.push(roundTripReturn);
    // Update the last equity curve point in-place rather than pushing a duplicate
    // timestamp — the main loop already pushed the pre-close value for this candle.
    if (equityCurve.length > 0 && equityCurve[equityCurve.length - 1].timestamp === last.timestamp) {
      equityCurve[equityCurve.length - 1].value = cash;
    } else {
      equityCurve.push({ timestamp: last.timestamp, value: cash });
    }
  }

  const finalValue = equityCurve[equityCurve.length - 1]?.value ?? cash;
  const wins = roundTripReturns.filter((value) => value > 0);
  const losses = roundTripReturns.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));

  function closePosition(
    price: number,
    reasonCodes: string[],
    timestamp: number,
    guideRuleEvaluation?: GuideRuleEvaluation,
    keepFraction?: number,
  ): number {
    if (!position) return 0;

    const isPartial = keepFraction !== undefined && keepFraction > 0 && keepFraction < 1;
    const sellQuantity = isPartial ? position.quantity * (1 - keepFraction) : position.quantity;

    const proceeds = sellQuantity * price;
    const fee = proceeds * config.feeRate;
    const entryCost = sellQuantity * position.averagePrice;
    const realized = proceeds - fee - entryCost;

    trades.push({
      market: position.market,
      side: "sell",
      timestamp,
      price,
      quantity: sellQuantity,
      fee,
      reasonCodes,
      guideRuleMode,
      guideRuleEvaluation,
    });
    cash += proceeds - fee;

    if (isPartial) {
      position.quantity *= keepFraction;
      position.partialProfitTaken = true;
      return entryCost === 0 ? 0 : realized / entryCost;
    }

    lastSellPrice = price;
    lastSellCandleIndex = currentCandleIndex;
    position = null;
    return entryCost === 0 ? 0 : realized / entryCost;
  }

  return {
    strategyId: strategy.id,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    scenarioParams: scenario.params,
    market: candles[0]?.market ?? "UNKNOWN",
    finalValue,
    returnRate: (finalValue - config.initialCash) / config.initialCash,
    maxDrawdown,
    winRate: roundTripReturns.length === 0 ? 0 : wins.length / roundTripReturns.length,
    tradeCount: trades.length,
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    worstTradeReturn: roundTripReturns.length === 0 ? 0 : Math.min(...roundTripReturns),
    guideRuleMode,
    guideRejectedSignals: signalAudit.filter((signal) => signal.rawAction !== signal.finalAction).length,
    trades,
    signalAudit,
    equityCurve,
  };
}

function createPassedGuideRuleEvaluation(mode: GuideRuleMode): GuideRuleEvaluation {
  return {
    mode,
    passed: true,
    score: 1,
    reasons: [],
    blockers: [],
    warnings: [],
    trend: "unknown",
    movingAverage: "unknown",
  };
}
