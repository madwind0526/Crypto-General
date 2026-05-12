# Active Context

## Current Work

The project now has an initial Vite + React + TypeScript application skeleton. It includes an Upbit public-data adapter, sample data fallback, technical indicators, four strategy modules, scenario preset optimization, a deterministic backtest runner, and a dashboard comparing strategy results on cached real Upbit public candles.

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
- The dashboard now exposes a `Guide rules` selector, summary monitoring-selection cards, strict/ignored comparison, anomaly monitoring preview, and a per-trader monitoring selection table.
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
