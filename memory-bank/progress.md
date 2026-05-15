# Progress

## Timeline

- 2026-05-12: Project planning started. Memory-bank and root agent instructions created for Crypto-Currency Trading.

## Completed Work

- Captured the project goal and initial trader personas.
- Reviewed Shelter-Defence's project organization pattern.
- Created initial memory-bank documents.
- Created root `AGENTS.md`.
- Defined a proposed local-first architecture and folder responsibilities.
- Added initial trading-method recommendation: implement regime-filtered momentum/trend following first, then add range/grid mean reversion and arbitrage-style methods later.
- Updated scope to cover four implemented/backtested strategy families: momentum, range/grid mean reversion, statistical/funding arbitrage, and anomaly/pump-signal detection.
- Added safety boundary for the anomaly strategy: public-data detection only, no coordination or participation in manipulation.
- Selected Upbit as the exchange/data source. First implementation should use public market data only; private account/order APIs are later phases.
- Created the initial Vite + React + TypeScript app skeleton.
- Added Upbit public data adapter for KRW market list, minute candles, and ticker snapshots.
- Added sample candle data for offline development.
- Added technical indicators: SMA, EMA, RSI, MACD, Bollinger Bands, ATR, and rate of change.
- Added four initial strategy modules and a deterministic backtest runner.
- Added a dashboard that compares the four strategies on sample data.
- Added first Vitest indicator tests.
- Recorded Windows app packaging direction: keep a shared web core, then package later with Tauri or Electron.
- Installed npm dependencies and generated `package-lock.json`.
- Upgraded Vitest to `4.1.6` after audit found moderate development dependency issues through older nested Vite/esbuild versions.
- Verified `npm run test`, `npm run build`, and `npm audit --audit-level=moderate`.
- Started the Vite dev server at `http://127.0.0.1:5173/`.
- Added `npm run fetch:upbit` to download public Upbit KRW market data.
- Downloaded top 12 KRW markets by 24h trade value using Upbit public APIs.
- Cached 5-minute candles under `data/market/upbit-krw-5m.json`.
- Generated `src/data/generated/upbitMarketData.ts` so the dashboard can run the same backtest engine against cached real Upbit data.
- Updated the dashboard to prefer real Upbit cached data and fall back to sample data only when no cache exists.
- Extended Upbit fetching from one 200-candle page to six pages, producing about 1,195 5-minute candles per selected market.
- Added per-strategy scenario candidates so the optimizer compares multiple parameter presets for each strategy family.
- Added dashboard display of the winning scenario name.
- Moved large market data out of the JavaScript bundle. The fetch script now writes both `data/market/upbit-krw-5m.json` and `public/market/upbit-krw-5m.json`; the app loads the public JSON asynchronously and falls back to sample data.
- Reduced production bundle size after removing embedded generated candle data.
- Optimized strategy evaluation by caching indicator arrays per candle set and scenario. This prevents the browser from recalculating EMA/RSI/MACD/Bollinger/ROC on every candle during real Upbit backtests.
- Restarted the Vite dev server after the optimization and confirmed `http://127.0.0.1:5173/` returns `200 OK`.
- Replaced the simple symbol sparkline bars with `lightweight-charts` mini candlestick charts.
- Added quote-volume histogram bars underneath each mini candlestick chart.
- Verified `npm run test` and `npm run build`, then restarted the dev server.
- Replaced the always-visible trader button row with a single `View` dropdown.
- Added a `Summary` dropdown option that shows the four-strategy comparison table.
- Added per-trader views that show the selected trader's profile, best scenario metrics, and recent simulated trades.
- Enabled `lightweight-charts` crosshair lines on mini market charts so hovering shows a stock-chart-style horizontal/vertical guide with labels.
- Changed mini chart crosshair mode to candle magnet behavior and added an OHLC/quote-volume tooltip for the hovered candle.
- Made the per-trader simulated trade list vertically scrollable with mouse-wheel support and expanded it from the last 12 trades to the full trade history for the selected best result.
- Reduced mini chart tooltip opacity so it does not fully cover candles beneath it.
- Added a Light/Dark theme toggle in the top bar and wired chart colors to the selected theme.
- Added `UPBIT_LOOKBACK_DAYS` support to the Upbit fetch script.
- Downloaded 90 days of 5-minute Upbit public candles for the top 12 KRW markets.
- Added a reusable `MarketChart` component so both small cards and the large view render candlesticks, quote-volume bars, candle-magnet crosshair, and OHLC/value tooltip consistently.
- Added a global small-chart interval control for N minutes, N hours, N days, or N months.
- Added click-to-open market detail modal with a large chart and its own interval control.
- Verified `npm run test` and `npm run build` after the 90-day data and chart updates.
- Added interval-based X-axis candle limits so low intervals do not render the full 90-day history at once.
- Added mouse-wheel chart panning so wheel movement shifts the visible date window left/right.
- Added an on-chart visible date range badge.
- Added large-chart P1/P2 click measurement with chart markers and a summary panel for close-price difference, return rate, elapsed time, volume difference, and quote-value difference.
- Documented the anomaly trader data lifecycle in `docs/anomaly-data-pipeline.md`.
- Added pure anomaly candidate selection logic based on spike frequency, post-spike fade, liquidity suitability, and volatility.
- Added anomaly retention/compression helpers to convert monitored data into compressed 5-minute/10-minute history and prune data older than 90 days.
- Added tests for anomaly candidate selection and retention/compression behavior.
- Added `GUIDERULES.md` from the attached trading-rule images and user workflow notes.
- Linked `GUIDERULES.md` from `AGENTS.md` and memory-bank startup context.
- Added executable guide-rule evaluation for Dow structure, moving averages, support/resistance, and candlestick warnings.
- Added `guideRuleMode: strict | ignored` to the shared trading types and backtest config.
- Integrated guide-rule filtering into `runBacktest`; strict mode can reject raw buy signals, and every non-hold/rejected signal is recorded in `signalAudit`.
- Added `compareStrategiesByGuideMode` so strategy results can be split into strict versus ignored modes.
- Added guide-rule tests covering ignored mode, strict rejection, and backtest audit behavior.
- Verified `npm run test` and `npm run build` after guide-rule code integration.
- Added `src/simulation/traderOptimization.ts` for A/B/C-style optimization flow: top markets by trade value, per-market scenario optimization, and top monitoring-market selection.
- Added tests for trade-value ranking and market-specific scenario optimization.
- Verified `npm run test` and `npm run build` after trader optimization pipeline work.
- Added a `Guide rules` UI selector so the dashboard can run backtests in `strict` or `ignored` mode.
- Added summary cards showing each trader's candidate count and selected monitoring markets.
- Added per-trader monitoring selection table showing selected market, candidate rank, best scenario, return, drawdown, and guide-rule rejected signal count.
- Verified `npm run test` and `npm run build` after connecting optimization results to the UI.
- Added `src/simulation/anomalyMonitor.ts` for D trader daily anomaly monitoring plans and latest-candle anomaly signals.
- Added `src/simulation/dailyOperation.ts` for hold/buy/sell/rotate decision selection from ranked market signals and the current position.
- Added tests for anomaly monitoring and daily operation decisions.
- Added summary UI sections for strict/ignored guide-rule split and D trader anomaly monitoring preview.
- Verified `npm run test` and `npm run build` after completing the step-6 implementation pass.
- Added 30-day chunked Upbit top-30 fetch scripts and a merge script.
- Downloaded three 30-day chunks for the current Upbit KRW top-30 and merged them into the 90-day 5-minute cache.
- Added `persist:traders` to write compact trader optimization outputs under `data/local/traders/<trader>/`.
- Added `paper:sim` to run a first paper-trading simulation from the persisted optimization plan.
- Generated top-30 based trader plans. The current run produced 29 eligible candidate markets because one top-30 market had insufficient candle history.
- Ran momentum strict paper simulation from the persisted plan: final value about 1,070,342 KRW, return about 7.03%, 2 trades.
- Updated dashboard chart visibility: Summary shows one representative chart per trader, while each trader view shows only that trader's selected 12 monitoring charts.
- Removed the Anomaly Monitoring Preview section from the Summary page while keeping the anomaly trader logic available.
- Added buy/sell trade markers to market charts: buy entries use ▲, sell exits use ▼, and sell marker text includes profit/loss classification and round-trip return.
- Simplified graph interval controls to four presets: 1 minute / 6 hours, 5 minutes / 1 day, 30 minutes / 1 week, and 1 hour / 1 month. Dashboard cache now keeps enough recent candles for the 1-month preset.
- Added a local strategy refresh API and Summary button concept: `전략 재실행` starts top-30 chunk fetch, merge, trader persistence, dashboard cache build, and dashboard results build with a progress overlay. The dev server must be restarted after this Vite config change.
- Made the individual trader overview/result section and monitoring-selection table collapsible, with both sections closed by default.
- Fixed guide-rule mode selection for individual trader screens by adding strict/ignored result sets to `dashboard-results.json`; the UI now switches displayed comparisons and monitoring selections without rerunning browser backtests.
- Reworked the UI into a left-menu/two-pane application shell.
- Added menu entries for login placeholder, General scenario builder, anomaly scenario builder, guideline overview, Summary report, General report, anomaly report, and four Daily Operation Simulation screens.
- Added scenario/guideline import and export UI hooks. Export downloads current plan/policy JSON; import currently records the chosen file name for later validation/application.
- Added Daily Operation views for General-A, General-B, General-C, and anomaly, each with a Guideline O/X toggle and 12 selected monitoring charts.
- Added chart-click popup tabs for large graph, trade history, hourly returns, and hourly balance across all four scenario cases.
- Repaired Korean-facing trader profile text and strategy refresh labels.
- Verified `npm run test` and `npm run build` after the left-menu UI pass.
- Added a 1-minute Daily Operation data path: `npm run fetch:upbit:1m:daily` fetches the selected monitoring-market union into `data/market/upbit-krw-1m-daily.json` and `public/market/upbit-krw-1m-daily.json`.
- Added `npm run paper:sim:1m:daily` to run General-A/B/C and anomaly simulations in both Guideline O/X modes on the latest 1-minute cache.
- Fetched 1-minute daily candles for 26 selected markets and ran the 1,440-step paper simulation. Results: momentum strict +0.58%, momentum ignored -4.53%, range-grid strict -0.77%, range-grid ignored -6.79%, arbitrage strict +1.95%, arbitrage ignored -1.72%, anomaly strict/ignored 0.00%.
- Verified `npm run test` and `npm run build` after adding the 1-minute Daily Operation flow.
- Split the top-bar refresh controls into General Refresh and Anomaly Refresh. The API now dispatches to separate step lists based on `scope=general` or `scope=anomaly`.
- Updated the General Scenario Report to render A, B, and C as separate report sections instead of only one combined table.
- Daily Operation cards now sort by current candle-window return, and the cost is negligible because the UI sorts only 12 cards after data refresh.
- Daily Operation charts now receive 1-minute paper-simulation trades; chart markers show `B` for buy and `S` plus round-trip return for sell.
- Daily Operation popups now provide a scrolled trade-history table plus return and balance trend graphs.
- Re-ran `paper:sim:1m:daily`, `npm run test`, and `npm run build`; all passed.
- Changed General scenario building and General scenario Report from all-A/B/C expanded layouts to A/B/C selectable tabs that show only the selected strategy detail.
- Adjusted General scenario Report so the upper RANK table shows the top 3 candidates and the lower PICK table continues to show all 12 selected monitoring candidates.
- Added Daily Operation Auto Block O/X selection beside Guideline O/X. Auto Block currently applies in the decision layer by converting risky buy signals to hold, creating four visible daily operation cases.
- Changed Daily Operation popups so Trades/Return/Balance operate at the active scenario level instead of per chart. The popup now scopes to the active trader only, covers all 12 monitored markets, and provides Guideline/Safety filters for chronological trade history, traded-market return trends, and total balance trends.

