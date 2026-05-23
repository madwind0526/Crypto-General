import { describe, expect, it } from "vitest";
import { compareStrategies } from "../src/simulation/optimizer";
import type { Strategy } from "../src/types/trading";

const noopStrategy: Strategy = {
  id: "momentum",
  name: "Noop",
  description: "Noop strategy",
  defaultScenario: {
    id: "noop",
    traderId: "momentum",
    name: "Noop",
    description: "No trades",
    params: {},
  },
  decide: () => ({
    action: "hold",
    confidence: 0,
    reasonCodes: ["noop"],
    targetWeight: 0,
  }),
};

describe("strategy comparison", () => {
  it("returns no comparisons when there are no valid candle sets", () => {
    expect(compareStrategies([noopStrategy], {})).toEqual([]);
    expect(compareStrategies([noopStrategy], { "KRW-TEST": [] })).toEqual([]);
  });
});
