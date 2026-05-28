/**
 * live-trader.ts — 업비트 실매매 실행기
 *
 * 사용법:
 *   1. .env 파일에 UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY 설정
 *   2. node scripts/live-trader.mjs --dry-run   (주문 없이 신호만 로그)
 *   3. node scripts/live-trader.mjs             (실제 주문 실행)
 *
 * 자금 배분:
 *   TOTAL_BUDGET (기본 1,000,000원) ÷ 9코인 = 코인당 111,111원
 *   C 전략 targetWeight 0.45 → 매수금액 ≈ 50,000원/회
 */
import "dotenv/config";
import WebSocket from "ws";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cancelOrder, getAccounts, getKrwBalance, getOrder, placeMarketBuy, placeMarketSell } from "./upbitOrder";
import { arbitrageStrategy } from "../src/strategies/arbitrage";
import type { Candle, StrategyContext } from "../src/types/trading";

// ── 설정 ────────────────────────────────────────────────────────────────────

const ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? "";
const LIVE_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
const DRY_RUN = process.argv.includes("--dry-run") || !ACCESS_KEY || !SECRET_KEY || !LIVE_ENABLED;

const TOTAL_BUDGET = Number(process.env.LIVE_BUDGET ?? 1_000_000);   // 총 운용금액 (KRW)
const MAX_COINS = 9;
const BUDGET_PER_COIN = Math.floor(TOTAL_BUDGET / MAX_COINS);         // 코인당 할당 예산
const TARGET_WEIGHT = 0.45;                                            // arbitrage targetWeight
const ORDER_AMOUNT = Math.floor(BUDGET_PER_COIN * TARGET_WEIGHT);     // 1회 매수금액
const MIN_ORDER_KRW = 5_500;                                           // 업비트 최소 주문 + 여유
const MAX_DAILY_LOSS_KRW = Number(process.env.MAX_DAILY_LOSS_KRW ?? Math.floor(TOTAL_BUDGET * 0.10)); // 기본 10%

const root = process.cwd();
const statePath = path.join(root, "data", "local", "live-trader-state.json");
const publicStatusPath = path.join(root, "public", "market", "live-trade-status.json");
const planDir = path.join(root, "data", "local", "traders", "arbitrage");
const maxCandles = 1440;

const wsUrl = "wss://api.upbit.com/websocket/v1";

// ── 상태 ────────────────────────────────────────────────────────────────────

interface LivePosition {
  market: string;
  quantity: string;       // 코인 수량 (string으로 유지 — 업비트 API와 동일)
  avgBuyPrice: number;    // 평균 매입가 (KRW)
  entryAt: string;        // ISO timestamp
  orderUuid: string;
}

interface LiveState {
  startedAt: string;
  totalBudget: number;
  budgetPerCoin: number;
  positions: Record<string, LivePosition>;   // market → position
  trades: LiveTradeLog[];
  lastSellAt: Record<string, number>;        // market → candle timestamp
  startBalance?: number;                     // 최초 시작 시 총 평가액 (한 번만 기록)
  pendingBuys?: Record<string, PendingBuy>;   // uuid → 미완료 매수 주문
  pendingSells?: Record<string, PendingSell>; // uuid → 미완료 매도 주문
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
}

