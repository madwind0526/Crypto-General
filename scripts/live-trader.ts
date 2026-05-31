/**
 * live-trader.ts — 업비트 실매매 실행기
 *
 * 사용법:
 *   1. .env 파일에 UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY 설정
 *   2. node scripts/live-trader.mjs --dry-run   (주문 없이 신호만 로그)
 *   3. node scripts/live-trader.mjs             (실제 주문 실행)
 *
 * 자금 배분:
 *   TOTAL_BUDGET (기본 1,000,000원) ÷ 15코인 = 코인당 66,666원
 *   E 전략 targetWeight 0.9 → 매수금액 ≈ 60,000원/회
 */
import "dotenv/config";
import WebSocket from "ws";
import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { cancelOrder, getAccounts, getKrwBalance, getOrder, placeMarketBuy, placeMarketSell } from "./upbitOrder";
import { fetchKrwMarkets, fetchTickers } from "../src/data/upbitClient";
import { averageDropCycleStrategy } from "../src/strategies/averageDropCycle";
import type { Candle, StrategyContext } from "../src/types/trading";

// ── 설정 ────────────────────────────────────────────────────────────────────

const ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? "";
const LIVE_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
const DRY_RUN = process.argv.includes("--dry-run") || !ACCESS_KEY || !SECRET_KEY || !LIVE_ENABLED;

const TOTAL_BUDGET = Number(process.env.LIVE_BUDGET ?? 1_000_000);   // 총 운용금액 (KRW)
const MAX_COINS = 15;
const BUDGET_PER_COIN = Math.floor(TOTAL_BUDGET / MAX_COINS);         // 코인당 할당 예산
const TARGET_WEIGHT = 0.9;                                             // general-e targetWeight (100,000원/회)
const ORDER_AMOUNT = Math.floor(BUDGET_PER_COIN * TARGET_WEIGHT);     // 1회 매수금액
const MIN_ORDER_KRW = 5_500;                                           // 업비트 최소 주문 + 여유
const MAX_DAILY_LOSS_KRW = Number(process.env.MAX_DAILY_LOSS_KRW ?? Math.floor(TOTAL_BUDGET * 0.10)); // 기본 10%

const root = process.cwd();
const statePath = path.join(root, "data", "local", "live-trader-state.json");
const publicStatusPath = path.join(root, "public", "market", "live-trade-status.json");
const lockPath = path.join(root, "data", "local", "live-trader.lock");
const planDir = path.join(root, "data", "local", "traders", "general-e");
const maxCandles = 1440;
const minPrice = Number(process.env.LIVE_MIN_PRICE ?? 100);
const maxPrice = Number(process.env.LIVE_MAX_PRICE ?? 10_000);

const wsUrl = "wss://api.upbit.com/websocket/v1";

// ── 상태 ────────────────────────────────────────────────────────────────────

interface LivePosition {
  market: string;
  quantity: string;       // 코인 수량 (string으로 유지 — 업비트 API와 동일)
  avgBuyPrice: number;    // 평균 매입가 (KRW)
  entryAt: string;        // ISO timestamp
  orderUuid: string;
}

interface PortfolioSnapshot {
  krwCash: number;
  invested: number;
  coinValue: number;
  totalValue: number;
  pnl: number;
  at: string;
}

interface LiveState {
  startedAt: string;
  totalBudget: number;
  budgetPerCoin: number;
  positions: Record<string, LivePosition>;   // market → position
  trades: LiveTradeLog[];
  lastSellAt: Record<string, number>;        // market → candle timestamp
  startBalance?: number;                      // 최초 시작 시 총 평가액
  startSnapshot?: PortfolioSnapshot;          // 기동 시 포트폴리오 스냅샷 (UI 잔고 현황용, 변경 안됨)
  pendingBuys?: Record<string, PendingBuy>;   // uuid → 미완료 매수 주문
  pendingSells?: Record<string, PendingSell>; // uuid → 미완료 매도 주문
  startSnapshotScope?: "upbit-total-assets";
  tradeHistorySnapshotScope?: "upbit-total-assets";
  tradeHistoryResetAt?: string;
}

interface LiveTradeLog {
  at: string;
  market: string;
  side: "buy" | "sell";
  amount: number;          // KRW (buy) or coin qty (sell)
  price: number;           // 추정 체결가 (candle close)
  actualPrice?: number;    // 실제 체결가 (Upbit 조회값)
  netKrw?: number;         // 실수령 KRW: 매수=지출액, 매도=executed_funds - paid_fee
  pnlKrw?: number;         // 실현 손익 (매도시): netKrw - 매수 원가
  portfolioAfter?: PortfolioSnapshot; // 체결 직후 Upbit 전체 보유 자산 평가 스냅샷
  portfolioSnapshotScope?: "upbit-total-assets";
  dryRun: boolean;
  reasonCodes: string[];
}

interface PendingBuy {
  uuid: string;
  market: string;
  amount: number;      // 주문 KRW
  price: number;       // 추정 체결가
  reasonCodes: string[];
  at: string;          // ISO timestamp
  recordedVolume?: string; // 이미 state에 반영한 체결량
}

interface PendingSell {
  uuid: string;
  market: string;
  quantity: string;    // 매도 코인 수량
  price: number;       // 추정 체결가
  reasonCodes: string[];
  at: string;          // ISO timestamp
  costBasis: number;   // avgBuyPrice × quantity (손익 계산용)
  recordedVolume?: string; // 이미 trade log에 반영한 매도 체결량
}

// ── 캔들 버퍼 ────────────────────────────────────────────────────────────────

interface UpbitTick { type: string; code: string; trade_price: number; trade_volume: number; trade_timestamp: number }
interface LiveCandle { market: string; timestamp: number; open: number; high: number; low: number; close: number; volume: number; quoteVolume: number }

const closedCandles: Record<string, Candle[]> = {};
const liveCandle: Record<string, LiveCandle> = {};
const lastMinute: Record<string, number> = {};

let state: LiveState;
let selectedMarkets: string[] = [];
const marketScenario = new Map<string, import("../src/types/trading").StrategyScenario>();

// 동시 실행 방지
let saveChain: Promise<void> = Promise.resolve();
let reconcileChain: Promise<void> = Promise.resolve();
const orderInProgress = new Set<string>(); // 매수/매도 진행 중인 마켓

