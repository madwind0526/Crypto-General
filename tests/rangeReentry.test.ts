import { describe, expect, it } from "vitest";
import { rangeReentryScenario, rangeReentryStrategy } from "../src/strategies/rangeReentry";
import type { Candle, Position } from "../src/types/trading";

describe("range re-entry strategy", () => {
  it("waits for a pullback from the previous sell price before re-entering", () => {
    const candles = createCandles("KRW-TEST", [...Array(79).fill(100), 95]);
    const candleIndex = candles.length - 1;

    const firstEntry = rangeReentryStrategy.decide(
      {
        market: "KRW-TEST",
        candles,
        candleIndex,
        position: null,
        portfolioValue: 1_000_000,
      },
      rangeReentryScenario,
    );
    const blockedReentry = rangeReentryStrategy.decide(
      {
        market: "KRW-TEST",
        candles,
        candleIndex,
        lastSellPrice: 96,
        position: null,
        portfolioValue: 1_000_000,
      },
      rangeReentryScenario,
    );

    expect(firstEntry.action).toBe("buy");
    expect(blockedReentry.action).toBe("hold");
    expect(blockedReentry.reasonCodes).toContain("waiting-reentry-drop");
  });

  it("sells only after the configured profit target is reached outside an uptrend", () => {
    const candles = createCandles("KRW-TEST", [...Array(79).fill(100), 103]);
    const candleIndex = candles.length - 1;
    const position: Position = {
      averagePrice: 100,
      highestPrice: 103,
      holdCandles: 12,
      market: "KRW-TEST",
      openedAt: candles[60].timestamp,
      quantity: 1,
    };

    const decision = rangeReentryStrategy.decide(
      {
        market: "KRW-TEST",
        candles,
        candleIndex,
        position,
        portfolioValue: 1_000_000,
      },
      rangeReentryScenario,
    );

    expect(decision.action).toBe("sell");
    expect(decision.reasonCodes).toContain("profit-target-exit");
  });

  it("exits when the candle low breaches the emergency stop even if the close recovers", () => {
    const candles = createCandles("KRW-TEST", [...Array(79).fill(100), 100]);
    candles[candles.length - 1] = {
      ...candles[candles.length - 1],
      low: 94,
    };
    const candleIndex = candles.length - 1;
    const position: Position = {
      averagePrice: 100,
      highestPrice: 100,
      holdCandles: 12,
      market: "KRW-TEST",
      openedAt: candles[60].timestamp,
      quantity: 1,
    };

    const decision = rangeReentryStrategy.decide(
      {
        market: "KRW-TEST",
        candles,
        candleIndex,
        position,
        portfolioValue: 1_000_000,
      },
      rangeReentryScenario,
    );

    expect(decision.action).toBe("sell");
    expect(decision.reasonCodes).toContain("emergency-stop-exit");
  });
});

function createCandles(market: string, closes: number[]): Candle[] {
  return closes.map((close, index) => ({
    market,
    timestamp: 1_700_000_000_000 + index * 60_000,
    open: index === 0 ? close : closes[index - 1],
    high: close * 1.002,
    low: close * 0.998,
    close,
    volume: 100,
    quoteVolume: close * 100,
  }));
}
