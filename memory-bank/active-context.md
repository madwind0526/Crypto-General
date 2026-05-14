# Active Context

## Current Work

The project now has an initial Vite + React + TypeScript application skeleton. It includes an Upbit public-data adapter, sample data fallback, technical indicators, four strategy modules, scenario preset optimization, a deterministic backtest runner, and a left-menu dashboard for scenario building, reports, and daily operation simulation on cached real Upbit public candles.

## Latest Decisions

- Use the Shelter-Defence project as the structural reference: root `AGENTS.md`, `memory-bank/`, and clear module ownership.
- Keep this project local-first at the beginning.
- Start with simulation and paper-style decisions before any live exchange trading.
- Exchange/data source selected: Upbit, focused on the user's existing Upbit account and KRW markets.
- Initial Upbit integration should use public Quotation APIs only for market/candle/ticker/orderbook data. API keys are not required for historical simulation.
- Private Upbit APIs should be added later in two steps: read-only account balance first, then order placement only after paper trading and safety controls are complete.
- Model the project around four trader personas:
  - Momentum Trader
  - Mean Reversion Trader
  - Fear/Greed Trader
  - Anomaly/Symbol-Specific Trader
- Track 12 watched symbols per active scenario.
- Show a visible active-trade marker when a symbol is currently being traded.
- Recommended first trading method: regime-filtered momentum/trend following. It is the best first implementation candidate because it is common, rule-based, easy to backtest, and fits the "choose the best one among 12 symbols" workflow.
- Later candidate methods: range/grid mean reversion for sideways markets, and statistical/funding-style arbitrage after stronger data/execution infrastructure exists.
- The user now wants all four strategy families implemented and backtested so each can search for its own highest-profit scenario, then compare the best result from each family.
- The fourth strategy is an anomaly/pump-signal detection trader. It should detect suspicious rapid price/volume behavior in suitable low/mid-liquidity coins, select 12 likely candidates daily, watch for early signals, and exit quickly under strict rules.
- Compliance boundary: do not build tools to coordinate, promote, or participate in pump-and-dump activity. The model may only analyze public market data and simulate/paper-trade strict-risk responses.
- Windows app direction: build the core as a Vite web app first, then package as a Windows desktop app later with Tauri or Electron. Tauri is the preferred first packaging candidate because it can keep the app smaller and still support local files.
- Current Upbit cache: top 30 KRW markets by 24h trade value, 5-minute candles, 90-day lookback, stored at `data/market/upbit-krw-5m.json` and served to the app from `public/market/upbit-krw-5m.json`.
- The top-30 cache is fetched as three 30-day chunks (`upbit-krw-5m-top30-30-0d.json`, `upbit-krw-5m-top30-60-30d.json`, `upbit-krw-5m-top30-90-60d.json`) and merged with duplicate timestamps removed.
- Current optimizer compares curated scenario presets per strategy, then selects the best strategy/scenario/market combination by score.
- UI navigation now uses a `View` dropdown with `Summary` plus each trader. `Summary` shows the comparison table; individual trader views show profile, selected best result, and recent simulated trades.
- Market cards now use candlestick + quote-volume charts with crosshair hover tooltips. A global interval control aggregates the small charts by N minutes, N hours, N days, or N months.
- Clicking a market card opens a large modal chart with the same candlestick/volume/hover behavior and its own interval control.
- Charts now cap the number of rendered X-axis candles by interval and variant. Mouse-wheel scrolling over a chart pans the visible time window left/right across the cached history.
- Large charts support click-to-measure points. The first candle click records P1, the second records P2, and the panel summarizes price difference, return, elapsed time, and volume/value difference.
- The anomaly trader needs 1-minute candles. Keep 5-minute candles as the main dashboard cache and store 1-minute candles separately under `data/market/upbit-krw-1m.json` for anomaly training/simulation so the browser does not load the huge file by default.
- Revised anomaly data approach: select 12 candidates daily from all KRW markets using 90 days of compressed 5m/10m history, monitor only those 12 at 1-minute resolution, compress normal monitoring data before storage, retain only 90 days, and keep raw 1-minute data only around triggered events.
- Added `GUIDERULES.md` as the project-level trading rule reference. It records A/B/C trader top-30 optimization -> top-12 monitoring flow, D trader anomaly flow, and strict versus ignored guide-rule split for every trader.
- `GUIDERULES.md` has started to become executable code. `src/guideRules/evaluator.ts` now evaluates Dow structure, moving averages, support/resistance, and candlestick warnings. `runBacktest` applies `guideRuleMode: strict | ignored`, records `signalAudit`, and counts `guideRejectedSignals`.
- A/B/C-style trader optimization now has a reusable pure module: `src/simulation/traderOptimization.ts`. It selects candidate markets by recent quote trade value, optimizes scenarios per market, ranks by backtest score, and returns the monitoring selection.
- Backtest results can now be viewed as a strict/ignored guide-rule split in the dashboard summary.
- The D trader now has a pure anomaly monitoring module: `src/simulation/anomalyMonitor.ts`. It builds daily anomaly monitoring plans from historical candidates and detects latest-candle volume/acceleration/breakout signals.
- A reusable daily operation decision engine exists in `src/simulation/dailyOperation.ts`. It chooses hold/buy/sell/rotate from ranked signals and the current position.
- The dashboard now uses a two-pane layout: a persistent left menu and a right workspace for login placeholder, scenario building, reports, and Daily Operation Simulation.
- Daily Operation Simulation has four views: General-A, General-B, General-C, and anomaly. Each view has a Guideline O/X toggle and centers on the selected 12 monitoring charts.
- Clicking a Daily Operation chart opens a popup with a large graph, trade history, hourly return table, and hourly balance table across the four strategy cases.
- Scenario and guideline screens expose import/export controls as UI hooks. Import currently reads the selected JSON filename; validation and applying imported strategy files are still pending.
- Korean UI strings in trader profiles and strategy-refresh labels were repaired after previous mojibake.
- Daily Operation now prefers a dedicated 1-minute cache at `public/market/upbit-krw-1m-daily.json` when present, falling back to the 5-minute dashboard cache otherwise.
- Added `npm run fetch:upbit:1m:daily` to fetch recent 1-minute candles for the union of selected monitoring markets.
- Added `npm run paper:sim:1m:daily` to run all four traders in strict and ignored guide-rule modes over the latest 1-minute daily cache.
- Latest 1-minute daily simulation used 26 selected Upbit KRW markets, max 1,440 candles. Results: General-A strict +0.58%, ignored -4.53%; General-B strict -0.77%, ignored -6.79%; General-C strict +1.95%, ignored -1.72%; anomaly strict/ignored 0.00% with no trades.
- General scenario Report now shows A, B, and C as separate report sections with their own metrics and monitoring selections.
- The strategy refresh UI is split into General Refresh and Anomaly Refresh. The Vite refresh API accepts `scope=general` for the heavier top-30/5m optimization pipeline and `scope=anomaly` for the 1m daily fetch plus 1m paper simulation flow.
- Daily Operation cards are sorted by the latest visible candle return, so each refresh redraws the 12 charts in return order. This is cheap because only 12 cards are sorted client-side.
- Daily Operation chart cards now pass 1-minute paper-simulation trades to `MarketChart`, so buy/sell markers appear as `B` and `S` symbols on mini and large charts when trades exist.
- The Daily Operation popup now uses a scrolled trade-history table and SVG trend graphs for return and balance instead of only tabular hourly values.
- General scenario screens no longer show A/B/C details all at once. General scenario building and General scenario Report now use A/B/C choice tabs and display only the selected General strategy detail.
- General scenario Report shows the selected strategy's top RANK table as the top 3 candidates, while the lower PICK table still shows all 12 selected monitoring candidates.
- Daily Operation now has an independent Auto Block O/X selector beside Guideline O/X. The current decision layer treats the four cases as Guideline O/X x Auto Block O/X and blocks risky buy signals into hold when auto-block is enabled.
- Daily Operation chart cards now separate interactions: clicking a card opens only that market's large graph, while each card's Trades/Return/Balance buttons open a current-scenario aggregate popup across the 12 monitored markets. The aggregate popup filters by Guideline O/X and Safety O/X; trade history is chronological across the 12 markets, return trends show only traded markets, and balance trends show the selected scenario's total portfolio balance.
- Daily Operation summary removed the redundant Case tile and now shows the four remaining summary tiles in one compact desktop row.
- Daily Operation removed per-card Trades/Return/Balance buttons from inside chart cards; the aggregate buttons now live in the 12-market panel header.
- Daily Operation return trend lines now use a stable color per market, while Guideline/Safety combinations are distinguished by line patterns.
- Daily Operation return trend legends are split into Coin color labels and Guideline/Safety line-style labels.
- Daily Operation trend graphs now show y-axis tick labels and horizontal guide lines for return and balance views.
- Daily Operation chart markers now use the same Safety O/X filtered trade set as the aggregate Trades popup, so blocked trades no longer appear on cards when Safety O is active.
- Daily Operation card ordering now prioritizes markets with Safety-filtered daily paper trades, then sorts those markets by per-market daily paper return; non-traded markets fall back to current candle-window return.
- The redundant Daily Operation 기준 panel was removed from Daily Operation screens.
- Daily Operation sidebar entries now show only the scenario names; redundant Guideline O/X captions were removed.
- The app now polls Daily Operation market cache and paper simulation results every 15 seconds, so marathon test updates automatically refresh cards, graphs, trade tables, return trends, and balance trends.
- The app stores the active sidebar screen in localStorage, so browser refresh returns to the screen the user was viewing instead of Summary.
- Daily Operation Balance trend popups now default to Guideline All / Safety All, and large/trend charts reserve more y-axis label space so price and balance labels are not clipped.
- Daily Operation Guideline O/X and Auto Block O/X controls are synchronized across General-A, General-B, General-C, and anomaly screens; changing one Daily scenario changes the same mode on the others.
- Report screens now show both Guideline O/X and Auto Block O/X controls, synchronized with Daily Operation. Daily Operation card return labels now match the sorting rule: traded markets show daily paper return, while non-traded markets show the fallback price-window return.
- A 24-hour day-trading marathon simulation was started in the background on 2026-05-14 16:45 KST. Runtime status is written to `data/local/paper-trading-1m-daily/marathon-status.json`; logs are under `data/local/paper-trading-1m-daily/logs/`.
- Daily anomaly operation should not continuously rotate monitoring symbols during a marathon run. The preferred operating model is to choose the 12 anomaly monitoring symbols once per day at a fixed scheduled time, keep the previously backtested strategy/scenario assignment during the day, and only change strategy parameters through an explicit Strategy Refresh.
- The first marathon run was paused at cycle 167 for code-review fixes. Applied fixes include Upbit retry/backoff wrappers in the TS client and marathon/fetch scripts, explicit anomaly lookback guards, binary-search candle lookup in paper trading, momentum max ATR as a scenario parameter, corrected arbitrage z-score calculation, KST UI time formatting, and repair of broken UI strings.
- Daily Operation now shows card top-right as the current price return from the visible daily baseline, and the card summary as BUY/SELL/BLOCK counts plus the coin's paper return. The large market popup shows the same current-return and trade-summary metrics. Daily Operation top summary now shows best coin, best coin trade counts, best coin return, and total portfolio return for the active Guideline/Safety setting.
- UI terminology now presents Auto Block as Safety. Base Guideline was renamed to Base Guideline/Safety, exposes Guideline O/X and Safety O/X buttons, and those controls synchronize with reports and Daily Operation screens. The General Scenario Report no longer renders the extra Monitoring Selection Summary block at the bottom.
- Daily Operation daily metrics now reset at 00:00 KST every day. Card current-return, BUY/SELL/BLOCK counts, per-coin paper return, aggregate trade tables, return trends, and balance trends only include events from the active KST day, so the longest daily window is 24 hours before it resets.
- Summary middle report now renders a compact Guideline/Safety 4-case comparison. Each strategy has one row with O/O, O/X, X/O, and X/X cells showing return, max drawdown, trades, and blocked count. Safety O is currently an estimated overlay that replays the same backtest trades after applying the automatic block rules.
- A fresh 24-hour marathon run was started on 2026-05-14 21:17 KST with `MARATHON_START_AT_KST=2026-05-14T19:15:00+09:00` and `MARATHON_RESET_CACHE=true`. The 1-minute daily cache was reset so chart x-axes start no earlier than 2026-05-14 19:15 KST.
- MarketChart now formats lightweight-charts x-axis ticks and crosshair time labels in Asia/Seoul, so the chart axis no longer shows UTC while custom tooltips show KST.
- Trader optimization outputs are persisted under `data/local/traders/<trader>/`. Paper simulation outputs are persisted under `data/local/paper-trading/<trader>/`.

