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

## 2026-05-27 Independent Agents Review (1st pass)

Scope:
- Recent Daily Operation UI polling fix in `src/app/App.tsx`.
- Crypto-Currency port/watchdog changes inspired by `C:\Claude\Crypto-Anomaly`.
- Current working-tree hygiene and durable documentation consistency.

Review method:
- Three independent sub-agents reviewed separate areas:
  - UI rollover / 9-card Daily Operation board.
  - Marathon watchdog / simulation loop / port changes.
  - Operational hygiene / docs consistency.
- Main agent also reviewed the current diff and verification state.

---

### IA-1. `marathon-watchdog.mjs:69` - Paper-result freshness timeout can kill legitimate rollover work (Medium)

The watchdog now uses `public/market/paper-trading-1m-daily-results.json` mtime as the primary freshness signal and defaults `MARATHON_STALE_MINUTES` to 10 minutes.

Risk:
- Currency rollover is heavier than Anomaly's loop.
- Around 00:00 KST, `day-trading-marathon.mjs` can run daily log save, top-30 refresh, 24h refit, dashboard rebuild, and market reload before the next paper-result write.
- If that legitimate work exceeds 10 minutes, the watchdog may kill the marathon as stale and create a restart loop or partial rollover.

Suggested fix:
- Use a longer Currency default, or treat known rollover/status progress as fresh.
- Prefer not to copy Anomaly's shorter stale threshold directly because Currency's rollover path is more expensive.

Status: Not fixed.

---

### IA-2. `marathon-watchdog.mjs:132` - Stale restart may leave descendant Node writers alive on Windows (Medium)

The watchdog kills only the direct marathon child when stale.

Risk:
- On Windows, child processes spawned by the marathon, such as paper simulation or daily rollover, may continue running after the parent is killed.
- A leftover descendant can keep writing `public/market/paper-trading-1m-daily-results.json` while a restarted marathon writes the same file.
- This can produce competing writers and misleading freshness updates.

Suggested fix:
- Terminate the process tree on Windows, for example via `taskkill /F /T /PID <pid>`.
- Keep graceful `SIGTERM` where possible, but add a tree-kill fallback before starting a replacement child.

Status: Not fixed.

---

### IA-3. `App.tsx:340` - Overlapping Daily Operation polls can restore stale data (Medium)

`pollDailyOperationState()` is async and started by `setInterval` without an in-flight guard.

Risk:
- A slow older poll can finish after a newer poll.
- The current update check only compares `generatedAt !== ref.current`, so the older response can still pass and overwrite newer `dashboardResults`, `dailyMarketData`, or `dailyPaperResults`.
- The risk increased because `dashboard-results.json` is now included in the same 15-second polling path.

Suggested fix:
- Add an in-flight guard so a new poll does not start while the previous one is running.
- Or use a monotonically increasing request sequence / timestamp comparison that rejects older responses.

Status: Not fixed.

---

### IA-4. `App.tsx:707` - Dashboard results are too large to parse every 15 seconds (Medium)

`loadDailyOperationState()` now fetches `dashboard-results.json` on every Daily Operation poll.

Risk:
- In the current workspace, `dashboard-results.json` is large enough that repeated download/parse every 15 seconds can cause UI jank and dev-server load.
- This also increases the overlapping-poll risk in IA-3.

Suggested fix:
- Add a small dashboard manifest/status file containing only `generatedAt` or plan version.
- Poll the large dashboard results less frequently than daily candles/paper results.
- Or use a lightweight metadata endpoint / `HEAD` style check before loading the full JSON.

Status: Not fixed.

---

### IA-5. `day-trading-marathon.mjs:325` - Untracked daily-log hook is mixed into the operation loop (Medium)

`day-trading-marathon.mjs` now calls `scripts/save-daily-log.mjs`, but that script is currently untracked, and it writes the also-untracked `simulation-daily-log.md`.

Risk:
- If only tracked files are committed, rollover logs a non-fatal warning every midnight.
- If the generated markdown log is committed, runtime output becomes source-history noise.
- This change is separate from the requested Crypto-Anomaly loop/watchdog mirroring.

Suggested fix:
- Either intentionally add and document the script while moving the generated log under ignored `data/local/...`, or remove the hook from this change set.

Status: Not fixed.