interface PendingSell {
  uuid: string;
  market: string;
  quantity: string;    // 매도 코인 수량
  price: number;       // 추정 체결가
  reasonCodes: string[];
  at: string;          // ISO timestamp
  costBasis: number;   // avgBuyPrice × quantity (손익 계산용)
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
const orderInProgress = new Set<string>(); // 매수/매도 진행 중인 마켓

// 비상 정지 파일 경로
// live-trading-disabled.flag  → 신규 매수 차단 (매도/손절은 허용)
// live-trading-freeze-all.flag → 매수·매도 모두 차단
const emergencyStopPath = path.join(root, "data", "local", "live-trading-disabled.flag");
const freezeAllPath = path.join(root, "data", "local", "live-trading-freeze-all.flag");

// KRW 잔고 캐시 — getAccounts 호출을 60초에 1회로 제한, saveChain 블로킹 방지
let cachedKrwCash: number | null = null;
let cachedKrwCashAt = 0;

// 공개 상태 파일 단조 증가 시퀀스 — UI의 역순/오래된 응답 거부에 사용
let statusSequence = 0;

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

// ── 초기화 ───────────────────────────────────────────────────────────────────

async function init() {
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
  selectedMarkets = plan.selectedMarkets.map((m) => m.market);
  for (const item of plan.selectedMarkets) {
    const scenario = arbitrageStrategy.scenarios.find((s) => s.id === item.bestResult.scenarioId)
      ?? arbitrageStrategy.defaultScenario;
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
    await syncPositionsFromUpbit();
    await reconcilePendingBuys();
    await reconcilePendingSells();
  }

  console.log(`[live-trader] 코인당 예산: ${BUDGET_PER_COIN.toLocaleString()}원 | 1회 매수: ${ORDER_AMOUNT.toLocaleString()}원`);
  console.log(`[live-trader] 현재 포지션: ${Object.keys(state.positions).length}개`);

  await writePublicStatus(state);
  connect();
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
    return JSON.parse(await readFile(statePath, "utf8")) as LiveState;
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
    const tmp = statePath + ".tmp";
    await writeFile(tmp, snapshot, "utf8");
    await rename(tmp, statePath);
    await writePublicStatus(s);
  }));
}

async function computeBalance(s: LiveState) {
  const safe = (v: number) => (isFinite(v) ? v : 0);
  const positions = Object.values(s.positions);
  const invested = safe(positions.reduce((sum, p) => sum + safe(parseFloat(p.quantity)) * safe(p.avgBuyPrice), 0));
  const currentValue = safe(positions.reduce((sum, p) => {
    const candles = closedCandles[p.market];
    const latestPrice = safe(candles?.[candles.length - 1]?.close ?? p.avgBuyPrice);
    return sum + safe(parseFloat(p.quantity)) * latestPrice;
  }, 0));

  if (DRY_RUN) {
    const krwCash = Math.max(0, s.totalBudget - invested);
    return { krwCash, invested, currentValue, totalValue: krwCash + currentValue, unrealizedPnl: currentValue - invested };
  }

  // getAccounts 호출을 60초에 1회로 제한 — 호출이 느릴 경우 saveChain 장기 블로킹 방지
  const now = Date.now();
  if (cachedKrwCash === null || now - cachedKrwCashAt > 60_000) {
    try {
      const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
      const krwAccount = accounts.find((a) => a.currency === "KRW");
      cachedKrwCash = safe(krwAccount ? parseFloat(krwAccount.balance) + parseFloat(krwAccount.locked) : 0);
      cachedKrwCashAt = Date.now();
    } catch {
      if (cachedKrwCash === null) cachedKrwCash = Math.max(0, s.totalBudget - invested);
    }
  }

  const krwCash = cachedKrwCash;
  return { krwCash, invested, currentValue, totalValue: krwCash + currentValue, unrealizedPnl: currentValue - invested };
}

async function writePublicStatus(s: LiveState) {
  const balance = await computeBalance(s);
  const now = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    writerPid: process.pid,
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
  };
  try {
    await mkdir(path.dirname(publicStatusPath), { recursive: true });
    const tmp = publicStatusPath + ".tmp";
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, publicStatusPath);
  } catch (e) {
    console.error("[live-trader] ⚠️ 상태 파일 쓰기 실패:", e);
  }
}

