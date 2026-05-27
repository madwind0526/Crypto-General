import type { BacktestResult, Candle } from "../types/trading";

export interface SafetyEvaluation {
  blocked: boolean;
  reasons: string[];
}

// Minimum candle count expressed as a ratio of a full day (1440 1m candles).
const MIN_CANDLE_RATIO = 1 / 6; // at least 4h of data
// Block when rejected signals exceed this fraction of total trades.
const MAX_REJECTED_SIGNAL_RATIO = 0.5;

export function evaluateSafetyBlock(result: BacktestResult, candles: Candle[], currentReturn: number): SafetyEvaluation {
  const reasons: string[] = [];

  const minCandles = Math.max(60, Math.round(candles.length * MIN_CANDLE_RATIO));
  if (candles.length < minCandles) reasons.push("insufficient-1m-data");
  if (currentReturn <= -0.03) reasons.push("rapid-intraday-drop");
  if (currentReturn >= 0.12) reasons.push("overextended-chase-risk");
  if (result.maxDrawdown >= 0.15) reasons.push("high-max-drawdown");
  if (result.returnRate <= 0) reasons.push("non-positive-backtest");
  const tradeCount = Math.max(1, result.tradeCount);
  if (result.guideRejectedSignals / tradeCount > MAX_REJECTED_SIGNAL_RATIO) reasons.push("many-rejected-signals");

  return {
    blocked: reasons.length > 0,
    reasons,
  };
}

export function getDailyReturnAtCandleIndex(candles: Candle[], candleIndex: number) {
  const candle = candles[candleIndex];
  if (!candle) return 0;
  const dayStart = getKstDayStart(candle.timestamp);
  // Binary search for the first candle at or after dayStart (candles are sorted by timestamp).
  let lo = 0;
  let hi = candleIndex;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].timestamp < dayStart) lo = mid + 1;
    else hi = mid;
  }
  const first = candles[lo];
  if (!first || first.timestamp > candle.timestamp || first.close === 0) return 0;
  return (candle.close - first.close) / first.close;
}

function getKstDayStart(timestamp: number) {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((timestamp + kstOffsetMs) / dayMs) * dayMs - kstOffsetMs;
}