// 비상 정지 파일 경로
// live-trading-disabled.flag  → 신규 매수 차단 (매도/손절은 허용)
// live-trading-freeze-all.flag → 매수·매도 모두 차단
const emergencyStopPath = path.join(root, "data", "local", "live-trading-disabled.flag");
const freezeAllPath = path.join(root, "data", "local", "live-trading-freeze-all.flag");

// 전체 Upbit 평가액 캐시 — heartbeat의 연속 API 호출을 줄이고 체결 직후에는 우회한다.
let cachedKrwCash: number | null = null;
let cachedKrwCashAt = 0;
let cachedPortfolioSnapshot: PortfolioSnapshot | null = null;
let krwMarketSetPromise: Promise<Set<string>> | null = null;

// 공개 상태 파일 단조 증가 시퀀스 — UI의 역순/오래된 응답 거부에 사용
let statusSequence = 0;
const writerRunId = `${process.pid}-${Date.now()}`;
let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
let statusPublishingEnabled = false;

// WebSocket 싱글턴
let activeWs: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function isEntryBlocked(): Promise<boolean> {
  try { await access(emergencyStopPath); return true; } catch {}
  try { await access(freezeAllPath); return true; } catch {}
  return false;
}

async function isAllTradesBlocked(): Promise<boolean> {
  try { await access(freezeAllPath); return true; } catch { return false; }
}

async function acquireProcessLock() {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockHandle = await open(lockPath, "wx");
      await lockHandle.writeFile(JSON.stringify({
        pid: process.pid,
        writerRunId,
        startedAt: new Date().toISOString(),
        mode: DRY_RUN ? "dry-run" : "live",
      }, null, 2), "utf8");
      console.log(`[live-trader] lock 획득: ${lockPath}`);
      return;
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (error.code !== "EEXIST") throw e;

      const lock = await readLockFile();
      if (lock?.pid && isProcessAlive(lock.pid)) {
        throw new Error(`live-trader가 이미 실행 중입니다. pid=${lock.pid}, startedAt=${lock.startedAt ?? "unknown"}`);
      }

      console.warn("[live-trader] stale lock 감지 — 제거 후 재시도");
      await unlink(lockPath).catch(() => {});
    }
  }
  throw new Error("live-trader lock 획득 실패");
}

async function readLockFile(): Promise<{ pid?: number; startedAt?: string } | null> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8")) as { pid?: number; startedAt?: string };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const error = e as NodeJS.ErrnoException;
    return error.code === "EPERM";
  }
}

async function releaseProcessLock() {
  const handle = lockHandle;
  lockHandle = null;
  if (!handle) return;
  try {
    await handle.close();
  } catch {}

  try {
    const lock = await readLockFile();
    if (!lock?.pid || lock.pid === process.pid) {
      await unlink(lockPath);
      console.log("[live-trader] lock 해제");
    }
  } catch {}
}

// ── 초기화 ───────────────────────────────────────────────────────────────────

async function init() {
  await acquireProcessLock();

  if (DRY_RUN) {
    console.log("[live-trader] ⚠️  DRY RUN 모드 — 실제 주문 없음");
    if (!ACCESS_KEY) console.log("[live-trader] 이유: UPBIT_ACCESS_KEY 미설정");
    else if (!SECRET_KEY) console.log("[live-trader] 이유: UPBIT_SECRET_KEY 미설정");
    else if (!LIVE_ENABLED) console.log("[live-trader] 이유: LIVE_TRADING_ENABLED=true 미설정 (.env)");
  } else {
    console.log("[live-trader] 🔴 실매매 모드");
  }

  // 플랜 로드 — 코인별 최적 시나리오 매핑
  const planPath = path.join(planDir, "selected-symbols.ignored.json");
  console.log(`[live-trader] 플랜 파일: ${planPath}`);
  const plan = JSON.parse(await readFile(planPath, "utf8")) as {
    selectedMarkets: { market: string; bestResult: { scenarioId: string } }[];
  };
  selectedMarkets = await filterKnownOutOfRangeMarkets(plan.selectedMarkets.map((m) => m.market));
  for (const item of plan.selectedMarkets) {
    if (!selectedMarkets.includes(item.market)) continue;
    const scenario = averageDropCycleStrategy.scenarios.find((s) => s.id === item.bestResult.scenarioId)
      ?? averageDropCycleStrategy.defaultScenario;
    marketScenario.set(item.market, scenario);
  }
  console.log(`[live-trader] 대상 코인 (${selectedMarkets.length}개): ${selectedMarkets.map((m) => m.replace("KRW-", "")).join(", ")}`);
  for (const [market, scenario] of marketScenario) {
    console.log(`[live-trader]   ${market.replace("KRW-", "").padEnd(8)} → ${scenario.name}`);
  }

  // 캔들 히스토리 로드 (백테스트 캐시에서)
  await loadCandleHistory();

  // 상태 파일 로드 또는 초기화
  state = await loadState();

  // 업비트 잔고 동기화 + 미완료 주문 정산
  if (!DRY_RUN) {
    await resetLegacyTradeHistory();
    await syncPositionsFromUpbit();
    await reconcilePendingBuys();
    await reconcilePendingSells();
  }

  await resetStartBalanceForRun();
  statusPublishingEnabled = true;

  console.log(`[live-trader] 코인당 예산: ${BUDGET_PER_COIN.toLocaleString()}원 | 1회 매수: ${ORDER_AMOUNT.toLocaleString()}원`);
  console.log(`[live-trader] 현재 포지션: ${Object.keys(state.positions).length}개`);

  await writePublicStatus(state);
  connect();
}

async function filterKnownOutOfRangeMarkets(markets: string[]) {
  const cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { candlesByMarket: Record<string, Candle[]> };
    return markets.filter((market) => {
      const candles = cache.candlesByMarket[market] ?? [];
      const lastPrice = candles[candles.length - 1]?.close;
      const keep = lastPrice === undefined || (lastPrice >= minPrice && lastPrice <= maxPrice);
      if (!keep) console.warn(`[live-trader] 제외 ${market}: ${lastPrice}원은 ${minPrice}~${maxPrice}원 범위 밖입니다.`);
      return keep;
    });
  } catch {
    return markets;
  }
}

