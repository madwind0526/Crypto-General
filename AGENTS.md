# AGENTS.md

## Project Overview

Crypto-Currency Trading is a local-first trading research and simulation project. The goal is to compare multiple autonomous trader personas, simulate their scenarios on historical crypto data, select 12 candidate symbols, and repeatedly choose one symbol to buy or sell based on the active trader strategy.

This project is not financial advice. Future work should treat all trading logic as experimental software, with simulation, paper trading, risk controls, and audit logs before any real-money automation.

## Memory Bank

New chats must read the `memory-bank/` documents before starting work. These files hold the durable project context and should be updated after meaningful design decisions, code changes, build/test runs, commits, or PRs.

- `GUIDERULES.md`: trading guide rules, chart-pattern rules, strict versus ignored guide-rule split, and A/B/C/D trader operating model.
- `memory-bank/design-document.md`: product purpose, target experience, core features, non-goals, and success criteria.
- `memory-bank/active-context.md`: current state, latest decisions, assumptions, blockers, and next startup checklist.
- `memory-bank/implementation-plan.md`: proposed architecture, folder structure, technology stack, patterns, and verification plan.
- `memory-bank/progress.md`: timeline, completed work, remaining work, status, and milestones.
- `memory-bank/trouble-shooting.md`: known issues, causes, fixes, and useful diagnostic commands.

## Proposed Folder Structure

- `src/`: application source once implementation starts.
- `docs/`: longer design notes, trading research notes, and API/reference documentation.
- `scripts/`: data import, simulation, and maintenance scripts.
- `data/market/`: local historical market data cache.
- `data/local/traders/`: local per-trader storage roots for scenario files, simulation results, and strategy snapshots.
- `tests/`: unit, integration, and strategy verification tests.
- `memory-bank/`: durable context for future Codex sessions.

## Suggested Technology Direction

- Frontend: Vite + TypeScript + React.
- Charting: lightweight-charts or Apache ECharts for 12-symbol trend panels and PnL views.
- Local persistence: browser IndexedDB for UI state and cached runs, plus filesystem-backed `data/` files for reproducible research runs.
- Simulation/research: TypeScript first for shared strategy logic; Python can be added later only if data science notebooks become necessary.
- Exchange/data APIs: start with Upbit read-only public market data, then add paper trading before any real exchange order integration.
- Windows app packaging: keep the app as a web core first, then wrap it with Tauri or Electron later. Prefer Tauri if small installer size and local filesystem access matter; prefer Electron if Node ecosystem integration becomes more important.

## Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start the local Vite development server.
- `npm run build`: run TypeScript and Vite production build.
- `npm run test`: run Vitest tests.

## Coding Conventions

- Keep strategy logic deterministic and testable.
- Separate market-data loading, indicator calculation, strategy decisions, portfolio/risk logic, order execution, and UI rendering.
- Record every simulated or live decision with timestamp, trader id, symbol, signal inputs, action, size, price, fee assumption, and resulting position.
- Avoid embedding API keys or secrets in source files. Use local ignored config or environment variables when external APIs are introduced.
- Treat real-money execution as out of scope until simulation, paper trading, audit logging, and kill-switch behavior are implemented.

## Verification Expectations

- Strategy changes need deterministic backtest fixtures.
- Indicator calculations should be tested against known sample data.
- UI changes should be checked at desktop and narrow viewport widths.
- Any trading/execution code must include tests for max position size, stop loss, fee/slippage assumptions, duplicate-order prevention, and emergency stop behavior.
