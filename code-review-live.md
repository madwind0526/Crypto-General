# Live Trading Code Review

Review date: 2026-05-28 KST
Scope: current live trading related code in `scripts/live-trader.ts`, `scripts/live-trader.mjs`, `scripts/upbitOrder.ts`, `scripts/check-balance.ts`, `scripts/check-balance.mjs`, `src/app/App.tsx`, `src/strategies/arbitrage.ts`, and related package/config files.

No code changes were made as part of the review itself. This document reflects the review after the latest user-side fixes.

## Summary

The latest fixes materially improved the live trading safety path, but several real-money state-consistency risks remain:

- `live-trading-disabled.flag` now blocks new buys while still allowing sells and stop-loss exits.
- `live-trading-freeze-all.flag` is available when both buys and sells must be blocked.
- Buy fill handling now requires `filled.state === "done"` before recording a normal position.
- Buy position quantity is recorded from order `executed_volume`.
- Pending buy state is recorded when a market buy is not confirmed as `done` within the short polling window.
- Maximum open-position count, total budget, KRW balance, and daily realized-loss checks were added before live buys.
- Tick-level stop-loss checks were added, reducing dependence on minute-close-only exits.
- Upbit GET requests now have timeout, retry, and rate-limit handling; POST order placement is not retried.
- `LIVE_TRADING_ENABLED=true` is still required for live mode.
- `npm run test`, `npm run build`, and syntax checks pass.

One intentionally excluded item: automatic import of existing Upbit holdings into live-trader state. The user requested that behavior, so it is treated as an intended operating requirement rather than a defect.

## Verification

Commands run:

```text
node --check scripts/live-trader.mjs
node --check scripts/check-balance.mjs
npm run test
npm run build
git diff --check
```

Results:

- `node --check scripts/live-trader.mjs`: passed.
- `node --check scripts/check-balance.mjs`: passed.
- `npm run test`: passed. 19 test files, 77 tests.
- `npm run build`: passed.
- `git diff --check`: passed, with line-ending warnings only.

## Findings

| Priority | Finding | Evidence | Recommendation |
|---|---|---|---|
| High | Live Trade UI reset/flicker is not fully defended. The UI still accepts any fetched status payload as the latest truth. If an incomplete, stale, old-schema, or competing-writer status file appears briefly, the screen can still show initial/default-looking values before recovering. | `src/app/App.tsx:424-427` fetches `/market/live-trade-status.json` and immediately calls `setLiveTradeStatus(data)`. `scripts/live-trader.ts:241-254` writes a status payload without `schemaVersion`, `writerPid`, `sequence`, or `stateUpdatedAt`. `scripts/live-trader.ts:260` suppresses public-status write failures. | Add status metadata and UI guards: schema validation, monotonic `sequence` or timestamp rejection, `cache: "no-store"`, keep-last-good-status behavior, visible stale/error state, and writer identity/health fields. Also consider a single-instance process lock for `live-trader`. |
| High | Pending buy reconciliation can still lose partial fills. A pending order is only recorded as a position when `filled.state === "done"`. For `wait`/`watch`, the code cancels then deletes the pending record without accounting for possible `executed_volume > 0`. | `scripts/live-trader.ts:310-316` records only `done` fills. `scripts/live-trader.ts:318-328` cancels `wait`/`watch` orders and deletes the pending entry. | Reconcile by executed volume, not only final state. After cancel, re-query the order and record any executed volume/funds before deleting pending state. Preserve unresolved orders if cancellation or re-query fails. |
| High | Non-`done` sell orders are not tracked. If a sell is placed but not confirmed as `done` within the short polling window, local state keeps the position and no pending sell record exists. A later exchange-side fill could leave the bot state wrong and may lead to duplicate sell attempts. | `scripts/live-trader.ts:640-642` returns when sell fill is not confirmed, without pending-sell tracking, cancellation, or startup reconciliation. | Add pending sell tracking similar to pending buys, reconcile open/partial sells on startup and periodically, and avoid new orders on a market with unresolved exchange orders. |
| Medium | Daily loss enforcement only counts sell logs that already have `pnlKrw`. Older same-day sell records created before this field existed, or dry-run sell records, do not contribute to the daily loss limit. Unrealized loss is also not included. | `scripts/live-trader.ts:432-436` filters on `(t.pnlKrw ?? 0) < 0`. | Backfill/derive `pnlKrw` where possible, or compute realized PnL from buy/sell pairs. Decide whether the daily limit should also include unrealized drawdown before allowing new buys. |
| Medium | Public status write failures are hidden. This makes state/status divergence hard to detect and can leave the UI showing stale data while the live trader continues operating. | `scripts/live-trader.ts:255-260` catches and ignores all public-status write errors. | Log write failures with enough context, expose status health in the UI, and consider a degraded-state flag if status publishing fails repeatedly. |
| Medium | Live runner safety behavior is not covered by focused tests. | Current test suite passes, but there are no tests targeting live-trader order paths, pending buy/sell reconciliation, emergency/freeze flags, partial fills, stop-loss sells, exposure cap, daily loss cap, or duplicate-order prevention with a mocked Upbit adapter. | Extract a testable live-runner core or dependency-injected order adapter and add focused safety tests before relying on live automation. |
| Medium | Decision audit logs are still trade-only. | `scripts/live-trader.ts:62-72` defines trade logs, but hold decisions, blocked buys, risk checks, status publish failures, and input snapshots are not persisted. | Persist per-candle decision audit records for raw decision, final action, risk check result, block reason, and relevant inputs. |

