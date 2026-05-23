# GUIDERULES.md

## Purpose

This file defines the trading guide rules for Crypto-Currency Trading.

These rules are not financial advice. They are project rules for simulation, backtesting, paper trading, and later decision auditing. Every trader should be testable in two modes:

- `guideRules: strict`: obey trend, pattern, candle, moving-average, support/resistance, and risk rules.
- `guideRules: ignored`: ignore these guide filters and trade only from the trader's raw strategy signal.

Comparing strict versus ignored mode is required before selecting a trader for real-money automation.

## Trader Operation Model

### General Traders A/B/C/D/E

General-A through General-E are normal strategy traders such as momentum, mean reversion, statistical/relative-value, re-entry, and average-drop cycle traders.

#### One-Time Or Update Run

1. Select potential coins.
   - Scan all Upbit KRW markets.
   - Select the top 30 markets by total trading value.

2. Optimize scenario parameters.
   - For each of the 30 markets, run backtesting while changing the trader's scenario parameters.
   - Find the highest-return parameter set for each individual market.
   - Result: 30 markets, each with its own best scenario parameters.

3. Select monitoring coins.
   - Rank the 30 markets by pure profit rate, using risk-adjusted quality only as a tie-breaker.
   - Select 9 markets for monitoring and display them as a 3x3 board.
   - Result: 9 markets, each with market-specific scenario parameters.

#### Daily Operation

1. Every morning, load the 9 selected markets and their market-specific parameter sets.
2. Check buy signals across the 9 markets.
3. If one market has a buy signal, enter that market.
4. While holding, monitor that market for sell timing.
5. If a sell signal appears, exit.
6. Resume scanning all 9 markets for the next buy signal.
7. If two or more buy signals appear at the same time, choose the stronger signal or the higher-quality market.
8. If a better buy signal appears while already holding another market, compare:
   - current position expected return
   - current position risk
   - new signal strength
   - market quality
   - fees and slippage
   If the new opportunity is meaningfully better, sell the current position and rotate into the new one.

#### Trader Selection

After a fixed period, compare General-A/B/C/D/E profit rate, drawdown, win rate, turnover, and stability.

The best trader can be selected by:

- backtracking/backtesting
- forward paper simulation
- a hybrid process: optimize on history, then validate for the next week in simulation

### Separate Anomaly Project

The older D anomaly slot was replaced in this project by General-D. Anomaly operation now lives in the separate `C:\Claude\Crypto-Anomaly` project and should not be mixed into the General-A/B/C/D/E workflow here.

The separate anomaly project must explicitly define:

- what counts as an abnormal signal
- how often abnormal signals occur
- how long abnormal signals usually last
- how to time buy and sell decisions during abnormal signals
- what to do if buy timing is missed
- what to do if buy happened but sell timing was missed
- what to do if the signal fails immediately after entry

Anomaly-specific lookback windows, candidate counts, retention rules, and daily monitoring behavior should be maintained in `C:\Claude\Crypto-Anomaly`, not in this General strategy project's operating model.

## Dow Theory Rules

### Uptrend

An uptrend is defined by:

- higher highs
- higher lows
- renewed highs after pullbacks
- lows that do not break the prior swing low

In strict mode:

- Prefer long entries only when the market is in an uptrend.
- A pullback is acceptable if it holds above the prior meaningful low.
- Do not treat every dip as a buy. The trend structure must remain intact.

### Downtrend

A downtrend is defined by:

- lower highs
- lower lows
- failed attempts to renew highs
- breakdown below prior swing lows

In strict mode:

- Avoid new long entries during clear downtrends.
- If already holding, use rebounds as possible exit zones.
- A rebound inside a downtrend is not a buy signal unless there is a confirmed trend reversal.

### Trend Reversal

For an uptrend:

- Watch for failure to renew highs.
- Watch for break below the prior meaningful low.
- If the uptrend breaks, reduce or exit long exposure.

For a downtrend:

- Watch for failure to renew lows.
- Watch for break above the prior meaningful high.
- A trend reversal is stronger when price breaks the prior high and then holds it as support.

## Chart Pattern Rules

### Buy-Favored Patterns

The following patterns can support buy decisions when confirmed by volume, trend context, and risk control:

- double bottom
- inverse head and shoulders
- bullish flag
- ascending triangle
- falling wedge
- bullish retest of broken resistance
- rising channel continuation, only if not overextended

Strict-mode buy confirmation:

- breakout above the neckline, resistance, or pattern boundary
- candle close beyond the key level
- volume expansion or relative volume confirmation
- stop level below the invalidation point

### Sell-Favored Patterns

The following patterns can support sell or avoid-buy decisions:

- double top
- head and shoulders
- bearish flag
- descending triangle
- rising wedge
- failed breakout
- support break after repeated support tests

Strict-mode sell confirmation:

- break below neckline, support, or pattern boundary
- candle close below the key level
- weak rebound after breakdown
- volume expansion on selloff or failed continuation

### Wait Patterns