---

### IA-6. Durable docs still mention old 12-symbol / in-project anomaly model (Low)

Some durable docs still conflict with the current top-9 General-A/B/C/D/E model:
- `AGENTS.md` still references 12 candidate/watched symbols.
- `memory-bank/design-document.md` still references a 12-symbol board.
- `memory-bank/implementation-plan.md` still contains old in-project anomaly storage/planning sections even though `GUIDERULES.md` says Anomaly lives in `C:\Claude\Crypto-Anomaly`.

Risk:
- Future sessions may start from outdated project assumptions.

Suggested fix:
- Align durable docs to the current top-30 -> top-9 General workflow.
- Keep only cross-project notes for Crypto-Anomaly instead of in-project anomaly implementation guidance.

Status: Not fixed.

---

### IA-7. No focused regression test for rollover plan/cache state sync (Low)

The Daily Operation fix was verified by `npm run test` and `npm run build`, but there is no focused test around:
- `dashboard-results.json` changing at rollover,
- daily cache changing at the same time,
- the UI keeping all 9 selected cards aligned with the refreshed plan.

Suggested fix:
- Add a focused test or component-level harness for the polling/state-sync behavior.
- At minimum, add a small pure helper test if the polling/version logic is extracted.

Status: Not fixed.

---

### Confirmed OK By Independent Review

- `package.json` dev port pin to `127.0.0.1:5174 --strictPort` is appropriate because Crypto-Anomaly owns `5173`.
- `package.json` preview port pin to `127.0.0.1:4174 --strictPort` is low risk.
- Removing the `candles.length > 0` filter from `buildDailyEntries()` does not appear to introduce an immediate runtime crash. Empty candle arrays flow safely through return calculation, aggregation, and chart rendering.
- The core intended behavior is directionally correct: Daily Operation polling now reloads dashboard results, and the 9-card board no longer hides selected markets just because the candle cache is temporarily missing.

Verification already run for the current change set:
- `node --check scripts/marathon-watchdog.mjs`
- `npm run test` (77 tests passing)
- `npm run build`
- `git diff --check`

---

---

## 2026-05-27 Independent Agents Review (2nd pass — full codebase)

Three independent sub-agents reviewed scripts/, src/, and src/app/ concurrently.
Severity corrections vs prior review are noted inline.

---

### Severity upgrade from prior review

**Issue 14 (MACD zero-fill) — upgraded Low → Critical**

Previously assessed as low-impact due to warmup-zone skip. Re-review confirms: `macdLine.map(v => v ?? 0)` biases the signal EMA seed toward zero, which can produce false-positive MACD crossovers at the start of any candle series. Fix: strip nulls and re-align the result array after computing EMA.

---

### New Critical

---

#### NC-1. `src/indicators/technical.ts:71` — MACD signal EMA seeded with zeros (Critical, confirmed upgrade)

See Issue 14 above. Standard MACD definition uses only non-null MACD values for the signal seed.

---

### New High

---

#### NH-1. `scripts/day-trading-marathon.mjs:181` — Non-atomic double `writeFile` for cache files (High)

Two sequential `writeFile` calls write `cachePath` then `publicCachePath`. A crash or kill between the two leaves the files out of sync. Any reader (dashboard, paper sim) that reads during the write window sees partial JSON.

Fix: write to `.tmp` then `rename()` atomically for both files.

---

#### NH-2. `scripts/marathon-watchdog.mjs:87` — `async` staleTimer callback unguarded, concurrent invocations possible (High)

`setInterval` ignores the returned Promise from the `async` callback. If `writeWatchdogStatus` takes longer than `checkMs`, two invocations run concurrently — both can call `child.kill()` and race on writing the status file.

Fix: add an `isChecking` boolean guard; return early if already running.

---

#### NH-3. `scripts/daily-rollover.ts:579` — `runCommand` has no timeout; grandchild processes orphaned on marathon kill (High)

If `build-dashboard-results.mjs` hangs, `daily-rollover.ts` blocks forever. The marathon's 30-minute timeout kills the rollover process, but the grandchild it spawned continues writing to shared output files.

Fix: add a per-command timeout to `daily-rollover.ts`'s `runCommand`, or `unref()` grandchildren.

---

