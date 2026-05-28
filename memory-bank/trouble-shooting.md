# Trouble Shooting

## Known Issues

No known build issues after the latest implementation pass.

### 2026-05-27 - Crypto-Currency dev port collided with Crypto-Anomaly

Symptoms:
- Opening `127.0.0.1:5173` showed Crypto-Anomaly, not Crypto-Currency.
- Attempts to launch a second hidden Vite process from the sandbox were short-lived, which made browser checks confusing.

Cause:
- Crypto-Anomaly already owns the default Vite port `5173`.
- Crypto-Currency was still using the same default dev-server port.

Fix:
- Pinned Crypto-Currency `npm run dev` to `127.0.0.1:5174` and preview to `4174`.
- Updated the marathon watchdog to follow the working Crypto-Anomaly watchdog pattern: monitor the public paper-result file modification time, with status JSON as fallback.

Verification:
- `node --check scripts/marathon-watchdog.mjs` passed.
- `npm run test` passed.
- `npm run build` passed.

### 2026-05-27 - Daily Operation showed fewer than 9 graphs after 00:00 reset

Symptoms:
- After the 00:00 KST rollover and rerun, a Daily Operation screen that normally showed 9 graph cards could drop to 3-7 cards.

Cause:
- The running React UI polled the refreshed 1-minute daily market cache and paper results, but it did not poll the refreshed `dashboard-results.json`.
- After rollover, the daily cache contained today's selected-market union while the UI could still hold yesterday's 9-market plan. `buildDailyEntries` then filtered out plan markets with no matching candles, leaving only the overlapping markets.

Fix:
- Daily Operation polling now reloads `dashboard-results.json` and updates the active optimization plans when its `generatedAt` changes.
- The 9-card board keeps selected markets visible even if candles are temporarily missing for a market.

Verification:
- `npm run test` passed.
- `npm run build` passed.

### 2026-05-20 - Marathon run silently stopped updating

Symptoms:
- `marathon-status.json` still showed `running: true`, but `lastCycleAt`, `upbit-krw-1m-daily.json`, and `paper-trading-1m-daily-results.json` had stopped updating.
- Multiple `ws-live.mjs` processes were also present, which could overwrite the same WS result file.

Cause:
- The marathon loop had retry logic for failed Upbit responses, but no hard timeout for a stalled fetch or child paper-simulation command.
- A process could be interrupted without writing a final non-running status.
- Duplicate WS processes could make the UI appear inconsistent.

Fix:
- Added Upbit fetch timeout, child-process timeout, PID/status files, and shutdown/error cleanup to `scripts/day-trading-marathon.mjs`.
- Added `scripts/marathon-watchdog.mjs` and `npm run paper:marathon:watchdog` to restart the child if it exits early or status updates go stale.
- Stopped duplicate current-repo WS processes and restarted one WS live process after the fresh daily cache was written.

Verification:
- `npm run build` passed.
- `npm run test` passed.
- `node --check scripts/day-trading-marathon.mjs` and `node --check scripts/marathon-watchdog.mjs` passed.
- The restarted watchdog run reached cycle 4 and WS live reported `connected` with `caseResults`.

### 2026-05-12 - `npm install` timed out in sandbox

Symptoms:
- `npm install` timed out after 120 seconds.

Cause:
- Dependency download needed network access outside the default sandbox.

Fix:
- Re-ran `npm install` with approved escalated network access.

Verification:
- Dependencies installed and `package-lock.json` was generated.

### 2026-05-12 - npm audit moderate vulnerabilities from Vitest nested dependencies

Symptoms:
- `npm install` initially reported 5 moderate vulnerabilities involving older nested `vite`/`esbuild` dependencies under Vitest.

Cause:
- The originally requested Vitest major version pulled a vulnerable nested Vite/esbuild chain.

Fix:
- Upgraded Vitest to `4.1.6`.

Verification:
- `npm audit --audit-level=moderate` reports `found 0 vulnerabilities`.
- `npm run test` and `npm run build` pass.

### 2026-05-12 - PowerShell `Start-Process npm` failed

Symptoms:
- Starting the Vite dev server with `Start-Process -FilePath npm` failed with `%1 is not a valid Win32 application`.

Cause:
- On Windows, `npm` resolves through the command shim. `Start-Process` needs `npm.cmd`.

