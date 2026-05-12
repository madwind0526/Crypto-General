import { describe, expect, it } from "vitest";
import { ema, rsi, sma } from "../src/indicators/technical";

describe("technical indicators", () => {
  it("calculates sma after enough values", () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("calculates ema without producing early values", () => {
    const values = ema([1, 2, 3, 4, 5], 3);
    expect(values[0]).toBeNull();
    expect(values[2]).toBe(2);
    expect(values[4]).toBeGreaterThan(3);
  });

  it("calculates rsi bounded between 0 and 100", () => {
    const values = rsi([1, 2, 3, 2, 4, 5, 4, 6, 7, 8], 3);
    const latest = values[values.length - 1];
    expect(latest).not.toBeNull();
    expect(latest).toBeGreaterThanOrEqual(0);
    expect(latest).toBeLessThanOrEqual(100);
  });
});

