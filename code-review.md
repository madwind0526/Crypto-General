# Code Review Report — Crypto-Currency

> Initial review: 2026-05-19
> Re-review: 2026-05-23
> Full re-review: 2026-05-23 (this update)

---

## Status Overview

| Severity | Original | Fixed | Remaining |
|----------|----------|-------|-----------|
| Critical | 3 | 3 | 0 |
| High | 0 | — | 0 |
| Medium | 5 | 2 | 3 |
| Low / Quality | 4 | 0 | 4 |
| **New (this review)** | **5** | — | **5** |

---

## Fixed Issues

### 1. `backtest.ts` — exit price calculation bug ✅ Fixed

`triggeredStops` array + `trailingStopPct > 0` guard prevent trailingStop from inflating the exit price when the param is zero.

### 2. `evaluator.ts` — EMA O(n²) recomputation ✅ Fixed

`movingAverageCache` WeakMap added. EMA computed once per candle array, keyed by length + last timestamp.

### 3. `optimizer.ts` — reduce on empty array crash ✅ Fixed

`if (results.length === 0) return []` guard added before `.reduce()`.

### 4. `rangeReentry.ts` — General-D emergency stop ✅ Fixed

Stop fires unconditionally on `lowFromEntry <= -emergencyStopPct || gainFromEntry <= -emergencyStopPct`. Downtrend condition removed from the gate.

### 5. `traderOptimization.ts` — sort mismatch ✅ Fixed

Both `optimizedMarkets` and `selectedMarkets` now use `compareOptimizationsByPureReturn`.

---

## Remaining Issues

---

### 6. `safety.ts:11,16` — Hardcoded thresholds (Medium, not fixed)

```typescript
if (candles.length < 240) reasons.push("insufficient-1m-data");
if (result.guideRejectedSignals >= 300) reasons.push("many-rejected-signals");
```

- `240` assumes 1-minute candles. On 5m candles this equals 20 hours of data — a wrong interpretation.
- `300` rejected signals is an absolute count. On a 7-day 1m dataset (≈10,080 candles), 300 = ~3% rejection rate, which may be normal.

Recommend ratio-based thresholds (e.g. `guideRejectedSignals / tradeCount > 0.5`) or making constants configurable.

---

### 7. `averageDropCycle.ts:72` — `avgStopPct=0` produces 600 scenarios, some with broken stop logic (Medium, not fixed)

```typescript
for (const averageWindowCandles of averageWindows) {   // 4
  for (let entryDropPct = 1; entryDropPct <= 5; ...) { // 5
    for (let avgStopPct = 0; avgStopPct <= 5; ...) {   // 6  ← includes 0
      for (let avgTakeProfitPct = 1; avgTakeProfitPct <= 5; ...) { // 5
```

**600 scenarios × 30 markets = 18,000 backtests per optimization.**

When `avgStopPct = 0`:
```typescript
if (averagePrice <= position.averagePrice * (1 - 0)) // i.e. VWAP <= fillPrice
```
The stop fires whenever VWAP drops below the fill price — which can happen in a normal pullback after entry. This is neither a true stop (no percentage gap) nor reliably inactive. Combined with forced liquidation at simulation end, these scenarios have a systematic bias toward appearing better than they are in-sample.

---

### 8. `daily-rollover.ts:216,266` — Integer blending + hardcoded page count (Medium, not fixed)

**Integer blending (line 266):**
```typescript
blended[key] = Number.isInteger(previous) && Number.isInteger(next) ? Math.round(value) : value;
```
`period=20` (70%) + `period=14` (30%) = 18.2 → rounds to **18**. `snapScenarioToGrid` is called afterward, which snaps to the nearest valid preset — partially mitigating the drift. However repeated rollovers may oscillate between adjacent presets rather than converging to the historically best one.

**Hardcoded page count (line 472):**
```typescript
for (let page = 0; page < 12; page += 1) { // 12 × 200 = 2,400 min = ~40h
```
Insufficient during extended outage recovery. Recommend computing required pages from `windowStart`.

---

### 9. `backtest.ts:198` — `closePosition` declared after `return` (Low, not fixed)

```typescript
  return { ... };       // line 178

function closePosition(   // line 198 — after the return!
```

Works due to JavaScript function hoisting but misleading. Move `closePosition` before the `return`.

---

### 10. `ws-live.ts:141` — Missing plan file causes total init failure with no path in error (Low, not fixed)

```typescript
const payload = JSON.parse(await readFile(planPath, "utf8")) as PlanPayload;
// No try/catch → process.exit(1) on first-run or new strategy
```

Error message does not include the missing file path. On first run, user gets an opaque fatal crash. Should wrap in `try/catch` with a message that includes `planPath` and suggests running `persist:traders`.

---

### 11. `traderOptimization.ts:100-103` — Redundant sort (Low, not fixed)

