import { arbitrageStrategy } from "./arbitrage";
import { averageDropCycleStrategy } from "./averageDropCycle";
import { generalSumStrategy } from "./generalSum";
import { momentumStrategy } from "./momentum";
import { rangeGridStrategy } from "./rangeGrid";
import { rangeReentryStrategy } from "./rangeReentry";

export const strategies = [
  momentumStrategy,
  rangeGridStrategy,
  arbitrageStrategy,
  rangeReentryStrategy,
  averageDropCycleStrategy,
];

export const baseStrategies = strategies;
export { generalSumStrategy };
