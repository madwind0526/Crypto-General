# Crypto-Currency Trading

Local-first crypto trading research and paper-simulation dashboard.

This project compares several rule-based trading scenarios on Upbit KRW market data, selects monitoring candidates, and runs Daily Operation simulations before any real-money automation. It is experimental software and is not financial advice.

## What It Does

- Fetches Upbit public KRW candle data.
- Backtests five General strategies:
  - General-A: momentum / trend following
  - General-B: range / grid mean reversion
  - General-C: statistical / relative-value style arbitrage
  - General-D: range re-entry strategy
  - General-E: average drop cycle strategy
- Compares Guideline O/X and Safety O/X cases.
- Selects a daily monitoring universe from high trading-value coins.
- Displays 9 Daily Operation charts sorted by trade activity and daily paper return.
- Runs 1-minute paper trading simulations and keeps trade, return, and balance summaries.
- Supports a 24-hour marathon test with automatic daily rollover.

## Main Screens

- `Summary`: strategy ranking and Guideline/Safety case comparison.
- `General Scenario`: A/B/C/D/E strategy overview and import/export hooks.
- `General Scenario Report`: per-strategy rank and monitoring tables.
- `Base Guideline/Safety`: common Guideline and Safety rule overview.
- `Daily Operation`: live-style paper monitoring for General-A/B/C/D/E.

## Daily Operation Model

Daily Operation uses a separate 1-minute cache for monitored markets.

At a daily start boundary:

1. The previous 24-hour KST data is used for rollover optimization.
2. Top trading-value markets are selected for monitoring.
3. Strategy parameters are refreshed per market.
4. Paper simulation starts from the operation boundary.
5. Chart candle history is kept, but daily metrics reset from the boundary.

Charts show a highlighted vertical line at the Daily Operation start point.

## Backtracking To Daily Simulation Workflow

The app has two related but different optimization paths. This distinction matters when comparing report returns with Daily Operation paper returns.

### 1. Initial General Strategy Backtracking

`npm run persist:traders` builds the baseline General strategy plans from the 1-minute, 7-day backtracking cache.

1. Load `data/market/upbit-krw-1m-backtracking.json`.
2. For each General strategy, run both `Guideline O` and `Guideline X`.
3. Rank candidate markets by recent 1-minute quote trade value.
4. Keep the top candidate universe, currently up to 30 markets.
5. For each candidate market, test that strategy's scenario/parameter presets on that market's latest 7 days of 1-minute candles.
6. Pick the best scenario/parameter set for that market by pure return, with score used only as a tie-breaker.
7. Sort optimized markets by return rate and persist the top 9 monitoring plan.

Outputs are written under `data/local/traders/<strategy>/`:

- `scenarios/optimization-strict.json`
- `scenarios/optimization-ignored.json`
- `selected-symbols.strict.json`
- `selected-symbols.ignored.json`
- `market-params/<market>.<mode>.json`

The return shown in Strategy Report is this per-market historical backtest result. It is not the same calculation as the Daily Operation portfolio result.

### 2. Daily Rollover Optimization

`npm run paper:daily-rollover` is the 00:00 KST operating model used by the marathon loop.

1. Define the previous KST day as the optimization window.
2. Try to refresh the current Upbit KRW top 30 markets by 24-hour trading value.
3. Fetch/backfill 1-minute candles for those markets over the previous 24-hour window.
4. If the previous 24-hour data is not sufficiently available, skip refit and keep the existing parameters.
5. If the previous 24-hour data is available, re-run candidate selection and parameter optimization on that 24-hour 1-minute window.
6. Apply a minor refit instead of full replacement: blend previous parameters and newly optimized parameters with `ROLLOVER_REFIT_PREVIOUS_WEIGHT` (default previous 70%, new 30%).
7. Persist the refreshed top 9 daily plan under `data/local/traders/<strategy>/`.
8. Rebuild dashboard result JSON so the UI reads the refreshed plan.

