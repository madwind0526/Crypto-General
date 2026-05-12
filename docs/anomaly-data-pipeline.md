# Anomaly Trader Data Pipeline

## Goal

The anomaly trader should watch many Upbit KRW markets, select 12 likely candidates each day, monitor only those candidates at 1-minute resolution, and persist older data in a smaller compressed form.

Live order execution remains disabled until paper trading, safety limits, and explicit approval are complete.

## Data Lifecycle

1. Daily candidate selection
   - Scan all KRW markets.
   - Use the most recent 90 days of compressed 5-minute or 10-minute candles.
   - Select 12 markets with abnormal-spike potential.
   - Save the daily list under `data/local/traders/anomaly/candidates/YYYY-MM-DD.json`.

2. Intraday monitoring
   - Read the selected 12 markets at 1-minute resolution.
   - Keep fresh 1-minute candles in memory or a short-lived rolling file.
   - Detect relative volume spikes, rapid acceleration, range breakouts, and failed continuation.

3. Event handling
   - If an abnormal signal appears, produce a structured trade decision.
   - Record the signal snapshot, reasons, and risk settings.
   - Execute only in simulation or paper mode until live trading is explicitly enabled.

4. Storage compression
   - Do not store all 1-minute monitoring data forever.
   - After the monitoring window closes, aggregate normal 1-minute candles into 5-minute or 10-minute candles.
   - Keep raw 1-minute data only around important events if needed, for example 60 minutes before and after a trigger.

5. Retention
   - Keep only the latest 90 days of compressed anomaly history.
   - Delete older compressed candles and old temporary 1-minute buffers.
   - The retained 90-day history becomes the input for the next daily candidate selection.

## Suggested Local Files

```text
data/local/traders/anomaly/
  candidates/
    2026-05-12.json
  monitoring/
    2026-05-12.live-1m.jsonl
  events/
    2026-05-12-KRW-EXAMPLE-spike.json
  compressed/
    anomaly-krw-5m.json
    anomaly-krw-10m.json
```

## Candidate Selection Signals

The daily selector should score markets with:

- spike frequency: how often price jumps quickly and then fades
- post-spike fade behavior: whether spikes tend to retrace
- suitable liquidity: active enough to trade, not so large that abnormal moves are rare
- volatility: enough movement to matter, but not random noise only
- price and tick-size suitability where available
- exclusion filters for newly listed or news-driven assets when metadata exists

## Monitoring Signals

The 1-minute monitor should watch:

- relative volume versus the recent baseline
- 1-minute and 3-minute price acceleration
- breakout above recent range
- high-low range expansion
- volume fade after the first surge
- sharp reversal from the candle high
- optional order-book imbalance later

## Compression Rule

Default:

- Monitor with 1-minute candles.
- Persist normal history as 5-minute candles.
- Persist very long-term trend context as 10-minute candles if storage becomes too large.
- Keep raw 1-minute slices only around triggered events.

## Retention Rule

All compressed files should be pruned so their oldest candle is no older than 90 days from the current run time.

Temporary 1-minute monitoring files should be removed after compression unless they were promoted to an event snapshot.
