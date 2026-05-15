import { arbitrageStrategy } from "./arbitrage";
import { momentumStrategy } from "./momentum";
import { rangeGridStrategy } from "./rangeGrid";
import { rangeReentryStrategy } from "./rangeReentry";

export const strategies = [momentumStrategy, rangeGridStrategy, arbitrageStrategy, rangeReentryStrategy];
