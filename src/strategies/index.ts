import { arbitrageStrategy } from "./arbitrage";
import { averageDropCycleStrategy } from "./averageDropCycle";
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