## Resolved Since Previous Review

| Previous Issue | Current Status |
|---|---|
| Emergency stop blocked sells as well as buys. | Resolved. `live-trading-disabled.flag` blocks entries; `live-trading-freeze-all.flag` blocks both sides. |
| Buy fill handling accepted partial/non-final fills as normal positions. | Improved. Buy state now requires `filled.state === "done"` and positive `executed_volume`. Pending buy state exists, but partial-fill reconciliation still needs work. |
| Exposure controls only checked KRW balance. | Improved. Max open-position count, total budget, KRW balance, and daily realized-loss checks are now present. |
| Hard stop-loss was evaluated only on minute-close price. | Improved. Tick-level stop-loss exists, and minute-close handling also checks candle low. |
| Non-`done` buy orders disappeared immediately. | Improved. Such buys are now recorded in `pendingBuys`, but partial fills during cancel/reconcile still need to be handled safely. |
| Private API requests had timeout but no retry/rate-limit policy. | Improved. GET requests now retry with backoff for timeout/429/5xx; POST/DELETE are not retried. |
| Build and test health were previously broken. | Resolved. `npm run test` and `npm run build` pass. |
| Node-only Upbit order code lived under browser-compiled `src/`. | Resolved. The order adapter is under `scripts/upbitOrder.ts`. |
| Live trading could run whenever keys existed and `--dry-run` was absent. | Improved. `LIVE_TRADING_ENABLED=true` is required. |
| New buys used total account coin balance as position quantity. | Resolved. Buy position quantity comes from order `executed_volume`. |
| Same-market overlapping orders were possible. | Improved. `orderInProgress` is used in buy and sell paths. |
| State writes could race. | Improved. `saveState()` serializes writes through `saveChain`. |
| WebSocket reconnect could create overlapping connections/timers. | Improved. `activeWs` and `reconnectTimer` guard the connection path. |
| `startBalance` was overwritten on every startup. | Resolved. It is only initialized when missing. |
| Public live status writes were non-atomic. | Improved. Status writes use temp-file plus rename. |
| Dry-run state persistence was fire-and-forget. | Resolved. `recordDryTrade()` awaits `saveState()`. |

## Suggested Fix Order

1. Add robust live status publishing and UI consumption guards: schema/version, writer identity, monotonic sequence, keep-last-good-status, visible stale/error state, and public-status write error logging.
2. Make pending buy reconciliation volume-based: after cancel/re-query, record any partial executed volume before removing pending state.
3. Add pending sell tracking and startup/periodic reconciliation for non-`done` sells.
4. Harden daily loss enforcement for older trade logs and decide whether unrealized drawdown should block new entries.
5. Add focused live-runner tests with a mocked Upbit adapter.
6. Add per-candle decision audit logs and blocked-risk audit records.

## Current Risk Assessment

The live trader is significantly safer than the earlier reviewed versions, and build/test health is currently good. The remaining highest-risk area is still exchange-state reconciliation: buy and sell orders that are not confirmed as `done` must be reconciled by actual executed volume/funds, not just by final state labels. The UI reset/flicker issue also remains only partially addressed because the browser still accepts any status file as fresh truth. For real-money operation, the next safest step is to harden status metadata/validation and pending-order reconciliation before adding more strategy behavior.