```typescript
const optimizedMarkets = [...].sort(compareOptimizationsByPureReturn);  // already sorted
const selectedMarkets = optimizedMarkets
  .slice()
  .sort(compareOptimizationsByPureReturn)  // no-op: input is already sorted
  .slice(0, resolved.monitoringMarketCount);
```

Can be simplified to `optimizedMarkets.slice(0, resolved.monitoringMarketCount)`.

---

## New Issues (found in this review)

---

### 12. `anomalyMonitor.ts:97` — Candle sort + index mismatch risk (Medium)

```typescript
export function detectAnomalySignal(candles, candleIndex, ...) {
  const sorted = candles.slice().sort((a, b) => a.timestamp - b.timestamp);
  const index = Math.min(candleIndex, sorted.length - 1);
  // ↑ candleIndex was computed against the ORIGINAL array, not sorted
```

`candleIndex` is an index into the original `candles` array. After sorting, the same index may point to a **different candle**.

Currently all callers pass `candles.length - 1`:
```typescript
detectAnomalySignal(candles, candles.length - 1, ...)
```
Since the last element of a sorted array equals the last element of an already-sorted input, this works in practice. But if any caller ever passes a specific bar index (e.g. for backtesting a past signal), the wrong candle is accessed — silently.

Additionally, the `candles.slice().sort(...)` creates a new O(n log n) sorted copy on every call with no caching. If called per-tick, this accumulates.

**Suggested fix:** Remove the defensive sort (callers should guarantee sorted input) or use `sorted.findIndex` to locate the candle matching `candles[candleIndex].timestamp`.

---

### 13. `anomalyCandidateSelector.ts:49` — Unnecessary O(n log n) sort on every call (Low)

```typescript
function scoreMarket(market: string, candles: Candle[], ...) {
  const sorted = candles.slice().sort((a, b) => a.timestamp - b.timestamp);
```

Same pattern as issue #12: creates a sorted copy on every `scoreMarket` call. `selectAnomalyCandidates` calls this for every market. Market candles from the cache are already sorted, making this redundant O(n log n) work.

---

### 14. `technical.ts:71-73` — MACD signal EMA uses zero-fill for null MACD values (Low)

```typescript
const signalLine = ema(
  macdLine.map((value) => value ?? 0),  // ← nulls (before warmup) filled with 0
  signal,
);
```

During warmup, `macdLine` values are `null`. Replacing them with `0` biases the EMA seed toward zero. The result: the signal line's initial value is artificially low, which may generate false-positive MACD crossovers in the early part of a candle series.

In practice the `getMutableCandleCacheKey` approach means this is computed once per scenario/candle array, not re-run per candle. The distortion is limited to the first ~(26 + 9) bars. Since backtests and paper simulations skip the warmup zone, actual impact is low but the implementation differs from standard MACD definitions.

---

### 15. `daily-rollover.ts:195-203` — Redundant sort in `smoothRefitPlan` (Low)

```typescript
const rankedByReturn = optimizedMarkets.slice().sort(compareOptimizationsByPureReturn);
return {
  optimizedMarkets: optimizedMarkets.slice().sort(compareOptimizationsByPureReturn), // identical to rankedByReturn
  selectedMarkets: rankedByReturn.slice(0, monitoringMarketCount),
};
```

`rankedByReturn` and `optimizedMarkets.slice().sort(...)` produce identical arrays — the second sort is redundant. Replace with `rankedByReturn.slice()`.

---

### 16. `ws-live.ts:382-392` — `serializeResult` always writes `position: null` (Low)

```typescript
function serializeResult(result: PaperTradingResult): WsStrategyResult {
  return {
    returnRate: result.returnRate,
    trades: result.trades.length,
    cash: result.finalValue,
    finalValue: result.finalValue,
    position: null,   // ← always null, ignores result.trades / open position
    ...
  };
}
```

The `WsStrategyResult` type in `wsLiveData.ts:10` defines `position` as `{ market: string; entryPrice: number; holdBars: number } | null`, suggesting real position data was intended. The frontend dashboard can never show which market is currently held or at what entry price.

---

## Architecture Notes (unchanged)

| Item | Note |
|------|------|
| No walk-forward validation | Parameters selected as best in-sample across the full window — overfitting risk |
| `scoreBacktestResult` design | `winRate * 0.05` contributes negligibly; `profitFactor` and `worstTradeReturn` are unused in scoring |
| returnRate-first selection | `compareOptimizationsByPureReturn` lets a high-return, high-risk market outrank a risk-adjusted better market |
| General-D/E `rotationAdvantage: Infinity` | Prevents rotation for these strategies — intentional but checked via string literal `strategy.id === "general-d"` which is fragile when adding strategies |

---

## Final Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 3 | All fixed |
| Medium | 5 (3 old + 2 new) | 0 fixed / 5 remaining |
| Low / Quality | 9 (4 old + 5 new) | 0 fixed / 9 remaining |