Some patterns are not direct buy/sell signals until direction is confirmed:

- symmetrical triangle
- box/range
- expanding triangle
- unclear channel

Strict mode should wait for breakout direction before entry.

## Candlestick Rules

### Sell Or Warning Candles Near A Top

If the market is near a recent high or after a strong rise, the following candle groups are warning signs:

- hanging-man-like candle
- bearish engulfing
- dark-cloud-cover-like candle
- shooting-star-like candle
- evening-star-like sequence
- long upper wick after a fast rise
- strong black candle after small indecision candles
- consecutive bearish candles after a high

Strict mode:

- Do not open new long positions immediately after these appear near resistance.
- If already holding, tighten stop, take partial profit, or prepare exit.

### Downtrend Continuation Warning Candles

In a falling market, the following are not reliable buy signals by themselves:

- small rebound candles after a sharp fall
- weak bullish candles under resistance
- bearish continuation after a pause
- lower-high candles after a bounce
- failed hammer-like rebounds

Strict mode:

- Wait for trend reversal structure, not just a single bullish candle.
- Require a higher low, break of lower high, or moving-average recovery.

### Buy Candles Need Context

Bullish candles are only actionable when:

- they appear near support
- they follow exhaustion selling
- they break a meaningful level
- they are confirmed by volume or follow-through

## Moving Average Rules

Use two moving averages as a simple trend guide.

Suggested pairs from the reference image:

- short view: 5 and 10
- medium view: 50 and 100
- long view: 50 and 200

### Buy

Buy-favored moving-average conditions:

- golden cross: short MA crosses above long MA
- short MA moves up through long MA
- price pulls back near a rising moving average and rebounds
- both moving averages slope upward

### Sell

Sell-favored moving-average conditions:

- dead cross: short MA crosses below long MA
- short MA moves down through long MA
- price breaks below a key moving average and fails to recover
- moving averages slope downward

### Do Not Buy

Avoid buy entries when:

- the medium or long MA is clearly declining
- price is below downward-sloping moving averages
- a golden cross appears but the broader trend is still weak

### Do Not Sell

Avoid panic selling only from a small dip when:

- the long MA is still rising
- price remains above major support
- there is no confirmed trend break

## Support And Resistance Rules

### Support

Support is meaningful when price has reacted from the same zone at least twice.

Buy or reversal consideration:

- price approaches support
- price rejects the support level
- a reversal candle or breakout confirmation appears
- stop can be placed below support

If support breaks:

- support can become resistance
- strict mode should avoid immediate re-entry until reclaim confirmation

### Resistance

Resistance is meaningful when price has failed at the same zone at least twice.

Sell or avoid-buy consideration:

- price approaches resistance
- price fails to break resistance
- bearish candle or failed breakout appears
- stop or exit rule is clear

If resistance breaks:

- resistance can become support
- strict mode may allow buy on breakout or retest if trend supports it

## Signal Strength Ranking

When multiple markets produce buy signals, rank them by:

1. guide-rule alignment
2. strategy confidence
3. market-specific backtested return
4. drawdown risk
5. volume/liquidity quality
6. trend strength
7. distance to invalidation point
8. expected fee/slippage impact

If the current holding has weaker expected return and higher risk than a new signal, rotation is allowed in simulation or paper mode.

## Abnormal Signal Rules For D Trader

An abnormal signal should not mean "already pumped hard." It should mean early public-market behavior that statistically precedes fast movement.

Candidate abnormal-signal features:

- relative volume spike versus recent baseline
- rapid 1-minute or 3-minute price acceleration
- breakout above a short-term range
- high-low range expansion
- sudden repeated candle highs
- strong close near candle high
- abnormal value traded compared with prior candles
- order-book imbalance later, when order-book data is added

Do not buy if:

- the move is already too extended
- spread or slippage is too high
- signal appears after the likely profit window
- price immediately fails back into the prior range
- risk/reward is worse than the configured threshold

Counter-actions:

- missed buy: do not chase if extension limit is exceeded
- bought but sell missed: use hard stop, trailing stop, and time stop
- false breakout: exit quickly when price returns below breakout level
- volume fade: exit or tighten stop
- sharp reversal: exit immediately in strict mode

## Risk Rules

Strict mode must include:

- max capital per trade
- max daily loss
- max drawdown stop
- hard stop loss
- trailing stop when applicable
- take profit or partial take profit where applicable
- no averaging down unless explicitly tested
- no duplicate buy order for the same market
- emergency stop before any real-money execution

## Required Backtest Splits

Every trader must be evaluated in both guide-rule modes:

```text
A trader strict guide rules
A trader ignored guide rules
B trader strict guide rules
B trader ignored guide rules
C trader strict guide rules
C trader ignored guide rules
D trader strict guide rules
D trader ignored guide rules
```

Report at minimum:

- final return
- max drawdown
- win rate
- profit factor
- trade count
- worst trade
- turnover
- signal rejection count caused by guide rules
- performance difference between strict and ignored modes