async function syncPositionsFromUpbit() {
  try {
    const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
    for (const market of selectedMarkets) {
      const currency = market.replace("KRW-", "");
      const account = accounts.find((a) => a.currency === currency);
      if (account && parseFloat(account.balance) > 0) {
        // 이미 상태에 없으면 현재 보유량으로 초기화
        if (!state.positions[market]) {
          state.positions[market] = {
            market,
            quantity: account.balance,
            avgBuyPrice: parseFloat(account.avg_buy_price),
            entryAt: new Date().toISOString(),
            orderUuid: "synced-from-upbit",
          };
          console.log(`[live-trader] 포지션 동기화: ${market} ${account.balance}개 @ ${account.avg_buy_price}원`);
        }
      }
    }
    // 최초 기동 시에만 시작 잔고 기록 (재기동 시 덮어쓰지 않음)
    if (state.startBalance === undefined) {
      const krwAccount = accounts.find((a) => a.currency === "KRW");
      const krwCash = krwAccount ? parseFloat(krwAccount.balance) + parseFloat(krwAccount.locked) : 0;
      const posVal = Object.values(state.positions).reduce((sum, p) => {
        const candles = closedCandles[p.market];
        const price = candles?.[candles.length - 1]?.close ?? p.avgBuyPrice;
        return sum + parseFloat(p.quantity) * price;
      }, 0);
      state.startBalance = krwCash + posVal;
      console.log(`[live-trader] 시작 잔고 기록 (최초): ${Math.floor(state.startBalance).toLocaleString()}원 (현금 ${Math.floor(krwCash).toLocaleString()}원 + 코인 ${Math.floor(posVal).toLocaleString()}원)`);
    } else {
      console.log(`[live-trader] 시작 잔고 유지: ${Math.floor(state.startBalance).toLocaleString()}원`);
    }
    await saveState(state);
  } catch (e) {
    console.error("[live-trader] 잔고 동기화 실패:", e);
  }
}