#### NH-4. `scripts/paper-trading-1m-daily.ts:59` — Missing plan file crashes entire paper simulation with no try/catch (High)

`readFile(planPath, "utf8")` throws ENOENT without a catch. A missing file for one strategy aborts all strategies; `publicOutputPath` is not updated; dashboard shows stale data with no visible error.

Fix: wrap in try/catch per strategy and skip the missing one with a console.warn including `planPath`.

---

#### NH-5. `src/simulation/backtest.ts:122` — Buy-side fee excluded from cost basis; PnL overstated per round trip (High)

`averagePrice` is set to `fillPrice` (slipped price only). `closePosition` computes `entryCost = quantity * averagePrice`, which excludes the buy-side fee. Net return is overstated by ~`feeRate` per buy (~0.05% systematic).

Fix: include fee in cost basis: `averagePrice = (quantity * fillPrice + fee) / quantity`.

---

#### NH-6. `src/strategies/averageDropCycle.ts:129` — VWAP window is off by one candle ✅ Intentional design

`averages[index]` reflects the window `[index-window, index-1]` (prior candles only, current excluded).
This is by design: using the pre-drop average lets the stop-loss detect a sudden drop without the falling current price diluting the reference average.
A comment has been added to the source to prevent future false flags.

---

#### NH-7. `src/app/App.tsx:304` — No in-flight guard on 1-second refresh poller (High)

`poll()` is async; `setInterval` at 1 second does not wait for the previous call to resolve. Slow network → dozens of concurrent `/api/strategy-refresh/status` requests pile up.

Fix:
```ts
let pending = false;
async function poll() {
  if (pending) return;
  pending = true;
  try { ... } finally { pending = false; }
}
```

---

#### NH-8. `src/app/App.tsx:301` — Two independent pollers race on shared freshness refs (High)

The 1-second refresh poller and the 15-second daily-operation poller both read and write `lastDashboardResultsGeneratedAtRef`, `lastDailyMarketGeneratedAtRef`, and `lastDailyPaperGeneratedAtRef`. If they complete in reverse order, a stale response can overwrite a fresh one.

Fix: consolidate both pollers into one loop, or use a single write gate ref updated only by the first writer.

---

### New Medium

---

#### NM-1. `scripts/day-trading-marathon.mjs:238` — `readCache` has TOCTOU race; JSON parse error discards all in-memory candles (Medium)

`existsSync` + `readFile` is not atomic. A truncated write between the check and read causes `JSON.parse` to throw, propagates to `runCycle`'s catch, and the accumulated `nextCandlesByMarket` is silently lost for that cycle.

Fix: wrap read+parse in try/catch returning `null` on ENOENT or SyntaxError; log a warning on parse failure.

---

#### NM-2. `scripts/day-trading-marathon.mjs:345` — `runCommand` timeout sends SIGTERM with no SIGKILL follow-up (Medium)

On timeout the child is sent SIGTERM and the promise rejects, but the child is not waited on and may continue writing shared files. No SIGKILL follow-up.

Fix: add `setTimeout(() => child.kill("SIGKILL"), 10_000).unref()` after SIGTERM.

---

#### NM-3. `scripts/day-trading-marathon.mjs:99` — `shuttingDown` flag not checked before next `runCycle` (Medium)

A signal arriving during `sleep()` sets `shuttingDown = true` but the while-condition is time-based. Another full cycle starts before the signal is acted on.

Fix: add `if (shuttingDown) break;` at the top of the loop body.

---

#### NM-4. `scripts/marathon-watchdog.mjs:69` — `lastSeenPaperMtime` initialized from existing file; first write after restart doesn't reset stale clock (Medium)

If the results file exists from a prior run with the same mtime (same-millisecond resolution), `currentMtime === lastSeenPaperMtime` and the stale clock starts from spawn — premature kill risk.

Fix: initialize `lastSeenPaperMtime = null` and record `lastFreshAt = Date.now()` at each child spawn.

---

#### NM-5. `scripts/daily-rollover.ts:405` — Partial market cache written to disk before error is detected (Medium)

`writeMarketCache` writes files market by market inside the fetch loop. If the loop throws midway, files on disk contain a partial dataset while the function returns the original cached value.

Fix: construct the full `candlesByMarket` object first, then write in one step after the loop completes successfully.

---