async function loadCandleHistory() {
  const cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { candlesByMarket: Record<string, Candle[]> };
    for (const market of selectedMarkets) {
      closedCandles[market] = (cache.candlesByMarket[market] ?? []).slice(-maxCandles);
    }
    console.log(`[live-trader] 캔들 히스토리 로드 완료`);
  } catch {
    console.warn("[live-trader] 캔들 히스토리 없음 — 빈 상태로 시작 (워밍업 필요)");
    for (const market of selectedMarkets) closedCandles[market] = [];
  }
}

async function loadState(): Promise<LiveState> {
  try {
    const loaded = JSON.parse(await readFile(statePath, "utf8")) as LiveState;
    return {
      ...loaded,
      totalBudget: TOTAL_BUDGET,
      budgetPerCoin: BUDGET_PER_COIN,
    };
  } catch {
    const fresh: LiveState = {
      startedAt: new Date().toISOString(),
      totalBudget: TOTAL_BUDGET,
      budgetPerCoin: BUDGET_PER_COIN,
      positions: {},
      trades: [],
      lastSellAt: {},
      startBalance: undefined,
    };
    await saveState(fresh);
    return fresh;
  }
}

async function saveState(s: LiveState): Promise<void> {
  // 동시 saveState 경쟁 조건 방지: 순차 실행 + 스냅샷 즉시 캡처
  const snapshot = JSON.stringify(s, null, 2);
  await (saveChain = saveChain.catch(() => {}).then(async () => {
    await mkdir(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, snapshot, "utf8");
    await rename(tmp, statePath);
    await writePublicStatus(s);
  }));
}

async function resetLegacyTradeHistory() {
  if (state.tradeHistorySnapshotScope === "upbit-total-assets") return;

  const resetAt = new Date().toISOString();
  if (state.trades.length > 0) {
    const archivePath = path.join(
      root,
      "data",
      "local",
      `live-trader-trade-history-legacy-${resetAt.replace(/[:.]/g, "-")}.json`,
    );
    await writeFile(archivePath, JSON.stringify({
      archivedAt: resetAt,
      reason: "portfolioAfter changed to Upbit total-assets valuation",
      trades: state.trades,
    }, null, 2), "utf8");
    console.log(`[live-trader] 이전 거래 이력 ${state.trades.length}건 보관: ${archivePath}`);
  }

  state.trades = [];
  state.tradeHistorySnapshotScope = "upbit-total-assets";
  state.tradeHistoryResetAt = resetAt;
  await saveState(state);
  console.log(`[live-trader] 거래 이력 기준 재설정: ${resetAt}`);
}

async function computeBalance(s: LiveState) {
  const snapshot = await computePortfolioSnapshot(s);
  return {
    krwCash: snapshot.krwCash,
    invested: snapshot.invested,
    currentValue: snapshot.coinValue,
    totalValue: snapshot.totalValue,
    unrealizedPnl: snapshot.pnl,
  };
}

async function computePortfolioSnapshot(
  s: LiveState,
  options: { accounts?: Awaited<ReturnType<typeof getAccounts>>; forceFresh?: boolean } = {},
): Promise<PortfolioSnapshot> {
  const safe = (v: number) => (Number.isFinite(v) ? v : 0);
  const { accounts, forceFresh = false } = options;
  const positions = Object.values(s.positions);
  const localInvested = safe(positions.reduce((sum, p) => sum + safe(parseFloat(p.quantity)) * safe(p.avgBuyPrice), 0));
  const localCoinValue = safe(positions.reduce((sum, p) => {
    return sum + safe(parseFloat(p.quantity)) * getLatestPrice(p.market, p.avgBuyPrice);
  }, 0));

  if (DRY_RUN) {
    const krwCash = Math.max(0, s.totalBudget - localInvested);
    return {
      krwCash,
      invested: localInvested,
      coinValue: localCoinValue,
      totalValue: krwCash + localCoinValue,
      pnl: localCoinValue - localInvested,
      at: new Date().toISOString(),
    };
  }

  // 일반 heartbeat는 30초 TTL 캐시를 사용하고 체결 직후에는 forceFresh로 우회한다.
  const useCache = !forceFresh && !accounts && cachedPortfolioSnapshot !== null && Date.now() - cachedKrwCashAt < 30_000;

  try {
    const freshAccounts = accounts ?? (useCache ? null : await getAccounts(ACCESS_KEY, SECRET_KEY));
    if (!freshAccounts) {
      // 캐시 유효 구간: 직전에 조회한 Upbit 전체 평가액을 그대로 사용한다.
      return {
        ...cachedPortfolioSnapshot!,
        at: new Date().toISOString(),
      };
    }
    const krwAccount = freshAccounts.find((a) => a.currency === "KRW");
    const krwCash = safe(krwAccount ? parseFloat(krwAccount.balance) + parseFloat(krwAccount.locked) : 0);
    cachedKrwCash = krwCash;
    cachedKrwCashAt = Date.now();

    const coinAccounts = freshAccounts.filter((account) => {
      return account.currency !== "KRW" && safe(parseFloat(account.balance) + parseFloat(account.locked)) > 0;
    });
    const krwMarketSet = await getKrwMarketSet();
    const markets = coinAccounts
      .map((account) => `KRW-${account.currency}`)
      .filter((market) => krwMarketSet.has(market));
    const tickerByMarket = new Map(
      (markets.length > 0 ? await fetchTickers(markets) : [])
        .map((ticker) => [ticker.market, ticker.tradePrice]),
    );

    let accountCoinValue = 0;
    let accountInvested = 0;
    for (const account of coinAccounts) {
      const market = `KRW-${account.currency}`;
      if (!krwMarketSet.has(market)) continue;
      const qty = safe(parseFloat(account.balance) + parseFloat(account.locked));
      if (qty <= 0) continue;
      const avgBuyPrice = safe(parseFloat(account.avg_buy_price));
      const currentPrice = safe(tickerByMarket.get(market) ?? getLatestPrice(market, avgBuyPrice));
      accountInvested += qty * avgBuyPrice;
      accountCoinValue += qty * currentPrice;
    }

    cachedPortfolioSnapshot = {
      krwCash,
      invested: accountInvested,
      coinValue: accountCoinValue,
      totalValue: krwCash + accountCoinValue,
      pnl: accountCoinValue - accountInvested,
      at: new Date().toISOString(),
    };
    return cachedPortfolioSnapshot;
  } catch {
    if (cachedPortfolioSnapshot !== null) {
      return {
        ...cachedPortfolioSnapshot,
        at: new Date().toISOString(),
      };
    }
    const krwCash = cachedKrwCash ?? Math.max(0, s.totalBudget - localInvested);
    return {
      krwCash,
      invested: localInvested,
      coinValue: localCoinValue,
      totalValue: krwCash + localCoinValue,
      pnl: localCoinValue - localInvested,
      at: new Date().toISOString(),
    };
  }
}

