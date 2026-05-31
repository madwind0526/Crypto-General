# Active Context

## Current Work

Crypto-Currency Trading is a Vite + React + TypeScript local paper-trading dashboard for Upbit KRW markets. The current General workflow uses 1-minute candles, 7-day baseline backtracking, top-30 candidate selection by recent trade value among coins priced from 100 KRW through 10,000 KRW, and top-15 monitoring selection by optimized pure return. Daily Operation displays those 15 markets as a responsive board.

## Latest Decisions

- Keep the project local-first and simulation/paper-trading only. Real-money order placement is out of scope until audit logs, risk controls, duplicate-order prevention, emergency stops, and paper validation are much stronger.
- Upbit public market data is the current data source. API keys are not needed for the current historical and paper workflows.
- The active General strategies are:
  - General-A: Momentum / Trend Following.
  - General-B: Range / Grid Mean Reversion.
  - General-C: Statistical / Relative Value.
  - General-D: Range Re-entry.
  - General-E: Average Drop Cycle.
- The old in-repo anomaly slot was replaced by General-D. The separate `C:\Claude\Crypto-Anomaly` project owns anomaly-specific strategy behavior.
- Default operating view: `1 minute / 6 hours`, Guideline X, Safety X, pure return-rate ranking.
- Guideline and Safety options share the same inclusive 100~10,000 KRW top-30 candidate filter and top-15 monitoring count; the option changes signal acceptance, not the monitoring policy.
- Baseline backtracking uses `data/market/upbit-krw-1m-backtracking.json` and `npm run persist:traders`.
- `persist:traders` writes strict/ignored optimization plans and selected symbols under `data/local/traders/<strategy>/`.
- `build:dashboard-results` rebuilds `public/market/dashboard-results.json` from persisted optimization plans.
- Daily paper simulation uses retained warm-up candles before the operation boundary, but trade/return/balance accounting starts at the Daily Operation boundary, normally 00:00 KST.
- Daily rollover skips refit if the previous 24-hour 1-minute window is insufficient. If enough data exists, it blends previous parameters and newly optimized 24-hour parameters with a conservative previous/new weight, then snaps to the nearest valid scenario grid.
- WebSocket simulation compares:
  - WS X: candle-close-only behavior, intended to match the normal 1-minute paper flow.
  - WS O: in-minute trigger execution, falling back to candle-close processing when no in-minute trade occurs.
- Guideline-blocked buy signals are shown as sky-blue X markers. Safety-blocked buy signals are shown as red X markers. Guideline block color takes priority when both reasons apply.

## Recent Implementation Notes

- General-E tests 5/10/30/60-minute average trade-price windows, entry drops from -1% through <= -5%, average-stop thresholds from 0% through <= -5%, and take-profit thresholds from +1% through >= +5%.
- Daily Operation card sizing, chart height, font sizes, and price-axis width now respond to the browser window.
- `PaperTradingSession` is the shared engine for Daily Operation and WS live simulation.
- Current code-review fixes include:
  - backtest and paper risk exits use emergency-stop fallbacks;
  - backtest and paper do not immediately re-enter the same market on a risk-exit candle;
  - paper risk exits now include stop-loss, trailing-stop, and take-profit behavior;
  - WS-O locks a minute when any in-minute trade occurs, including risk-rule exits;
  - dashboard result generation skips empty selected plans and preserves full top-30 optimization plans;
  - Summary best-case selection uses pure return rate;
  - readable Korean trader profile strings were restored.
