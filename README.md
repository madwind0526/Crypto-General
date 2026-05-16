# Crypto-Currency Trading

Local-first crypto trading research and paper-simulation dashboard.

This project compares several rule-based trading scenarios on Upbit KRW market data, selects monitoring candidates, and runs Daily Operation simulations before any real-money automation. It is experimental software and is not financial advice.

## What It Does

- Fetches Upbit public KRW candle data.
- Backtests four General strategies:
  - General-A: momentum / trend following
  - General-B: range / grid mean reversion
  - General-C: statistical / relative-value style arbitrage
  - General-D: range re-entry strategy
- Compares Guideline O/X and Safety O/X cases.
- Selects a daily monitoring universe from high trading-value coins.
- Displays 12 Daily Operation charts sorted by trade activity and daily paper return.
- Runs 1-minute paper trading simulations and keeps trade, return, and balance summaries.
- Supports a 24-hour marathon test with automatic daily rollover.

## Main Screens

- `Summary`: strategy ranking and Guideline/Safety case comparison.
- `General Scenario`: A/B/C/D strategy overview and import/export hooks.
- `General Scenario Report`: per-strategy rank and monitoring tables.
- `Base Guideline/Safety`: common Guideline and Safety rule overview.
- `Daily Operation`: live-style paper monitoring for General-A/B/C/D.

## Daily Operation Model

Daily Operation uses a separate 1-minute cache for monitored markets.

At a daily start boundary:

1. The previous 24-hour KST data is used for rollover optimization.
2. Top trading-value markets are selected for monitoring.
3. Strategy parameters are refreshed per market.
4. Paper simulation starts from the operation boundary.
5. Chart candle history is kept, but daily metrics reset from the boundary.

Charts show a highlighted vertical line at the Daily Operation start point.

## Common Commands

Install dependencies:

```bash
npm install
```

Start the local dashboard:

```bash
npm run dev
```

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

## Data Locations

- `data/market/`: local market-data cache.
- `public/market/`: JSON files served to the browser dashboard.
- `data/local/traders/`: persisted strategy plans and per-market parameters.
- `data/local/paper-trading-1m-daily/`: Daily Operation paper results, status, and logs.

## Safety Note

The system is designed for backtesting and paper simulation only. Real exchange orders should remain out of scope until simulation, audit logging, risk controls, duplicate-order prevention, and emergency-stop behavior are thoroughly verified.