#### NM-6. `scripts/daily-rollover.ts:472` — 12-page cap on candle fetch has no warning when limit is hit (Medium)

Related to existing Issue 8. When `page === 11` and `windowStart` is not yet covered, the loop silently stops. Operator has no visibility.

Fix: after the loop, check `min(all[].timestamp) > start` and emit a console.warn if so.

---

#### NM-7. `scripts/save-daily-log.mjs:82` — Off-by-one in same-date replacement tail slice (Medium)

`tail = afterMarker.slice(nextSection + 1)` relies on `entry` ending with `\n`. Removing the trailing newline from `entry` silently merges two date sections.

Fix: `const tail = nextSection >= 0 ? "\n" + afterMarker.slice(nextSection + 1) : "";`.

---

#### NM-8. `scripts/save-daily-log.mjs:86` — Insert-after-header uses `"\n---\n"` which doesn't match on a fresh file (Medium)

`LOG_HEADER` starts with `---`, so `existing.indexOf("\n---\n")` returns -1 on first run. The fallback appends correctly, but second-run behavior depends on whether prior entries created the expected separator.

Fix: normalize `LOG_HEADER` to end with `\n---\n` so the sentinel reliably matches on all subsequent calls.

---

#### NM-9. `scripts/save-daily-log.mjs:74` — No atomic write; concurrent rollover restarts can silently discard a log entry (Medium)

Read → modify → write pattern. If the watchdog restarts the marathon mid-rollover while a previous rollover is also calling `save-daily-log`, whichever writes last wins silently.

Fix: write to temp file then rename atomically. At minimum, document the concurrency assumption explicitly.

---

#### NM-10. `src/simulation/backtest.ts:58` — Stop price selection uses `Math.max`; trailing stop always wins over fixed stop (Medium)

When both stops trigger on the same candle, `Math.max(trailingStop, fixedStop)` always returns the trailing stop (which is always ≥ fixed stop). The fixed stop is effectively dead when trailing is active.

Fix: either document that trailing supersedes fixed, or use the stop that triggered *first* (i.e., the one consistent with execution order).

---

#### NM-11. `src/simulation/backtest.ts:165` — Equity curve has duplicate timestamp at end when position is force-closed (Medium)

The last candle is pushed by the main loop, then `closePosition` pushes again at the same timestamp. Consumers see two entries at the same timestamp with different values.

Fix: don't push to `equityCurve` inside `closePosition` for the force-close case; let the main-loop push stand.

---

#### NM-12. `src/guideRules/evaluator.ts:223` — Moving-average cache key insensitive to candle content mutations (Medium)

Cache key is `"${candles.length}:${lastTimestamp}"`. If a candle's OHLCV data is updated in-place without changing the array length or last timestamp, the cached EMA series is stale.

Fix: include a content hash or checksum in the key, or document that callers must not mutate candle arrays in-place.

---

#### NM-13. `src/guideRules/evaluator.ts:251` — `evaluateSupportResistance` recomputes ATR on every call with no caching (Medium)

`averageTrueRangePct(previousWindow)` calls `sma` (O(n²)) on a fresh slice every call. Called per strategy per candle.

Fix: cache the ATR result alongside the EMA cache, keyed by window size and last timestamp.

---

#### NM-14. `src/strategies/arbitrage.ts:66` — Z-score uses population variance; z-scores inflated for small lookbacks (Medium)

`/ window.length` should be `/ (window.length - 1)` for sample variance. Effect: z-scores are slightly higher than intended, causing more aggressive entries.

Fix: use `window.length - 1` denominator.

---

#### NM-15. `src/strategies/arbitrage.ts:116` — `returns[0]` is `0` (null → 0 mapped) and can be included in z-score window (Medium)

At `candleIndex === lookback`, the window contains the mapped `0` from index 0. The z-score is biased.

Fix: start `returns` computation at index 1, or skip `candleIndex < lookback + 1`.

---

#### NM-16. `src/simulation/safety.ts:28` — `getDailyReturnAtCandleIndex` uses `Array.find` (O(n) linear scan) per buy signal (Medium)

Called on every buy signal check across all 9 monitored markets. Candles are already sorted by timestamp.

Fix: replace with binary search (same pattern as `findLastIndexAtOrBefore` already in `paperTrading.ts`).