async function getKrwMarketSet() {
  krwMarketSetPromise ??= fetchKrwMarkets()
    .then((markets) => new Set(markets.map((market) => market.market)))
    .catch((error) => {
      krwMarketSetPromise = null;
      throw error;
    });
  return krwMarketSetPromise;
}

function getLatestPrice(market: string, fallback: number) {
  return liveCandle[market]?.close
    ?? closedCandles[market]?.[closedCandles[market].length - 1]?.close
    ?? fallback;
}

async function resetStartBalanceForRun() {
  if (state.startSnapshotScope === "upbit-total-assets" && state.startBalance !== undefined && state.startSnapshot) {
    console.log(`[live-trader] 시작 잔고 유지: ${Math.floor(state.startBalance).toLocaleString()}원`);
    return;
  }
  const snapshot = await computePortfolioSnapshot(state, { forceFresh: true });
  state.startedAt = snapshot.at;
  state.startBalance = snapshot.totalValue;
  state.startSnapshot = snapshot;
  state.startSnapshotScope = "upbit-total-assets";
  console.log(`[live-trader] 시작 잔고 재계산: ${Math.floor(state.startBalance).toLocaleString()}원 (현금 ${Math.floor(snapshot.krwCash).toLocaleString()}원 + 코인 ${Math.floor(snapshot.coinValue).toLocaleString()}원)`);
  await saveState(state);
}

async function writePublicStatus(s: LiveState) {
  if (!statusPublishingEnabled) return;
  const balance = await computeBalance(s);
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    writerPid: process.pid,
    writerRunId,
    sequence: ++statusSequence,
    stateUpdatedAt: now,
    updatedAt: now,
    mode: DRY_RUN ? "dry-run" : "live",
    totalBudget: s.totalBudget,
    budgetPerCoin: s.budgetPerCoin,
    orderAmount: ORDER_AMOUNT,
    positions: s.positions,
    trades: s.trades,
    lastSellAt: s.lastSellAt,
    balance,
    startBalance: s.startBalance,
    startSnapshot: s.startSnapshot,
    startSnapshotScope: s.startSnapshotScope,
    tradeHistorySnapshotScope: s.tradeHistorySnapshotScope,
    tradeHistoryResetAt: s.tradeHistoryResetAt,
  };
  try {
    await mkdir(path.dirname(publicStatusPath), { recursive: true });
    const tmp = `${publicStatusPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, publicStatusPath);
  } catch (e) {
    console.error("[live-trader] ⚠️ 상태 파일 쓰기 실패:", e);
  }
}

async function syncPositionsFromUpbit() {
  try {
    const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
    const syncedPositions: Record<string, LivePosition> = {};
    const marketsToSync = new Set([...selectedMarkets, ...Object.keys(state.positions)]);
    for (const market of marketsToSync) {
      const currency = market.replace("KRW-", "");
      const account = accounts.find((a) => a.currency === currency);
      if (account && parseFloat(account.balance) > 0) {
        const existing = state.positions[market];
        syncedPositions[market] = existing
          ? {
              ...existing,
              quantity: account.balance,
              avgBuyPrice: parseFloat(account.avg_buy_price),
            }
          : {
              market,
              quantity: account.balance,
              avgBuyPrice: parseFloat(account.avg_buy_price),
              entryAt: new Date().toISOString(),
              orderUuid: "synced-from-upbit",
            };
        if (!existing) {
          console.log(`[live-trader] 포지션 동기화: ${market} ${account.balance}개 @ ${account.avg_buy_price}원`);
        }
      }
    }
    state.positions = syncedPositions;
    await saveState(state);
  } catch (e) {
    console.error("[live-trader] 잔고 동기화 실패:", e);
    throw e;
  }
}

async function reconcilePendingBuys() {
  const pending = state.pendingBuys;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] 미완료 매수 주문 정산 (${Object.keys(pending).length}건)...`);
  for (const [uuid, pb] of Object.entries(pending)) {
    try {
      let order = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      if (order.state === "wait" || order.state === "watch") {
        try {
          await cancelOrder(ACCESS_KEY, SECRET_KEY, uuid);
          console.log(`[live-trader] 🗑️ 미체결 매수 취소: ${uuid} (${pb.market})`);
        } catch (cancelErr) {
          console.error(`[live-trader] 미체결 매수 취소 실패 (${uuid}):`, cancelErr);
          continue;
        }

        try {
          order = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
        } catch (reQueryErr) {
          console.error(`[live-trader] 취소 후 재조회 실패 (${uuid}):`, reQueryErr);
          continue;
        }
      }

      const executedVolume = parseFloat(order.executed_volume ?? "0");
      if (executedVolume > 0) {
        await recordBuyFill(pb, order);
      }

      if (order.state === "wait" || order.state === "watch") {
        console.log(`[live-trader] 매수 여전히 미체결: ${uuid} (${pb.market}, state=${order.state})`);
        continue;
      }

      if (executedVolume <= 0) {
        console.log(`[live-trader] 매수 체결 없음: ${uuid} (${pb.market}, state=${order.state})`);
      } else {
        console.log(`[live-trader] ✅ 펜딩 매수 정산 완료: ${pb.market} ${executedVolume}개`);
      }
      delete pending[uuid];
    } catch (e) {
      console.error(`[live-trader] 펜딩 주문 조회 실패 (${uuid}):`, e);
    }
  }
  await saveState(state);
}