async function reconcilePendingBuys() {
  const pending = state.pendingBuys;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] 미완료 매수 주문 정산 (${Object.keys(pending).length}건)...`);
  for (const [uuid, pb] of Object.entries(pending)) {
    try {
      const filled = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      if (filled.state === "done") {
        const executedVolume = parseFloat(filled.executed_volume ?? "0");
        if (executedVolume > 0 && !state.positions[pb.market]) {
          const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : pb.price;
          state.positions[pb.market] = { market: pb.market, quantity: String(executedVolume), avgBuyPrice: actualPrice, entryAt: pb.at, orderUuid: uuid };
          state.trades.push({ at: pb.at, market: pb.market, side: "buy", amount: pb.amount, price: pb.price, actualPrice, netKrw: pb.amount, dryRun: false, reasonCodes: pb.reasonCodes });
          console.log(`[live-trader] ✅ 펜딩 매수 완료 정산: ${pb.market} ${executedVolume}개 @ ${actualPrice.toLocaleString()}원`);
        }
      } else if (filled.state === "wait" || filled.state === "watch") {
        let cancelOk = false;
        try {
          await cancelOrder(ACCESS_KEY, SECRET_KEY, uuid);
          cancelOk = true;
          console.log(`[live-trader] 🗑️ 미체결 매수 취소: ${uuid} (${pb.market})`);
        } catch (cancelErr) {
          console.error(`[live-trader] 미체결 매수 취소 실패 (${uuid}):`, cancelErr);
        }
        if (cancelOk) {
          // 취소 후 재조회 — 부분 체결 수량 확인 후 포지션 반영
          try {
            const afterCancel = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
            const partialVol = parseFloat(afterCancel.executed_volume ?? "0");
            if (partialVol > 0 && !state.positions[pb.market]) {
              const actualPrice = afterCancel.avg_price ? parseFloat(afterCancel.avg_price) : pb.price;
              const netKrw = afterCancel.executed_funds ? parseFloat(afterCancel.executed_funds) : partialVol * actualPrice;
              state.positions[pb.market] = { market: pb.market, quantity: String(partialVol), avgBuyPrice: actualPrice, entryAt: pb.at, orderUuid: uuid };
              state.trades.push({ at: pb.at, market: pb.market, side: "buy", amount: pb.amount, price: pb.price, actualPrice, netKrw, dryRun: false, reasonCodes: pb.reasonCodes });
              console.log(`[live-trader] ⚠️ 부분 체결 포지션 기록: ${pb.market} ${partialVol}개 @ ${actualPrice.toLocaleString()}원`);
            }
          } catch (reQueryErr) {
            console.error(`[live-trader] 취소 후 재조회 실패 (${uuid}):`, reQueryErr);
            // 재조회 실패 시 펜딩 유지 (다음 기동 시 재시도)
            continue;
          }
        }
      } else {
        console.log(`[live-trader] 매수 이미 취소됨: ${uuid} (${pb.market})`);
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
      if (filled.state === "done") {
        const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : undefined;
        const netKrw = filled.executed_funds && filled.paid_fee
          ? parseFloat(filled.executed_funds) - parseFloat(filled.paid_fee)
          : undefined;
        const pnlKrw = netKrw !== undefined ? netKrw - ps.costBasis : undefined;
        const candleTs = closedCandles[ps.market]?.[closedCandles[ps.market].length - 1]?.timestamp;
        if (candleTs) state.lastSellAt[ps.market] = candleTs;
        delete state.positions[ps.market];
        state.trades.push({ at: ps.at, market: ps.market, side: "sell", amount: parseFloat(ps.quantity), price: ps.price, actualPrice, netKrw, pnlKrw, dryRun: false, reasonCodes: ps.reasonCodes });
        console.log(`[live-trader] ✅ 펜딩 매도 완료 정산: ${ps.market} @ ${actualPrice?.toLocaleString() ?? "?"}원`);
        delete pending[uuid];
      } else if (filled.state === "wait" || filled.state === "watch") {
        console.log(`[live-trader] 매도 여전히 미체결: ${uuid} (${ps.market}, state=${filled.state})`);
      } else {
        // cancel — 포지션을 복원하지 않음 (이미 exchange에서 처리된 것으로 간주)
        console.warn(`[live-trader] ⚠️ 매도 취소됨: ${uuid} (${ps.market}) — 수동 확인 필요`);
        delete pending[uuid];
      }
    } catch (e) {
      console.error(`[live-trader] 펜딩 매도 조회 실패 (${uuid}):`, e);
    }
  }
  await saveState(state);
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

  const decision = arbitrageStrategy.decide(context, scenario);

  if (decision.action === "buy" && !position) {
    await executeBuy(market, candles[candleIndex].close, decision.reasonCodes);
  } else if (decision.action === "sell" && position) {
    await executeSell(market, position, candles[candleIndex].close, decision.reasonCodes);
  }
}

function getScenarioForMarket(market: string) {
  return marketScenario.get(market) ?? arbitrageStrategy.defaultScenario;
}

// ── 주문 실행 ────────────────────────────────────────────────────────────────

async function executeBuy(market: string, price: number, reasonCodes: string[]) {
  if (orderInProgress.has(market)) return; // 이미 주문 진행 중
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
    if (openCount >= MAX_COINS) {
      console.log(`[live-trader] 스킵 — 최대 포지션 수 도달 (${openCount}/${MAX_COINS})`);
      return;
    }
    const totalInvested = Object.values(state.positions).reduce(
      (sum, p) => sum + parseFloat(p.quantity) * p.avgBuyPrice, 0,
    );
    if (totalInvested + ORDER_AMOUNT > TOTAL_BUDGET) {
      console.log(`[live-trader] 스킵 — 예산 초과 (투자 ${Math.floor(totalInvested).toLocaleString()}원 + ${ORDER_AMOUNT.toLocaleString()}원 > 예산 ${TOTAL_BUDGET.toLocaleString()}원)`);
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
    state.trades.push({ at: new Date().toISOString(), market, side: "buy", amount: ORDER_AMOUNT, price, actualPrice, netKrw, dryRun: false, reasonCodes });
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
    state.trades.push({ at: new Date().toISOString(), market, side: "sell", amount: parseFloat(position.quantity), price, actualPrice, netKrw, pnlKrw, dryRun: false, reasonCodes });
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
  state.trades.push({ at: new Date().toISOString(), market, side, amount, price, dryRun: true, reasonCodes });
  await saveState(state);
}

// ── 상태 출력 + 하트비트 ──────────────────────────────────────────────────────

// 30초마다 공개 상태 파일 갱신 — 거래가 없어도 UI에 최신 updatedAt 유지
setInterval(() => {
  writePublicStatus(state).catch((e) => console.error("[live-trader] 하트비트 상태 쓰기 실패:", e));
}, 30_000);

setInterval(() => {
  const pos = Object.values(state.positions).map((p) => p.market.replace("KRW-", "")).join(", ") || "없음";
  const trades = state.trades.length;
  console.log(`[live-trader] 포지션: ${pos} | 누적 거래: ${trades}회 | ${DRY_RUN ? "DRY-RUN" : "실매매"}`);
}, 60_000);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// ── 시작 ─────────────────────────────────────────────────────────────────────

init().catch((e) => { console.error("[live-trader] 초기화 실패:", e); process.exit(1); });