---

#### NM-17. `src/simulation/optimizer.ts:78` — `scoreBacktestResult` ignores `profitFactor`; losing strategies can score well (Medium)

`profitFactor` is in `BacktestResult` but unused in scoring. A strategy with positive returns from a few outlier wins and `profitFactor < 1` scores the same as one with `profitFactor > 2`.

Fix: add `profitFactor` as a multiplier or additive term (e.g., `Math.min(profitFactor, 2) * weight`).

---

#### NM-18. `src/simulation/optimizer.ts:85` — `compareByPureReturn` floating-point tie-breaking is dead code (Medium)

`returnRate` values are floating-point; exact equality is virtually impossible. The `maxDrawdown` and `tradeCount` tie-breakers are never reached.

Fix: remove the dead tie-breakers or replace with an explicit epsilon comparison.

---

#### NM-19. `src/app/App.tsx:1101` — `useMemo` with `Date.now()` computes a dead result (Medium)

`decideDailyOperation({ now: Date.now(), ... })` is inside `useMemo([signals])`. `Date.now()` changes every millisecond but is not in deps, so the value is stale until `signals` changes. The resulting `decision` variable is never used in JSX.

Fix: remove the dead computation entirely.

---

#### NM-20. `src/app/App.tsx:91` — `MarketChart` fully destroys and recreates chart instance on theme change (Medium)

The chart creation `useEffect` depends on `[themeMode, variant]`. Theme changes trigger a full destroy/recreate instead of `chart.applyOptions()`, causing a flash and extra allocations.

Fix: separate the chart init effect (no theme dep) from the theme-apply effect (calls `chart.applyOptions()` only).

---

#### NM-21. `src/app/App.tsx:1163` — `aggregateCandles` called inside render loop; runs 9× O(n log n) on every re-render (Medium)

`aggregateCandles` sorts and builds a Map on every render for each of the 9 market cards. The 15-second poll and 5-second wsLive updates both trigger re-renders.

Fix: lift aggregation into the `displayedEntries` useMemo so it runs once per dependency change.

---

#### NM-22. `src/app/App.tsx:2475` — `buildDailyEntries` runs O(n×m) linear candle scan per trade on every 15-second poll (Medium)

`filterMarketTradesBySafety` calls `findCandleIndexAtOrBefore` (linear scan) per buy trade. With 9 markets × many trades, this blocks the main thread synchronously every 15 seconds.

Fix: replace with binary search; or move to a Web Worker for the popup path.

---

#### NM-23. `src/app/App.tsx` — No error boundary anywhere in the component tree (Medium)

A render error from malformed polling JSON blanks the entire app. Specific risk: `buildDailyEntries` accesses `result.equityCurve[...]` and `result.trades` from externally-fetched JSON.

Fix: add a top-level `<ErrorBoundary>` in `main.tsx` and a nested one around the 9-card Daily Operation grid.

---

### New Low

---

#### NL-1. `scripts/save-daily-log.mjs:98` — Fatal errors call `process.exit(0)`; parent sees success, warning never fires (Low)

`process.exit(0)` hides the error from the marathon's non-fatal catch at line 326. Warning `"[rollover] save-daily-log failed"` is never logged.

Fix: `process.exit(1)` so the non-fatal warning in `maybeRunDailyRollover` fires.

---

#### NL-2. `scripts/paper-trading-1m-daily.ts:71` — Empty `decisions.jsonl` writes a bare newline (Low)

`result.decisions.map(...).join("\n") + "\n"` on an empty array writes `"\n"`. JSONL parsers that reject empty lines may fail on `build-dashboard-results`.

Fix: skip the write entirely when `result.decisions.length === 0`.

---

#### NL-3. `src/indicators/technical.ts:115` — ATR uses simple SMA instead of Wilder's EMA (Low)

Canonical ATR uses `alpha = 1/period`. SMA-based ATR is higher during volatility spikes and lower after. Strategy parameters (e.g., `maxAtrPct: 0.08`) were tuned against this SMA-ATR — document the deviation.

---

#### NL-4. `src/indicators/technical.ts:3` — `sma` is O(n × period); called repeatedly per candle (Low)

Sliding-window accumulator would be O(n). With ATR's `sma` on 1440-candle arrays and multiple strategies, this adds up.