Fix:
- Used `Start-Process -FilePath npm.cmd ...`.

Verification:
- Vite started at `http://127.0.0.1:5173/`.

### 2026-05-12 - Upbit fetch failed inside sandbox

Symptoms:
- `npm run fetch:upbit` failed with `TypeError: fetch failed` and nested `EACCES`.

Cause:
- The default sandbox blocks external network access to Upbit.

Fix:
- Re-ran `npm run fetch:upbit` with approved escalated network access.

Verification:
- `data/market/upbit-krw-5m.json` was generated.
- `src/data/generated/upbitMarketData.ts` was generated.
- `npm run test` and `npm run build` passed afterward.

### 2026-05-12 - Production bundle grew after embedding candles in TypeScript

Symptoms:
- After increasing Upbit candles to roughly 1,195 per market, `npm run build` passed but warned that the JS chunk exceeded 500 kB.

Cause:
- Candle data was generated into `src/data/generated/upbitMarketData.ts`, so Vite bundled all cached candles into JavaScript.

Fix:
- Changed the fetch script to write `public/market/upbit-krw-5m.json`.
- Changed the app to load the JSON asynchronously and fall back to sample data if it is missing.
- Removed the generated TypeScript candle module.

Verification:
- `npm run build` passes without the large chunk warning.
- The app can fetch `http://127.0.0.1:5173/market/upbit-krw-5m.json` with `200 OK`.

### 2026-05-12 - Page stayed on `Sample Only` after adding real Upbit cache

Symptoms:
- The UI showed updated columns such as `Scenario`, but the mode stayed `Sample Only`.

Cause:
- After the async JSON load, the dashboard had to run real-data comparisons across 12 markets and multiple scenarios.
- Strategy modules recalculated indicators on every candle decision, making the browser-side comparison too slow to finish promptly.

Fix:
- Added per-candle-set/per-scenario indicator caches inside each strategy module.
- Restarted the Vite dev server.

Verification:
- `npm run test` and `npm run build` pass.
- `http://127.0.0.1:5173/` returns `200 OK`.

### 2026-05-12 - 90-day Upbit cache became large

Symptoms:
- `data/market/upbit-krw-5m.json` is about 69.9 MB.
- `public/market/upbit-krw-5m.json` is about 43.2 MB.

Cause:
- 90 days of 5-minute candles for 12 KRW markets produces roughly 250k to 300k candle rows.

Fix:
- Keep the JSON outside the JavaScript bundle under `public/market/`.
- Use chart aggregation in the UI so the visible charts can be reduced to N-minute/N-hour/N-day/N-month candles.

Verification:
- 90-day fetch completed successfully.
- `npm run test` and `npm run build` pass.

### 2026-05-12 - top-30 90-day Upbit fetch timed out

Symptoms:
- Fetching top-30 KRW markets for 90 days of 5-minute candles in one command exceeded the execution timeout.

Cause:
- The request count is large: roughly 30 markets times about 130 candle pages.

Fix:
- Added 30-day chunk fetch scripts:
  - `npm run fetch:upbit:top30:chunk0`
  - `npm run fetch:upbit:top30:chunk1`
  - `npm run fetch:upbit:top30:chunk2`
- Chunk1 and chunk2 reuse chunk0's selected market list so the merged cache uses one consistent top-30 universe.
- Added `npm run merge:upbit:top30` to merge chunks and remove duplicate timestamps.

Verification:
- All three chunks were downloaded.
- `npm run merge:upbit:top30` generated `data/market/upbit-krw-5m.json` and `public/market/upbit-krw-5m.json`.
- Merged payload reports 30 selected markets.

## Setup Notes

- If future commands fail because no `package.json` exists, initialize the selected stack first.
- If market-data downloads fail, record the provider, endpoint, status code, rate limit headers, and exact command here.
- If simulation output changes unexpectedly, save the scenario id, candle fixture, strategy parameters, and git state before changing logic.

## Diagnostic Commands To Add Later

- Package scripts: TBD after stack selection.
- Build command: TBD.
- Test command: TBD.
- Data import command: TBD.

## Issue Log Format

When an issue occurs, add entries like:

```text
### YYYY-MM-DD - Short title

Symptoms:
- What happened.

Cause:
- Why it happened, if known.

Fix:
- What changed.

Verification:
- Command or manual check that confirmed the fix.
```
