# Design Document

## Project Purpose

Crypto-Currency Trading is a local-first crypto trading dashboard and simulation system. It lets the user choose among multiple trader personas, give each trader its own scenario, test those scenarios against prior market data, select 12 candidate symbols, and repeatedly decide which single symbol should be traded at a given moment.

The user's stated goal is simple: make as much money as possible. The software goal is more disciplined: maximize risk-adjusted simulated performance first, then support paper trading and only later consider live execution.

## Problem To Solve

Crypto markets run 24 hours a day and change regime quickly. A single fixed strategy can work well in one market and fail badly in another. This project should make it easy to compare strategy personas, preserve each persona's local research, and show which symbol currently offers the best opportunity under the selected trader's scenario.

## Target Users

- A solo trader/developer experimenting with crypto trading scenarios.
- Future Codex sessions that need a stable memory-bank before implementing the app.

## Core Trader Personas

### 1. Momentum Trader

- Trend-following style.
- Uses indicators such as RSI and MACD.
- Enters after upward momentum is confirmed.
- Exits quickly when the trend weakens or reverses.
- Expected strength: volatile directional markets.
- Expected weakness: sideways markets and false breakouts.

### 2. Mean Reversion Trader

- Counter-trend style.
- Uses Bollinger Bands and overbought/oversold zones.
- Buys after excessive decline and sells after excessive rise.
- Expected strength: range-bound markets.
- Expected weakness: strong one-way trend markets.

### 3. Fear/Greed Trader

- Sentiment and extreme-market style.
- Uses volatility proxy signals, volume spikes, panic/overheat conditions, and possibly external sentiment indexes later.
- Buys when markets show panic and sells when markets show overheating.
- Expected strength: extreme dislocation zones.
- Expected weakness: low trade frequency and late confirmation.

### 4. Anomaly/Symbol-Specific Trader

- Focuses on unusual behavior in particular symbols rather than a broad market signal.
- Watches symbol-specific volume, volatility, spread, breakout, liquidity, order-book imbalance, abnormal relative strength, and pump-like intraday acceleration.
- The purpose is to detect abnormal public-market signals and either trade under strict risk limits or avoid dangerous manipulated markets.
- Expected strength: catching short-lived idiosyncratic moves before broad attention arrives.
- Expected weakness: high false-positive rate, severe slippage, fast reversals, manipulation risk, and regulatory/ethical concerns.
- Boundary: this project must not coordinate, promote, or participate in market manipulation. It can only observe public data and simulate/paper-trade defensive or opportunistic responses.

## Core Features

- Trader selection bar.
- Trader description panel explaining each strategy scenario.
- Per-trader local storage area for scenarios, selected symbols, simulation results, and trade logs.
- Historical-data-based scenario simulation.
- Backtesting for all initial strategy families:
  - regime-filtered momentum/trend following
  - range/grid mean reversion
  - statistical/funding-style arbitrage
  - anomaly/pump-signal detection
- Candidate selection for 12 watched symbols.
- 12-symbol trend board.
- Current active trade marker on the traded symbol.
- Trade history view.
- Profit/loss, return rate, win rate, drawdown, and per-trader performance summary.
- 24-hour capable monitoring loop, with future real-time data integration.

## First Product Shape

The first useful version should be a local dashboard, not an automated live trader. It should support backtesting and simulated/paper decisions first. Once strategy behavior is visible and auditable, live trading can be evaluated as a later phase.

## Non-Goals

- No real-money order execution in the first phase.
- No guarantee of profit.
- No opaque "black box" decisions without logs.
- No multi-user account system at the beginning.
- No leverage or derivatives trading until strong risk controls exist.

## Success Criteria

- Each trader persona can run a scenario simulation on the same historical dataset.
- The app can rank and display 12 watched symbols.
- Every simulated trade is logged and can be reviewed later.
- Performance metrics clearly show profit, loss, risk, and drawdown.
- Strategy outputs are reproducible from local stored data.
- The system prevents accidental live trading until paper trading and safety checks are deliberately added.