Fix: rewrite `sma` with a running sum.

---

#### NL-5. `src/strategies/anomaly.ts:93` — `Math.max(...slice)` per `decide()` call not cached; `Math.max(...[])` → `-Infinity` at index 0 (Low)

24-element `Math.max` spread per call × 9 markets × every candle. Also, at `candleIndex = 0` the slice is empty, `Math.max(...[])` = `-Infinity`, `breaksHigh` is always true (gated by `averageVolume === null` in practice but fragile).

Fix: precompute rolling max inside `getAnomalyIndicators`; add an `index > 0` guard.

---

#### NL-6. `src/simulation/optimizer.ts:137` — `reduce` on empty `scenarios` array throws if `strategy.defaultScenario` is undefined (Low)

`strategy.scenarios?.length ? ... : [strategy.defaultScenario]` passes `[undefined]` if `defaultScenario` is absent. `runBacktest` receives an undefined scenario.

Fix: add `if (!strategy.defaultScenario) throw new Error(...)` or use a non-null assertion with a test.

---

#### NL-7. `src/app/App.tsx:2657` — `URL.revokeObjectURL` called synchronously after `link.click()`; download may fail on Firefox (Low)

The click-triggered download is async on some browsers. Synchronous revoke can cause a failed download.

Fix: `setTimeout(() => URL.revokeObjectURL(url), 100)`.

---

#### NL-8. `src/app/App.tsx:1719` — `Math.min(...allPoints.map(...))` throws RangeError for very large equity curves (Low)

Spreading >~100,000 elements into `Math.min`/`Math.max` exceeds the JS call stack. With 4 cases × 9 markets × full equity curve, this is plausible.

Fix: use `reduce` or a loop.

---

## Architecture Notes (unchanged)

| Item | Note |
|------|------|
| No walk-forward validation | Parameters selected as best in-sample across the full window — overfitting risk |
| `scoreBacktestResult` design | `winRate * 0.05` contributes negligibly; `profitFactor` and `worstTradeReturn` are unused in scoring |
| returnRate-first selection | `compareOptimizationsByPureReturn` lets a high-return, high-risk market outrank a risk-adjusted better market |
| General-D/E `rotationAdvantage: Infinity` | Prevents rotation for these strategies — intentional but checked via string literal `strategy.id === "general-d"` which is fragile when adding strategies |

---

## Final Summary (updated 2026-05-27)

### Previously tracked (Issues 6–16, IA-1–IA-7)

| Severity | Count | Status |
|----------|-------|--------|
| Critical (original) | 3 | All fixed |
| Medium (Issues 6–8, IA-1–IA-5) | 8 | 0 fixed |
| Low (Issues 9–16, IA-6–IA-7) | 9 | 0 fixed |

### 2nd-pass independent review additions

| Severity | New issues | Area |
|----------|-----------|------|
| Critical | 1 (NC-1, severity upgrade of Issue 14) | Indicators |
| High | 7 (NH-1 – NH-5, NH-7 – NH-8; NH-6 intentional) | Scripts (4), Backtest/Strategy (1), Frontend (2) |
| Medium | 23 (NM-1 – NM-23) | Scripts (9), Src (8), Frontend (6) |
| Low | 8 (NL-1 – NL-8) | Scripts (2), Src (4), Frontend (2) |

### Priority fix order

1. **NC-1** — MACD signal zero-fill (incorrect indicator output, affects all strategies using MACD)
2. **NH-5** — Backtest fee double-counting (systematic PnL overstatement, corrupts all backtest scores)
3. **NH-6** — averageDropCycle VWAP off-by-one (triggers premature stop-loss, corrupts 600 scenarios)
4. **NH-1** — Non-atomic cache writes (data corruption risk on crash/kill)
5. **NH-4** — Paper sim crashes on missing plan file (cascades to stale dashboard)
6. **NH-2** — Watchdog staleTimer concurrency (can double-kill and corrupt status file)
7. **NH-3** — daily-rollover runCommand no timeout (grandchild orphan writes)
8. **NH-7 / NH-8** — Frontend poller races (stale data overwrites, request pile-up)
9. **NM-1–NM-9** — Data integrity and process management (scripts)
10. **NM-10–NM-23** — Algorithm correctness and performance (src + frontend)
