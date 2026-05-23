# Implementation Plan

## System Architecture

The recommended first version is a local-first trading simulation dashboard.

- UI layer: trader selection bar, trader description panel, 9-symbol trend board, active trade marker, performance widgets, trade history view.
- Strategy layer: one strategy module per trader persona.
- Indicator layer: RSI, MACD, Bollinger Bands, volume spike, volatility proxy, and anomaly scoring.
- Simulation layer: historical candle playback, order fill assumptions, fees, slippage, position tracking, and performance metrics.
- Data layer: Upbit market data ingestion/cache, scenario files, selected symbol lists, simulation results, and trade logs.
- Safety layer: paper mode by default, no live order execution until explicit later phase.

## Upbit Integration Plan

- Phase 1: Use public Upbit Quotation APIs only. Fetch KRW market list, candles, ticker snapshots, trades, and orderbook data. No API key required.
- Phase 2: Add optional read-only private API integration for account balances. Requires an Upbit Open API key with `View Account` permission only.
- Phase 3: Add paper trading against real-time Upbit data.
- Phase 4: Add real order placement only after explicit approval, tests, safety limits, and an API key with `Make Orders` permission. Do not request or use withdrawal permissions.

Security rules:

- Never paste API keys into chat.
- Store keys only in local ignored environment files such as `.env.local`.
- Use the least permissions needed.
- Prefer a read-only key first.
- If order permission is later used, configure Upbit IP allowlisting and keep withdrawal permissions disabled.

## Proposed Folder And File Structure

- `src/app/`: application composition and routing/view orchestration.
- `src/ui/`: dashboard components, charts, trader selection, history panels.
- `src/traders/`: trader persona definitions and scenario presets.
- `src/strategies/`: pure strategy decision logic.
- `src/indicators/`: RSI, MACD, Bollinger Bands, volatility, volume, anomaly calculations.
- `src/simulation/`: backtesting engine, portfolio state, order fills, metrics.
- `src/data/`: Upbit data adapters, local persistence adapters, schemas.
- `src/types/`: shared TypeScript types.
- `data/market/`: downloaded or imported historical market data.
- `data/local/traders/`: per-trader local working data.
- `docs/`: longer research notes and provider documentation.
- `scripts/`: data import and simulation scripts.
- `tests/`: strategy, indicator, simulation, and persistence tests.
- `memory-bank/`: durable project context.

## Per-Trader Local Storage Shape

Suggested layout once data files are created:

```text
data/local/traders/
  momentum/
    scenarios/
    simulations/
    selected-symbols.<mode>.json
    trade-log.jsonl
  mean-reversion/
    scenarios/
    simulations/
    selected-symbols.<mode>.json
    trade-log.jsonl
  fear-greed/
    scenarios/
    simulations/
    selected-symbols.<mode>.json
    trade-log.jsonl
  anomaly/
    scenarios/
    simulations/
    selected-symbols.<mode>.json
    trade-log.jsonl
```

## Suggested Technology Stack

- Runtime/build: Node.js, Vite, TypeScript.
- UI: React.
- Charts: lightweight-charts for trading-style candles and trend panels, or ECharts for richer dashboard analytics.
- Persistence: IndexedDB for browser state, `data/` JSON/JSONL/CSV files for reproducible local records.
- Tests: Vitest for TypeScript modules.
- Future automation: WebSocket market streams and exchange SDKs only after the simulation core is trustworthy.
- Windows packaging: Tauri or Electron after the web app and backtest core stabilize. Prefer Tauri first unless Node-native desktop integration becomes necessary.

## Trader Strategy Modules

- `MomentumTrader`: first implementation priority. Use regime filter + trend/momentum confirmation + volume confirmation + strict exit rules.
- `MeanReversionTrader`: later implementation. Use range filter + Bollinger Band deviation/grid-like entry logic + stop when trend breakout invalidates the premise.
- `FearGreedTrader`: later implementation. Use panic/overheat detection using volatility proxy and volume spikes.
- `AnomalyTrader`: later implementation. Use symbol-specific abnormal movement score and relative-strength filters.

All trader modules must later support a guide-rule mode split:

- strict: raw strategy signals must pass `GUIDERULES.md` filters.
- ignored: raw strategy signals are evaluated without guide-rule filters.

Current implementation:

- `src/guideRules/evaluator.ts` evaluates Dow structure, moving averages, support/resistance, and candlestick warnings.
- `BacktestConfig.guideRuleMode` controls `strict` versus `ignored` behavior.
- `BacktestResult.signalAudit` records raw action, final action, guide-rule reasons, blockers, and warnings.
- `compareStrategiesByGuideMode` can compare strict and ignored results for each strategy.

Backtests and paper simulations should report both versions.