## Important Assumptions

- "Local storage folder" means durable local project data under `data/local/traders/` for reproducible files, while the eventual browser UI may also use IndexedDB/localStorage for app state.
- The first implementation should avoid real-money orders.
- The user wants maximum profit, but the implementation should expose risk controls because crypto markets can lose money quickly.
- The initial UI is likely a dashboard/tool surface, not a landing page.

## Current Blockers

- Top-30 data, trader plan persistence, and first paper simulation are wired. One currently selected top-30 market may still be excluded from optimization when it has insufficient history.
- Initial simulation interval is 5-minute candles over roughly 90 days. This is better for early comparison, but robust optimization still needs walk-forward validation and out-of-sample checks.
- Fee, slippage, order size, stop loss, and portfolio constraints are not yet defined.
- The anomaly/pump-signal trader needs higher-resolution data than daily candles. Recommended minimum: 1m or 5m OHLCV; ideally trade ticks and order-book snapshots.
- Need a clear backtest optimizer policy to avoid overfitting and lookahead bias.
- Dependencies need to be installed and the first build/test run needs to pass.

## Recommended Tools

- Vite + TypeScript for a fast local dashboard.
- lightweight-charts or ECharts for multi-symbol price/trend displays.
- IndexedDB for browser-side local state and cached UI data.
- Files under `data/` for reproducible scenarios, market caches, and trade logs.
- A public exchange market-data API such as Binance, Coinbase, Kraken, or Upbit/Bithumb depending on the intended market.
- Backtesting engine built as deterministic TypeScript modules first.
- Vitest for strategy and indicator tests once the package is initialized.
- Walk-forward validation and out-of-sample testing for scenario optimization.
- Public regulatory references for the anomaly trader safety boundary:
  - CFTC virtual currency pump-and-dump advisory: https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/beware_virtual_currency_pump_dump.html
  - SEC 2024 crypto asset manipulation enforcement release: https://www.sec.gov/newsroom/press-releases/2024-166
- Upbit official docs:
  - Korean overview: https://docs.upbit.com/kr/reference
  - API key guide: https://global-docs.upbit.com/docs/api-key
  - Authentication guide: https://global-docs.upbit.com/reference/authentication

## Next Startup Checklist

1. Read `AGENTS.md` and all files in `memory-bank/`.
2. Read `GUIDERULES.md` before changing strategy, signal, ranking, or execution behavior.
3. Use the existing Vite + React + TypeScript app skeleton.
4. Use Upbit as the first exchange/data source.
5. Choose candle intervals and historical lookback period.
6. Replace the current top-12-by-volume selector with strategy-specific candidate ranking.
7. Run install/build/test before adding more behavior.
8. Add true parameter sweeps and walk-forward validation before private API integration.