- Generated dashboard results should keep up to 30 price-filtered candidate markets and 15 selected markets per General strategy plan. Selected best results include trade/equity detail for Summary Safety comparison.
- `dashboard-results.json` now includes precomputed Guideline/Safety case comparison rows generated from the same source cache used to rehydrate the selected backtest results. The UI uses these generated rows first, avoiding a mismatch between 1-minute backtracking trades and the 5-minute dashboard display cache.
- Rollover optimization payloads now record the source cache path and optimization window. Dashboard result generation uses that path/window when rehydrating selected backtests, so a 24-hour rollover result is not accidentally recomputed over the whole retained daily cache.
- Backtest and paper trailing stops now use the previous high-water mark before updating with the current candle high, which avoids optimistic same-candle high-before-low assumptions.
- WS-O intraminute locks now block repeated signal evaluation for the locked minute but still allow later tick risk checks. Risk checks are scoped to the ticked market so another market's tick cannot close an open position using stale candles. Backtest risk-rule exits also apply sell slippage to match paper trading.
- Daily Operation polling refreshes `dashboard-results.json` along with the 1-minute daily cache and paper results. This keeps the displayed 15-market plan aligned after the 00:00 KST rollover, and the UI keeps all 15 selected cards visible even if a candle cache is briefly missing for a market.
- Crypto-Currency's dev server is pinned to `127.0.0.1:5174` to avoid colliding with the separate Crypto-Anomaly app on `5173`. The marathon watchdog now follows the Crypto-Anomaly pattern by watching the public paper-result file mtime as the primary freshness signal, with marathon status JSON as a fallback.
- Live operation scripts are bundled for Node ESM with external packages so Node 24 can load CommonJS-backed dependencies such as `ws` and `dotenv`. On live-trader startup, persisted holdings and trade history are preserved while `totalBudget` and `budgetPerCoin` are normalized from the current 15-market runtime configuration.
- Live-trader startup now rebuilds managed positions from the current selected-market Upbit balances before enabling the WebSocket loop. This removes dry-run-only positions during a live transition, preserves historical trades, absorbs existing selected-market Upbit holdings, and fails closed if account synchronization cannot complete.
- Live-trader startup synchronizes the union of newly selected markets and previously managed markets. This keeps real exchange holdings under management when a 00:00 KST rollover changes the selected top-15 plan while still dropping stale positions that no longer exist in the Upbit account.
- The Vite WS status plugin prefers the persisted WS PID over stale in-memory PID state. External WS restarts can therefore refresh `ws-live.pid` without the UI status endpoint deleting the new PID file while checking an older process.
- Live-trader balance snapshots now use Upbit total assets: KRW cash plus every held coin that has a KRW market ticker, not only locally managed or currently selected positions. Immediate and reconciled live fills bypass the 30-second heartbeat cache before recording `portfolioAfter`.
- Live-trader start balance is tagged with `startSnapshotScope: "upbit-total-assets"` and remains fixed across process restarts. The first corrected restart recalculated the baseline once from Upbit total assets.
- Legacy live trade rows with pre-fix `portfolioAfter` semantics are archived under `data/local/live-trader-trade-history-legacy-*.json` and removed from the active UI history once. New rows are tagged with `portfolioSnapshotScope: "upbit-total-assets"`.
- Startup Upbit position synchronization preserves existing managed positions while refreshing their exchange quantity and average buy price, and absorbs newly selected held positions. This avoids dropping already managed positions during a restart.

## Important Assumptions

- "Local storage folder" means durable local project data under `data/local/traders/` for reproducible files, while the browser UI may also use local state for convenience.
- Backtracking returns and Daily Operation returns can differ because backtracking is per-market historical evaluation, while Daily Operation is a one-position portfolio loop that rotates across the selected markets.
- Profit maximization must stay paired with risk controls because crypto markets can lose money quickly.

## Current Blockers

- Walk-forward validation and out-of-sample acceptance rules are still needed to reduce overfitting.
- A selected top-30 market can still be excluded from optimization when it has insufficient 1-minute history.
- Fee, slippage, order size, max daily loss, and portfolio constraints need stronger test coverage before any real-money discussion.

## Recommended Tools

- Vite + TypeScript + React for the local dashboard.
- lightweight-charts for market visualization.
- Vitest for strategy, indicator, simulation, and persistence tests.
- Files under `data/` and `public/market/` for reproducible market caches, strategy plans, and paper results.

## Next Startup Checklist

1. Read `AGENTS.md`, `GUIDERULES.md`, and all files in `memory-bank/`.
2. Use the existing Vite + React + TypeScript app skeleton.
3. Use Upbit public data as the current data source.
4. Preserve the current 1-minute, 7-day baseline backtracking and price-filtered top-30 -> top-15 monitoring workflow unless the user changes it.
5. Run `npm run test` and `npm run build` after strategy, simulation, script, or UI changes.