## Recommended Trading Method Roadmap

1. Regime-filtered momentum/trend following:
   - Rank 9 symbols by trend strength, momentum, volume confirmation, and liquidity.
   - Enter only when the broader regime is trending.
   - Exit on trend weakness, trailing stop, or invalidation.
2. Range/grid mean reversion:
   - Activate only when the market is sideways.
   - Use Bollinger Bands, z-score, or grid spacing to harvest oscillation.
   - Avoid strong-trend markets.
3. Statistical or funding-style arbitrage:
   - Add after reliable data feeds, fee modeling, and execution simulation.
   - Prefer paper trading first because costs, latency, borrow/funding, and exchange rules matter heavily.
4. Anomaly/pump-signal detection:
   - Build a daily candidate selector with suitable price, liquidity, volatility, and historical spike/reversion behavior.
   - Detect early public-market signals such as sudden relative volume, rapid multi-candle acceleration, order-book imbalance, spread change, and abnormal relative strength.
   - Exit using time stop, trailing stop, volume fade, acceleration failure, or sharp reversal.
   - Treat this as a high-risk anomaly strategy, not participation in manipulation.

Each strategy should return a structured decision:

- `hold`, `buy`, or `sell`.
- confidence score.
- reason codes.
- input snapshot.
- risk limits.
- expected invalidation condition.

## Backtesting And Scenario Optimization

Each strategy family should support parameter sweeps and walk-forward validation.

Current implementation status:

- Each strategy has curated scenario presets.
- `compareStrategies` tests every scenario against every cached market.
- The dashboard shows the best strategy, market, and scenario from the current cache.
- `buildTraderOptimizationPlan` can run the required A/B/C flow in memory: candidate markets by trade value, per-market scenario optimization, and selected monitoring markets.
- `compareStrategiesByGuideMode` is connected to the dashboard summary so strict and ignored modes can be compared side by side.
- `src/simulation/dailyOperation.ts` implements the current-position loop for hold, buy, sell, and rotate decisions.
- `src/app/App.tsx` presents the product as a left-menu/two-pane tool surface for scenario building, reports, guideline/safety review, and five General Daily Operation Simulation screens.
- Daily Operation screens are mapped as General-A -> momentum, General-B -> range/grid, General-C -> relative/arbitrage proxy, General-D -> re-entry, and General-E -> average-drop cycle. Each has linked Guideline O/X, Safety O/X, and WS O/X controls with a 9-chart monitoring board.
- Daily chart popups expose large graph, trade history, returns, and balance views for the active scenario/case.
- Scenario/guideline import/export controls are present as UI hooks; persistence validation and applying imported files remain future work.
- Daily Operation screens prefer `public/market/upbit-krw-1m-daily.json` when available. Baseline backtracking uses the 1-minute, 7-day cache.
- `fetch:upbit:1m:daily` reads the current selected-symbol files, builds the selected-market union, and fetches recent 1-minute candles.
- `paper:sim:1m:daily` runs all five General traders across Guideline/Safety cases on the 1-minute daily cache and writes summaries under `data/local/paper-trading-1m-daily/`.
- `paper:sim:1m:daily` also writes `public/market/paper-trading-1m-daily-results.json` so the browser can use 1-minute paper trades and equity curves.
- General refresh runs the full 1-minute top-30 optimization pipeline and selects 9 monitored markets per strategy.
- General Scenario Report is split into General-A, General-B, General-C, General-D, and General-E sections.
- Daily Operation cards sort by latest candle-window return and chart popups show scrolled trade history plus return/balance SVG trend graphs.
- True grid/random parameter search and walk-forward validation are still pending.

- Optimize on an in-sample historical window.
- Validate on an out-of-sample window.
- Report the best scenario by return, but also show max drawdown, win rate, profit factor, trade count, average hold time, and worst trade.
- Penalize strategies with too few trades, excessive drawdown, excessive turnover, or high sensitivity to one symbol.
- Model maker/taker fees, slippage, spread, and missed fills. This is especially important for grid, arbitrage, and anomaly strategies.

Suggested scenario parameter groups:

- Momentum: EMA periods, RSI thresholds, MACD settings, ADX/trend filter, volume confirmation, trailing stop.
- Range/grid: Bollinger period/deviation, grid spacing, range filter, max grid count, stop outside range.
- Arbitrage: pair/correlation threshold, z-score entry/exit, funding threshold, hedge ratio, rebalance interval.
- Anomaly: candidate liquidity range, relative volume threshold, acceleration threshold, minimum candle count, spread limit, time stop, trailing stop, cooldown.

Required optimization workflow:

- For A/B/C traders, scan all Upbit KRW markets and pick the top 30 by trading value.
- Optimize each trader's parameters separately for each of the 30 markets.
- Rank the 30 market-specific scenarios by pure return, with quality score as a tie-breaker, then select 9 markets for daily monitoring.
- During daily operation, use each market's own optimized parameters.
- If multiple markets fire a buy signal, choose the strongest signal or the higher-quality market.
- If a better opportunity appears while holding a position, compare expected return, risk, fees, and guide-rule alignment before rotating.

Next implementation detail:

- Fetch or cache enough Upbit KRW markets to support top-30 selection.
- Persist `TraderOptimizationPlan` outputs into `data/local/traders/<trader>/selected-symbols.<mode>.json`.
- Add UI display for candidate rank, selected 9 markets, selected scenario, guide/safety mode, return, drawdown, and rejected guide-rule/safety signals.

Current implementation:

- `fetch:upbit:top30:chunk0`, `chunk1`, and `chunk2` fetch three 30-day windows.
- `merge:upbit:top30` merges the chunk files into the dashboard cache.
- `persist:traders` writes compact strict/ignored optimization files under each trader directory.
- `paper:sim` runs a paper simulation from a persisted optimization plan and writes summary/decision logs.

## Anomaly/Pump-Signal Trader Details

This trader tries to detect abnormal public-market behavior in coins that historically show rapid spike-and-fade patterns.

Operational data flow:

- Each day, scan Upbit KRW markets and choose the active anomaly monitoring candidates from recent 1-minute data.
- During the trading day, monitor those candidates with 1-minute candles.
- Use 1-minute data for real-time detection, not as the default long-term storage format.
- After monitoring, compress normal 1-minute candles into 5-minute or 10-minute candles.
- Keep raw 1-minute data only around triggered events where later review needs exact timing.
- Retain only the needed rolling windows and prune older data.

Current implementation:

- `selectAnomalyCandidates` ranks historical candidates by spike history, fade behavior, liquidity fit, and volatility.
- `buildDailyAnomalyMonitoringPlan` selects monitoring markets and checks latest anomaly signals.
- `detectAnomalySignal` scores relative volume, short acceleration, range breakout, and overextension counter-action.
- The dashboard summary shows D trader monitoring candidates and latest signals from the cached candle set.

Candidate-selection features:

- price band and tick-size suitability
- 24h quote volume and liquidity range
- market cap or rank range, if available
- historical spike frequency
- average post-spike fade behavior
- spread and order-book depth
- exclusion of newly listed or news-driven assets when metadata is available

Signal features:

- relative volume versus same symbol's recent baseline
- close-to-close and high-low acceleration over 1m/5m candles
- breakout above recent range
- abnormal trade count, if available
- order-book bid/ask imbalance, if available
- volatility expansion followed by failed continuation

Risk controls:

- very small position size
- hard stop loss
- trailing stop
- maximum hold time
- no averaging down
- no trade after the move is already extended beyond a configured threshold
- cooldown after stop-out
- live trading disabled until extensive paper trading exists

## Data Model Concepts

- `TraderProfile`: id, name, description, strengths, weaknesses, default scenario.
- `Scenario`: indicator parameters, risk settings, selected interval, symbol universe, entry/exit rules.
- `Candle`: timestamp, open, high, low, close, volume.
- `Trade`: timestamp, trader id, symbol, side, price, size, fees, reason, scenario id.
- `Position`: symbol, quantity, average price, realized/unrealized PnL.
- `SimulationResult`: return rate, max drawdown, win rate, number of trades, Sharpe-like score if implemented.

## Verification Plan

- Unit test all indicator calculations with fixed sample candles.
- Unit test each strategy's decision output for known market states.
- Backtest simulation should be deterministic from the same input data.
- Test edge cases: missing candles, zero volume, rapid gaps, insufficient balance, duplicate buy/sell signals, and fee/slippage impact.
- UI verification should check that 9 symbol panels fit without overlap and active trade markers remain visible.
- Before Windows packaging, verify filesystem data access, API-key storage, app update behavior, installer signing expectations, and whether a local backend process is needed.
- Keep market data as external JSON (`public/market/*.json`) instead of embedding large candle arrays in TypeScript modules.
- Use `lightweight-charts` for market visualization. Current symbol cards and the large market modal render candlesticks with quote-volume histogram bars, candle-magnet crosshair hover, OHLC/value tooltip, and N-minute/N-hour/N-day/N-month aggregation.

## Safety Plan

- Keep live trading disabled by default.
- Use read-only market data in phase 1.
- Add paper trading before exchange order placement.
- Require explicit settings for max capital per trade, daily loss limit, max drawdown stop, max open positions, and emergency stop.
- Log every decision, including holds, so strategy behavior can be audited.