## Current Status

Initial implementation is underway. The app skeleton and strategy/backtest core exist, dependencies are installed, test/build/audit verification passed, and the dashboard now uses a left-menu layout with 90 days of cached Upbit public 5-minute candle data loaded from JSON.

## Remaining Work

- Add Upbit orderbook retrieval.
- Move heavier 90-day backtests into a worker or precomputed result cache if browser startup becomes slow.
- Add true parameter sweeps and walk-forward validation beyond the current curated scenario presets.
- Wire the anomaly candidate selector to a script that scans all Upbit KRW markets and writes `data/local/traders/anomaly/candidates/YYYY-MM-DD.json`.
- Build the 1-minute anomaly monitor loop for the selected 12 markets.
- Add compressed anomaly history files and daily retention pruning.
- Add UI loading from persisted `data/local/traders/<trader>/` outputs instead of recalculating every dashboard load.
- Persist strict versus ignored guide-rule comparison outputs under `data/local/traders/<trader>/`.
- Show persisted 1-minute paper simulation summaries directly inside the Daily Operation screens.
- Updated Daily Operation cards and market popups so the top-right number is the current baseline price return, while the trade summary shows BUY/SELL/BLOCK counts plus per-coin paper return. The Daily Operation header now summarizes best coin, best coin trade counts, best coin return, and active-case total return.
- Renamed Auto Block UI wording to Safety, added Safety O/X to Base Guideline/Safety, synchronized those toggles across reports and Daily Operation, removed the redundant General Report monitoring summary, and repaired remaining broken Korean UI strings.
- Changed Daily Operation baseline logic to reset at 00:00 KST. Daily card returns, trade summaries, popup trade lists, return trends, and balance trends now use only the current KST day's data.
- Replaced the Summary page's middle comparison with a compact Guideline/Safety 4-case comparison table: Guideline O/Safety O, Guideline O/Safety X, Guideline X/Safety O, and Guideline X/Safety X. Each cell shows return, max drawdown, trades, and blocked count.
- Restarted the 24-hour marathon test from a fixed KST chart baseline: cache reset from 2026-05-14 19:15 KST, first cycle completed, and the runtime status is running under `data/local/paper-trading-1m-daily/marathon-status.json`.
- Hid the `KRW-` prefix from UI market labels while keeping raw market ids unchanged internally.
- Replaced the visible anomaly strategy slot with General-D Range Re-entry, added the strategy implementation and tests, tracked last sell price for backtest/paper re-entry gates, disabled paper rotation for General-D, and regenerated General-D strict/ignored optimization plus 1-minute daily paper results.
- Folded General-D into the General Scenario builder and General Scenario Report tabs, so A/B/C/D are selected together from one General area instead of having separate General-D Scenario/Report menu entries.
- Changed the persisted monitoring model from top-12 to top-30 per strategy, added per-market parameter cache files, and kept the Daily Operation chart grid limited to the top 12 by daily trade activity and paper return.
- Added sortable General Scenario Report monitoring tables: default Return descending, with column-header click toggles for Pick, Market, Candidate, Scenario, Return, Max DD, and Rejected.
- Added exact-start daily paper backtracking support and ran a 2026-05-15 00:00 KST to 21:16 KST experiment into `data/local/paper-trading-1m-today/` and `public/market/paper-trading-1m-today-results.json`.
- Extended the 1-minute paper simulation to emit all four Guideline/Safety cases and ran the 2026-05-15 00:00 KST to 21:16 KST case experiment into `data/local/paper-trading-1m-today-cases/` and `public/market/paper-trading-1m-today-cases-results.json`.
- Added `npm run paper:daily-rollover` for the 00:00 KST operating model. The script reuses the previous KST day's 1-minute cache, selects the daily top-30 by trade value, re-optimizes General A/B/C/D scenario parameters for strict/ignored guide modes, writes `selected-symbols.*.json` and `market-params/*.json`, and can rebuild dashboard results. The marathon loop now runs this automatically when the KST day changes, reloads the monitoring universe, and starts the new day from 00:00 KST.
- Manually ran the daily rollover on 2026-05-16 00:13 KST, treating the current time as the daily boundary. The previous 24h window produced 29 eligible monitoring markets, dashboard results were rebuilt, and a fresh 24h marathon run was started at 2026-05-16 00:14:58 KST with cache reset.
- Changed Daily Operation marathon caching so a daily reset no longer deletes previous chart candles. The chart cache now retains historical candles across the reset, paper simulation receives `PAPER_START_AT` for daily-only calculations, and MarketChart renders a vertical daily-start marker at `operationStartAt`. The running marathon was restarted with operation start `2026-05-16 00:14:58 KST`; the cache currently spans from `2026-05-15 00:00 KST` while daily metrics start at the operation boundary.
- Reworked the Daily Operation start marker to use a lightweight-charts series primitive instead of a DOM overlay. The marker snaps to the nearest visible candle when the exact operation start timestamp is between aggregated candles, which fixes the missing vertical line on 5-minute and larger intervals.
- Expand guide-rule filters with more exact pattern detection from `GUIDERULES.md`.
- Add active trade markers directly on chart candles using backtest/paper-trading trade events.
- Build market-data ingestion and local cache.
- Implement indicators:
  - RSI
  - MACD
  - Bollinger Bands
  - volatility proxy
  - volume spike
  - anomaly score
- Implement strategy modules for the four trader personas.
- Implement deterministic simulation/backtesting.
- Implement parameter optimization and walk-forward validation for each strategy family.
- Add trade logs and performance metrics.
- Expand paper-trading loop to all traders and both guide modes, then add a daily/weekly forward simulation report.

## Next Milestones

1. Stack decision and package initialization.
2. Static dashboard prototype with sample data.
3. Indicator library with tests.
4. Backtest engine with one trader persona.
5. All four trader personas.
6. 12-symbol ranking and selection flow.
7. Trade history and PnL analytics.
8. Paper trading integration.