async function reconcilePendingSells() {
  const pending = state.pendingSells;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] 미완료 매도 주문 정산 (${Object.keys(pending).length}건)...`);
  for (const [uuid, ps] of Object.entries(pending)) {
    try {
      const filled = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      const executedVolume = parseFloat(filled.executed_volume ?? "0");
      if (executedVolume > 0) {
        await recordSellFill(ps, filled);
      }

      if (filled.state === "done") {
        console.log(`[live-trader] ✅ 펜딩 매도 완료 정산: ${ps.market}`);
        delete pending[uuid];
      } else if (filled.state === "wait" || filled.state === "watch") {
        console.log(`[live-trader] 매도 여전히 미체결: ${uuid} (${ps.market}, state=${filled.state})`);
      } else {
        console.warn(`[live-trader] ⚠️ 매도 취소됨: ${uuid} (${ps.market}, 체결 ${executedVolume}개)`);
        delete pending[uuid];
      }
    } catch (e) {
      console.error(`[live-trader] 펜딩 매도 조회 실패 (${uuid}):`, e);
    }
  }
  await saveState(state);
}

async function recordBuyFill(pb: PendingBuy, order: Awaited<ReturnType<typeof getOrder>>) {
  const executedVolume = parseFloat(order.executed_volume ?? "0");
  const alreadyRecorded = parseFloat(pb.recordedVolume ?? "0");
  const deltaVolume = executedVolume - alreadyRecorded;
  if (deltaVolume <= 0) return;

  const actualPrice = order.avg_price ? parseFloat(order.avg_price) : pb.price;
  const executedFunds = order.executed_funds ? parseFloat(order.executed_funds) : executedVolume * actualPrice;
  const previousFunds = alreadyRecorded * actualPrice;
  const deltaFunds = Math.max(0, executedFunds - previousFunds);

  const existingPosition = state.positions[pb.market];
  if (existingPosition && existingPosition.orderUuid !== pb.uuid) {
    // Startup sync may already have absorbed this exchange exposure.
    console.warn(`[live-trader] 펜딩 매수 ${pb.market} 체결량은 기존 포지션에 이미 반영된 것으로 간주합니다.`);
    pb.recordedVolume = String(executedVolume);
    return;
  }

  if (existingPosition) {
    const currentQty = parseFloat(existingPosition.quantity);
    const nextQty = currentQty + deltaVolume;
    existingPosition.avgBuyPrice = nextQty > 0
      ? ((currentQty * existingPosition.avgBuyPrice) + deltaFunds) / nextQty
      : actualPrice;
    existingPosition.quantity = String(nextQty);
  } else {
    state.positions[pb.market] = {
      market: pb.market,
      quantity: String(deltaVolume),
      avgBuyPrice: actualPrice,
      entryAt: pb.at,
      orderUuid: pb.uuid,
    };
  }

  state.trades.push({
    at: pb.at,
    market: pb.market,
    side: "buy",
    amount: deltaFunds || pb.amount,
    price: pb.price,
    actualPrice,
    netKrw: deltaFunds || pb.amount,
    portfolioAfter: await computePortfolioSnapshot(state, { forceFresh: true }),
    portfolioSnapshotScope: "upbit-total-assets",
    dryRun: false,
    reasonCodes: pb.reasonCodes,
  });
  pb.recordedVolume = String(executedVolume);
}

async function recordSellFill(ps: PendingSell, order: Awaited<ReturnType<typeof getOrder>>) {
  const executedVolume = parseFloat(order.executed_volume ?? "0");
  const alreadyRecorded = parseFloat(ps.recordedVolume ?? "0");
  const deltaVolume = executedVolume - alreadyRecorded;
  if (deltaVolume <= 0) return;

  const actualPrice = order.avg_price ? parseFloat(order.avg_price) : undefined;
  const executedFunds = order.executed_funds ? parseFloat(order.executed_funds) : undefined;
  const paidFee = order.paid_fee ? parseFloat(order.paid_fee) : 0;
  const previousRatio = alreadyRecorded / Math.max(parseFloat(ps.quantity), 1e-12);
  const currentRatio = executedVolume / Math.max(parseFloat(ps.quantity), 1e-12);
  const netKrw = executedFunds !== undefined
    ? Math.max(0, executedFunds * (currentRatio - previousRatio) / Math.max(currentRatio, 1e-12) - paidFee * (currentRatio - previousRatio) / Math.max(currentRatio, 1e-12))
    : undefined;
  const costBasis = ps.costBasis * (deltaVolume / Math.max(parseFloat(ps.quantity), 1e-12));
  const pnlKrw = netKrw !== undefined ? netKrw - costBasis : undefined;
  const candleTs = closedCandles[ps.market]?.[closedCandles[ps.market].length - 1]?.timestamp;
  if (candleTs) state.lastSellAt[ps.market] = candleTs;

  const position = state.positions[ps.market];
  if (position) {
    const remaining = Math.max(0, parseFloat(position.quantity) - deltaVolume);
    if (remaining <= 1e-10) delete state.positions[ps.market];
    else position.quantity = String(remaining);
  }

  state.trades.push({
    at: ps.at,
    market: ps.market,
    side: "sell",
    amount: deltaVolume,
    price: ps.price,
    actualPrice,
    netKrw,
    pnlKrw,
    portfolioAfter: await computePortfolioSnapshot(state, { forceFresh: true }),
    portfolioSnapshotScope: "upbit-total-assets",
    dryRun: false,
    reasonCodes: ps.reasonCodes,
  });
  ps.recordedVolume = String(executedVolume);
}

function hasPendingOrders() {
  return Boolean(
    (state.pendingBuys && Object.keys(state.pendingBuys).length > 0) ||
    (state.pendingSells && Object.keys(state.pendingSells).length > 0),
  );
}

function queuePendingReconcile(reason: string) {
  if (DRY_RUN || !state || !hasPendingOrders()) return;
  reconcileChain = reconcileChain.catch(() => {}).then(async () => {
    console.log(`[live-trader] pending 주문 재정산 (${reason})`);
    await reconcilePendingBuys();
    await reconcilePendingSells();
  });
}

// ── WebSocket 연결 ───────────────────────────────────────────────────────────

function connect() {
  // 이미 연결 중이거나 연결된 소켓이 있으면 중복 연결 방지
  if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log("[live-trader] WebSocket 연결 중...");
  const ws = new WebSocket(wsUrl);
  activeWs = ws;

  ws.on("open", () => {
    ws.send(JSON.stringify([{ ticket: "live-trader" }, { type: "trade", codes: selectedMarkets }]));
    console.log("[live-trader] WebSocket 연결됨");
  });

  ws.on("message", (data: Buffer) => {
    try {
      const tick = JSON.parse(data.toString("utf8")) as UpbitTick;
      if (tick.type === "trade") handleTick(tick);
    } catch { /* ignore */ }
  });

  ws.on("close", () => {
    console.log("[live-trader] WebSocket 끊김. 5초 후 재연결...");
    if (activeWs === ws) activeWs = null;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5_000);
  });

  ws.on("error", (e: Error) => {
    console.error("[live-trader] WebSocket 오류:", e.message);
    ws.terminate();
  });
}

// ── 틱 처리 ─────────────────────────────────────────────────────────────────

function handleTick(tick: UpbitTick) {
  const market = tick.code;
  const tickTs = tick.trade_timestamp;
  const minuteTs = Math.floor(tickTs / 60_000) * 60_000;
  const prev = lastMinute[market];

  if (prev !== undefined && minuteTs > prev) {
    // 분봉 마감
    const closed = closeLiveCandle(market);
    if (closed) {
      upsertCandle(closedCandles[market], closed);
      // 1.5초 후 처리 (ws-live와 동일)
      setTimeout(() => processMinuteClose(market, closed), 1_500);
    }
    liveCandle[market] = newLiveCandle(market, tick, minuteTs);
  } else if (!liveCandle[market]) {
    liveCandle[market] = newLiveCandle(market, tick, minuteTs);
  } else {
    updateLiveCandle(liveCandle[market], tick);
  }

  lastMinute[market] = minuteTs;

  // 틱 레벨 하드 손절 체크 (분봉 마감 전에도 즉시 대응)
  checkTickStopLoss(market, tick.trade_price);
}

function closeLiveCandle(market: string): Candle | null {
  const c = liveCandle[market];
  if (!c) return null;
  return { market: c.market, timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, quoteVolume: c.quoteVolume };
}

function newLiveCandle(market: string, tick: UpbitTick, minuteTs: number): LiveCandle {
  return { market, timestamp: minuteTs, open: tick.trade_price, high: tick.trade_price, low: tick.trade_price, close: tick.trade_price, volume: tick.trade_volume, quoteVolume: tick.trade_price * tick.trade_volume };
}

function updateLiveCandle(c: LiveCandle, tick: UpbitTick) {
  c.close = tick.trade_price;
  if (tick.trade_price > c.high) c.high = tick.trade_price;
  if (tick.trade_price < c.low) c.low = tick.trade_price;
  c.volume += tick.trade_volume;
  c.quoteVolume += tick.trade_price * tick.trade_volume;
}

function upsertCandle(arr: Candle[], candle: Candle) {
  const last = arr[arr.length - 1];
  if (last?.timestamp === candle.timestamp) { arr[arr.length - 1] = candle; }
  else {
    arr.push(candle);
    if (arr.length > maxCandles) arr.shift();
  }
}

function derivePnlKrw(sell: LiveTradeLog): number {
  // pnlKrw가 없는 구형 매도 기록 — 직전 같은 마켓 매수에서 원가 추정
  if (sell.pnlKrw !== undefined) return sell.pnlKrw;
  if (!sell.netKrw) return 0;
  const buyEntry = [...state.trades].reverse().find(
    (t) => t.market === sell.market && t.side === "buy" && t.at <= sell.at,
  );
  const costBasis = buyEntry ? (buyEntry.netKrw ?? buyEntry.amount) : 0;
  return sell.netKrw - costBasis;
}

function getDailyRealizedLoss(): number {
  const today = new Date().toISOString().slice(0, 10);
  return state.trades
    .filter((t) => t.at.startsWith(today) && t.side === "sell" && !t.dryRun)
    .reduce((sum, t) => {
      const pnl = derivePnlKrw(t);
      return sum + (pnl < 0 ? Math.abs(pnl) : 0);
    }, 0);
}

function checkTickStopLoss(market: string, tickPrice: number) {
  if (!state) return;
  const position = state.positions[market];
  if (!position || orderInProgress.has(market)) return;
  const scenario = getScenarioForMarket(market);
  const stopLossPct = scenario.params.stopLossPct as number | undefined;
  if (!stopLossPct || stopLossPct <= 0) return;
  const lossRatio = (position.avgBuyPrice - tickPrice) / position.avgBuyPrice;
  if (lossRatio >= stopLossPct) {
    executeSell(market, position, tickPrice, ["stop-loss-tick"]).catch(console.error);
  }
}

// ── 전략 실행 ────────────────────────────────────────────────────────────────

async function processMinuteClose(market: string, _closedCandle: Candle) {
  const candles = closedCandles[market];
  if (!candles || candles.length < 60) return; // 워밍업

  const scenario = getScenarioForMarket(market);
  if (!scenario) return;

  const position = state.positions[market];
  const candleIndex = candles.length - 1;
  const lastSellCandleIndex = state.lastSellAt[market] !== undefined
    ? candles.findIndex((c) => c.timestamp === state.lastSellAt[market])
    : undefined;

  const context: StrategyContext = {
    candles,
    candleIndex,
    position: position
      ? {
          market,
          averagePrice: position.avgBuyPrice,
          quantity: parseFloat(position.quantity),
          holdCandles: Math.floor((Date.now() - new Date(position.entryAt).getTime()) / 60_000),
          highestPrice: position.avgBuyPrice, // simplified
        }
      : null,
    lastSellPrice: undefined,
    lastSellCandleIndex: lastSellCandleIndex !== undefined && lastSellCandleIndex >= 0 ? lastSellCandleIndex : undefined,
  };

  // 하드 손절: 종가 + 저가(분봉 내 최저) 모두 체크 — tick-level 체크와 보완 관계
  if (position) {
    const stopLossPct = scenario.params.stopLossPct as number | undefined;
    if (stopLossPct && stopLossPct > 0) {
      const currentPrice = candles[candleIndex].close;
      const candleLow = candles[candleIndex].low;
      const checkPrice = Math.min(currentPrice, candleLow);
      const lossRatio = (position.avgBuyPrice - checkPrice) / position.avgBuyPrice;
      if (lossRatio >= stopLossPct) {
        console.warn(`[live-trader] 🛑 하드 손절 — ${market} 손실 ${(lossRatio * 100).toFixed(2)}% ≥ ${(stopLossPct * 100).toFixed(2)}%`);
        await executeSell(market, state.positions[market], currentPrice, ["stop-loss"]);
        return;
      }
    }
  }

  const decision = averageDropCycleStrategy.decide(context, scenario);

  if (decision.action === "buy" && !position) {
    await executeBuy(market, candles[candleIndex].close, decision.reasonCodes);
  } else if (decision.action === "sell" && position) {
    await executeSell(market, position, candles[candleIndex].close, decision.reasonCodes);
  }
}

function getScenarioForMarket(market: string) {
  return marketScenario.get(market) ?? averageDropCycleStrategy.defaultScenario;
}

// ── 주문 실행 ────────────────────────────────────────────────────────────────

async function executeBuy(market: string, price: number, reasonCodes: string[]) {
  if (orderInProgress.has(market)) return; // 이미 주문 진행 중
  if (state.pendingBuys && Object.values(state.pendingBuys).some((pb) => pb.market === market)) {
    console.warn(`[live-trader] ⚠️ 매수 스킵 — 미완료 매수 주문이 있음: ${market}`);
    return;
  }
  orderInProgress.add(market);

  try {
    const coin = market.replace("KRW-", "");
    const log = `[BUY] ${coin} ${ORDER_AMOUNT.toLocaleString()}원 @ ~${price.toLocaleString()}원 | ${reasonCodes.join(",")}`;

    if (ORDER_AMOUNT < MIN_ORDER_KRW) {
      console.log(`[live-trader] 스킵 — 주문금액 부족 (${ORDER_AMOUNT}원 < ${MIN_ORDER_KRW}원)`);
      return;
    }

    if (DRY_RUN) {
      console.log(`[dry-run] ${log}`);
      await recordDryTrade(market, "buy", ORDER_AMOUNT, price, reasonCodes);
      return;
    }

    if (await isEntryBlocked()) {
      console.warn(`[live-trader] 🛑 비상 정지 파일 감지 — 매수 차단: ${market}`);
      return;
    }

    // 최대 포지션 수 / 예산 초과 체크
    const openCount = Object.keys(state.positions).length;
    const pendingBuyCount = state.pendingBuys ? Object.keys(state.pendingBuys).length : 0;
    if (openCount + pendingBuyCount >= MAX_COINS) {
      console.log(`[live-trader] 스킵 — 최대 포지션 수 도달 (${openCount}+pending ${pendingBuyCount}/${MAX_COINS})`);
      return;
    }
    const totalInvested = Object.values(state.positions).reduce(
      (sum, p) => sum + parseFloat(p.quantity) * p.avgBuyPrice, 0,
    );
    const pendingBuyAmount = Object.values(state.pendingBuys ?? {}).reduce((sum, p) => sum + p.amount, 0);
    if (totalInvested + pendingBuyAmount + ORDER_AMOUNT > TOTAL_BUDGET) {
      console.log(`[live-trader] 스킵 — 예산 초과 (투자 ${Math.floor(totalInvested).toLocaleString()}원 + pending ${pendingBuyAmount.toLocaleString()}원 + ${ORDER_AMOUNT.toLocaleString()}원 > 예산 ${TOTAL_BUDGET.toLocaleString()}원)`);
      return;
    }

    const krwAvailable = await getKrwBalance(ACCESS_KEY, SECRET_KEY).catch(() => 0);
    if (krwAvailable < ORDER_AMOUNT) {
      console.log(`[live-trader] 스킵 — KRW 잔고 부족 (${Math.floor(krwAvailable).toLocaleString()}원 < ${ORDER_AMOUNT.toLocaleString()}원)`);
      return;
    }

    const dailyLoss = getDailyRealizedLoss();
    if (dailyLoss >= MAX_DAILY_LOSS_KRW) {
      console.warn(`[live-trader] 스킵 — 일일 손실 한도 도달 (${Math.floor(dailyLoss).toLocaleString()}원 ≥ ${MAX_DAILY_LOSS_KRW.toLocaleString()}원)`);
      return;
    }

    const order = await placeMarketBuy(ACCESS_KEY, SECRET_KEY, market, ORDER_AMOUNT);
    console.log(`[live-trader] ✅ ${log} → uuid=${order.uuid}`);

    // 체결 완료 확인 (최대 2회 폴링) — state === "done" 필수
    await sleep(2_000);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep(2_000);
      filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    }

    if (filled.state !== "done") {
      console.warn(`[live-trader] ⚠️ 매수 체결 미완료 (uuid=${order.uuid}, state=${filled.state}, vol=${filled.executed_volume}) — 펜딩으로 기록`);
      state.pendingBuys = state.pendingBuys ?? {};
      state.pendingBuys[order.uuid] = { uuid: order.uuid, market, amount: ORDER_AMOUNT, price, reasonCodes, at: new Date().toISOString() };
      await saveState(state);
      setTimeout(() => queuePendingReconcile("new-pending-buy"), 10_000);
      return;
    }

    const executedVolume = parseFloat(filled.executed_volume ?? "0");
    if (executedVolume <= 0) {
      console.warn(`[live-trader] ⚠️ 매수 체결량 0 (uuid=${order.uuid}) — 상태 미반영`);
      return;
    }

    const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : undefined;
    const avgBuyPrice = actualPrice ?? price;
    const netKrw = ORDER_AMOUNT; // 매수는 KRW 지출액 = ORDER_AMOUNT (수수료는 코인에서 차감)

    state.positions[market] = {
      market,
      quantity: String(executedVolume),
      avgBuyPrice,
      entryAt: new Date().toISOString(),
      orderUuid: order.uuid,
    };
    state.trades.push({
      at: new Date().toISOString(),
      market,
      side: "buy",
      amount: ORDER_AMOUNT,
      price,
      actualPrice,
      netKrw,
      portfolioAfter: await computePortfolioSnapshot(state, { forceFresh: true }),
      portfolioSnapshotScope: "upbit-total-assets",
      dryRun: false,
      reasonCodes,
    });
    await saveState(state);
  } catch (e) {
    console.error(`[live-trader] ❌ 매수 실패 ${market}:`, e);
  } finally {
    orderInProgress.delete(market);
  }
}

async function executeSell(market: string, position: LivePosition, price: number, reasonCodes: string[]) {
  if (orderInProgress.has(market)) return; // 이미 주문 진행 중
  // 미완료 매도 주문이 있으면 중복 매도 차단
  if (state.pendingSells && Object.values(state.pendingSells).some((ps) => ps.market === market)) {
    console.warn(`[live-trader] ⚠️ 매도 스킵 — 미완료 매도 주문이 있음: ${market}`);
    return;
  }
  orderInProgress.add(market);

  try {
    const coin = market.replace("KRW-", "");
    const log = `[SELL] ${coin} ${position.quantity}개 @ ~${price.toLocaleString()}원 | ${reasonCodes.join(",")}`;

    if (DRY_RUN) {
      console.log(`[dry-run] ${log}`);
      const qty = parseFloat(position.quantity);
      await recordDryTrade(market, "sell", qty, price, reasonCodes);
      return;
    }

    if (await isAllTradesBlocked()) {
      console.warn(`[live-trader] 🛑 freeze-all 파일 감지 — 매도 차단: ${market}`);
      return;
    }

    const order = await placeMarketSell(ACCESS_KEY, SECRET_KEY, market, position.quantity);
    console.log(`[live-trader] ✅ ${log} → uuid=${order.uuid}`);

    // 체결 완료 확인 (최대 2회 폴링)
    await sleep(2_000);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep(2_000);
      filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    }

    if (filled.state !== "done") {
      console.warn(`[live-trader] ⚠️ 매도 체결 미확인 (uuid=${order.uuid}, state=${filled.state}) — 펜딩으로 기록`);
      state.pendingSells = state.pendingSells ?? {};
      state.pendingSells[order.uuid] = {
        uuid: order.uuid,
        market,
        quantity: position.quantity,
        price,
        reasonCodes,
        at: new Date().toISOString(),
        costBasis: parseFloat(position.quantity) * position.avgBuyPrice,
      };
      await saveState(state);
      setTimeout(() => queuePendingReconcile("new-pending-sell"), 10_000);
      return;
    }

    const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : undefined;
    const netKrw = filled.executed_funds && filled.paid_fee
      ? parseFloat(filled.executed_funds) - parseFloat(filled.paid_fee)
      : undefined;
    const costBasis = parseFloat(position.quantity) * position.avgBuyPrice;
    const pnlKrw = netKrw !== undefined ? netKrw - costBasis : undefined;

    if (actualPrice) {
      const pnlStr = pnlKrw !== undefined ? ` | 손익: ${pnlKrw >= 0 ? "+" : ""}${Math.floor(pnlKrw).toLocaleString()}원` : "";
      console.log(`[live-trader]   체결가: ${actualPrice.toLocaleString()}원 | 순수령: ${Math.floor(netKrw ?? 0).toLocaleString()}원${pnlStr}`);
    }

    const candleTs = closedCandles[market]?.[closedCandles[market].length - 1]?.timestamp;
    if (candleTs) state.lastSellAt[market] = candleTs;

    delete state.positions[market];
    state.trades.push({
      at: new Date().toISOString(),
      market,
      side: "sell",
      amount: parseFloat(position.quantity),
      price,
      actualPrice,
      netKrw,
      pnlKrw,
      portfolioAfter: await computePortfolioSnapshot(state, { forceFresh: true }),
      portfolioSnapshotScope: "upbit-total-assets",
      dryRun: false,
      reasonCodes,
    });
    await saveState(state);
  } catch (e) {
    console.error(`[live-trader] ❌ 매도 실패 ${market}:`, e);
  } finally {
    orderInProgress.delete(market);
  }
}

async function recordDryTrade(market: string, side: "buy" | "sell", amount: number, price: number, reasonCodes: string[]) {
  if (side === "buy") {
    state.positions[market] = {
      market,
      quantity: String((amount / price).toFixed(8)),
      avgBuyPrice: price,
      entryAt: new Date().toISOString(),
      orderUuid: "dry-run",
    };
  } else {
    const candleTs = closedCandles[market]?.[closedCandles[market].length - 1]?.timestamp;
    if (candleTs) state.lastSellAt[market] = candleTs;
    delete state.positions[market];
  }
  state.trades.push({
    at: new Date().toISOString(),
    market,
    side,
    amount,
    price,
    portfolioAfter: await computePortfolioSnapshot(state),
    dryRun: true,
    reasonCodes,
  });
  await saveState(state);
}

// ── 상태 출력 + 하트비트 ──────────────────────────────────────────────────────

// 미완료 주문은 프로세스 재시작 없이도 계속 exchange 상태와 맞춘다.
setInterval(() => {
  queuePendingReconcile("interval");
}, 15_000);

// 30초마다 공개 상태 파일 갱신 — 거래가 없어도 UI에 최신 updatedAt 유지
setInterval(() => {
  if (!state) return;
  writePublicStatus(state).catch((e) => console.error("[live-trader] 하트비트 상태 쓰기 실패:", e));
}, 30_000);

setInterval(() => {
  if (!state) return;
  const pos = Object.values(state.positions).map((p) => p.market.replace("KRW-", "")).join(", ") || "없음";
  const trades = state.trades.length;
  console.log(`[live-trader] 포지션: ${pos} | 누적 거래: ${trades}회 | ${DRY_RUN ? "DRY-RUN" : "실매매"}`);
}, 60_000);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── 시작 ─────────────────────────────────────────────────────────────────────

async function shutdown(code: number) {
  if (activeWs) {
    try { activeWs.close(); } catch {}
  }
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  await releaseProcessLock();
  process.exit(code);
}

process.once("SIGINT", () => { void shutdown(130); });
process.once("SIGTERM", () => { void shutdown(143); });

init().catch(async (e) => {
  console.error("[live-trader] 초기화 실패:", e);
  await releaseProcessLock();
  process.exit(1);
});