This is a conservative one-day refit step. It does not fully replace the baseline parameters when previous parameters exist; it nudges them toward the newly optimized 24-hour result. If there is no reliable previous-day window, the current plan stays active.

### 3. Daily Operation Paper Simulation

`npm run paper:sim:1m:daily` runs the visible Daily Operation paper result.

1. Load the active persisted strategy plans from `data/local/traders/<strategy>/scenarios/optimization-*.json`.
2. Load retained 1-minute candles from `data/market/upbit-krw-1m-daily.json`.
3. Keep pre-00:00 candles as warm-up data for indicators and lookbacks.
4. Start decision, trade, return, and balance accounting from the Daily Operation boundary, normally 00:00 KST.
5. Run all four `Guideline/Safety` cases.
6. For each strategy, evaluate signals across the monitored markets at each timestamp.
7. Choose the best active signal and simulate one portfolio position at a time, including rotations.
8. Write results to `public/market/paper-trading-1m-daily-results.json`.

Daily Operation therefore differs from per-coin backtracking in several ways:

- Backtracking is usually single-market strategy evaluation; Daily Operation is a multi-market portfolio selection loop.
- Backtracking now uses 1-minute historical data for the latest 7 days; Daily Operation uses live-accumulating 1-minute candles and WS ticks.
- Backtracking return is for the selected market/scenario; Daily Operation return is for the active case's simulated portfolio.
- Daily Operation applies current `Guideline O/X` and `Safety O/X` choices.
- Daily Operation may rotate between markets, so a coin's backtest return does not directly equal the strategy's daily paper return.
- The latest implementation preserves pre-00:00 warm-up candles, but only counts daily trades/returns after the operation boundary.

### 4. WebSocket Live Simulation

WS live simulation reads the same active plans and retained candles, then compares:

- `WS X`: candle-close-only behavior, intended to match the normal 1-minute paper flow.
- `WS O`: reacts inside the current 1-minute candle when an entry/exit trigger appears, then falls back to candle-close processing if no in-minute trade occurs.

WS live also keeps warm-up candles before the Daily Operation boundary, but only replays decisions from the boundary.

### Why Backtracking And Daily Returns Can Differ

Large differences are expected when market regime changes, when a parameter was overfit to the historical window, or when the daily portfolio selection chooses/rotates differently from the single-coin backtest. The current daily refinement is a 24-hour weighted refit, not a guaranteed improvement loop. A stronger workflow would need walk-forward validation, multi-day rolling parameter scoring, and out-of-sample checks before accepting new parameters.

## Common Commands

Install dependencies:

```bash
npm install
```

Start the local dashboard:

```bash
npm run dev
```

Crypto-Currency uses `http://127.0.0.1:5174/` by default so it can run beside Crypto-Anomaly on `5173`.

Build and type-check:

```bash
npm run build
```

Run tests:

```bash
npm run test
```

Fetch 1-minute Daily Operation data:

```bash
npm run fetch:upbit:1m:daily
```

Fetch 1-minute, 7-day backtracking data:

```bash
npm run fetch:upbit:1m:backtracking
```

Persist baseline General strategy plans:

```bash
npm run persist:traders
```

Run 1-minute paper simulation:

```bash
npm run paper:sim:1m:daily
```

Run daily rollover optimization:

```bash
npm run paper:daily-rollover
```

Start a 24-hour marathon paper simulation:

```bash
npm run paper:marathon:day
```

Start the continuous marathon watchdog:

```bash
npm run paper:marathon:watchdog
```

## Data Locations

- `data/market/`: local market-data cache.
- `public/market/`: JSON files served to the browser dashboard.
- `data/local/traders/`: persisted strategy plans and per-market parameters.
- `data/local/paper-trading-1m-daily/`: Daily Operation paper results, status, and logs.

## Safety Note

The system is designed for backtesting and paper simulation only. Real exchange orders should remain out of scope until simulation, audit logging, risk controls, duplicate-order prevention, and emergency-stop behavior are thoroughly verified.
