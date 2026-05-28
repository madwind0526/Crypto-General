// scripts/live-trader.ts
import "dotenv/config";
import WebSocket from "ws";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// scripts/upbitOrder.ts
import crypto2 from "node:crypto";

// node_modules/uuid/dist-node/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
}

// node_modules/uuid/dist-node/rng.js
var rnds8 = new Uint8Array(16);
function rng() {
  return crypto.getRandomValues(rnds8);
}

// node_modules/uuid/dist-node/v4.js
function v4(options, buf, offset) {
  if (!buf && !options && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return _v4(options, buf, offset);
}
function _v4(options, buf, offset) {
  options = options || {};
  const rnds = options.random ?? options.rng?.() ?? rng();
  if (rnds.length < 16) {
    throw new Error("Random bytes length must be >= 16");
  }
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    if (offset < 0 || offset + 16 > buf.length) {
      throw new RangeError(`UUID byte range ${offset}:${offset + 15} is out of buffer bounds`);
    }
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
var v4_default = v4;

// scripts/upbitOrder.ts
var UPBIT_BASE_URL = "https://api.upbit.com";
var REQUEST_TIMEOUT_MS = 1e4;
var RETRY_BASE_MS = 500;
var MAX_READ_RETRIES = 3;
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function buildJwt(accessKey, secretKey, queryParams) {
  let payload = {
    access_key: accessKey,
    nonce: v4_default()
  };
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString();
    const hash = crypto2.createHash("sha512").update(qs).digest("hex");
    payload = { ...payload, query_hash: hash, query_hash_alg: "SHA512" };
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto2.createHmac("sha256", secretKey).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
async function upbitRequest(accessKey, secretKey, method, path2, params, body) {
  const maxAttempts = method === "GET" ? MAX_READ_RETRIES : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const jwtParams = method === "POST" ? body : params;
    const jwt = buildJwt(accessKey, secretKey, jwtParams);
    const url = (method === "GET" || method === "DELETE") && params ? `${UPBIT_BASE_URL}${path2}?${new URLSearchParams(params)}` : `${UPBIT_BASE_URL}${path2}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        signal: controller.signal,
        ...body ? { body: JSON.stringify(body) } : {}
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (method === "GET" && attempt < maxAttempts) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw e;
    }
    clearTimeout(timeoutId);
    if (res.status === 429) {
      if (method === "GET" && attempt < maxAttempts) {
        const retryAfterMs = parseInt(res.headers.get("Retry-After") ?? "1", 10) * 1e3;
        await sleep(Math.max(retryAfterMs, RETRY_BASE_MS * attempt));
        continue;
      }
      const text = await res.text();
      throw new Error(`Upbit rate-limited: ${text}`);
    }
    if (res.status >= 500 && method === "GET" && attempt < maxAttempts) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Upbit ${method} ${path2} \u2192 ${res.status}: ${text}`);
    }
    return res.json();
  }
  throw new Error(`Upbit ${method} ${path2} \u2014 ${maxAttempts}\uD68C \uC7AC\uC2DC\uB3C4 \uD6C4 \uC2E4\uD328`);
}
async function getAccounts(accessKey, secretKey) {
  return upbitRequest(accessKey, secretKey, "GET", "/v1/accounts");
}
async function getKrwBalance(accessKey, secretKey) {
  const accounts = await getAccounts(accessKey, secretKey);
  const krw = accounts.find((a) => a.currency === "KRW");
  return krw ? parseFloat(krw.balance) : 0;
}
async function placeMarketBuy(accessKey, secretKey, market, krwAmount) {
  if (krwAmount < 5e3) throw new Error(`\uCD5C\uC18C \uC8FC\uBB38 \uAE08\uC561\uC740 5,000\uC6D0 (\uC694\uCCAD: ${krwAmount}\uC6D0)`);
  return upbitRequest(accessKey, secretKey, "POST", "/v1/orders", void 0, {
    market,
    side: "bid",
    price: String(Math.floor(krwAmount)),
    ord_type: "price"
  });
}
async function placeMarketSell(accessKey, secretKey, market, volume) {
  return upbitRequest(accessKey, secretKey, "POST", "/v1/orders", void 0, {
    market,
    side: "ask",
    volume,
    ord_type: "market"
  });
}
async function getOrder(accessKey, secretKey, uuid) {
  return upbitRequest(accessKey, secretKey, "GET", "/v1/order", { uuid });
}
async function cancelOrder(accessKey, secretKey, uuid) {
  return upbitRequest(accessKey, secretKey, "DELETE", "/v1/order", { uuid });
}

// src/indicators/technical.ts
function rateOfChange(values, period) {
  return values.map((value, index) => {
    if (index < period) return null;
    const previous = values[index - period];
    return previous === 0 ? 0 : (value - previous) / previous;
  });
}

// src/strategies/arbitrage.ts
var arbitrageScenario = {
  id: "relative-strength-arb-default",
  traderId: "arbitrage",
  name: "Relative-value proxy",
  description: "A spot-only proxy for future pair/funding arbitrage infrastructure.",
  params: {
    lookback: 48,
    zEntry: -1.6,
    zExit: -0.2,
    stopLossPct: 0.03,
    maxHoldCandles: 48,
    minProfitPct: 0.01,
    // exit only when z recovers AND return >= this threshold
    cooldownBars: 5
    // bars to skip after closing before re-entering
  }
};
var arbitrageScenarios = [
  {
    ...arbitrageScenario,
    id: "relative-value-balanced",
    name: "Balanced relative value"
  },
  {
    ...arbitrageScenario,
    id: "relative-value-fast",
    name: "Fast relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 24,
      zEntry: -1.25,
      zExit: -0.05,
      stopLossPct: 0.025,
      maxHoldCandles: 24,
      minProfitPct: 5e-3,
      // fast scenario: 0.5% (quick mean-reversion, lower threshold)
      cooldownBars: 3
    }
  },
  {
    ...arbitrageScenario,
    id: "relative-value-deep",
    name: "Deep relative value",
    params: {
      ...arbitrageScenario.params,
      lookback: 72,
      zEntry: -2.1,
      zExit: -0.35,
      stopLossPct: 0.045,
      maxHoldCandles: 72,
      minProfitPct: 8e-3,
      cooldownBars: 10
    }
  }
];
var arbitrageStrategy = {
  id: "arbitrage",
  name: "Statistical / Funding Arbitrage",
  description: "\uCD08\uAE30 \uBC84\uC804\uC740 \uD604\uBB3C \uB370\uC774\uD130\uB9CC \uC0AC\uC6A9\uD574 \uC0C1\uB300\uC801\uC73C\uB85C \uB20C\uB9B0 \uC885\uBAA9\uC758 \uD68C\uADC0 \uAC00\uB2A5\uC131\uC744 \uD14C\uC2A4\uD2B8\uD569\uB2C8\uB2E4.",
  defaultScenario: arbitrageScenario,
  scenarios: arbitrageScenarios,
  decide(context, scenario = arbitrageScenario) {
    const { candles, candleIndex, position, lastSellCandleIndex } = context;
    const params = scenario.params;
    const current = candles[candleIndex];
    const indicators = getArbitrageIndicators(candles, scenario);
    const window = indicators.returns.slice(Math.max(0, candleIndex - params.lookback), candleIndex);
    if (window.length < params.lookback) return hold("warming-up");
    const average = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / (window.length - 1);
    const sd = Math.sqrt(variance);
    if (sd === 0) return hold("flat-relative-window");
    const zScore = (indicators.returns[candleIndex] - average) / sd;
    const minProfitPct = params.minProfitPct ?? 0;
    const cooldownBars = params.cooldownBars ?? 0;
    if (position) {
      const returnPct = (current.close - position.averagePrice) / position.averagePrice;
      if (position.holdCandles >= params.maxHoldCandles) {
        return { action: "sell", confidence: 0.58, reasonCodes: ["max-hold-exit"], targetWeight: 0 };
      }
      if (zScore >= params.zExit) {
        if (returnPct >= minProfitPct) {
          return { action: "sell", confidence: 0.58, reasonCodes: ["relative-value-normalized", "profit-target"], targetWeight: 0 };
        }
        return hold("awaiting-profit-target");
      }
      return hold("relative-position-running");
    }
    if (cooldownBars > 0 && lastSellCandleIndex !== void 0) {
      if (candleIndex - lastSellCandleIndex < cooldownBars) {
        return hold("cooldown");
      }
    }
    if (zScore <= params.zEntry) {
      return {
        action: "buy",
        confidence: 0.54,
        reasonCodes: ["temporary-underperformance", "statistical-reversion-candidate"],
        targetWeight: 0.45,
        stopLossPct: params.stopLossPct,
        maxHoldCandles: params.maxHoldCandles
      };
    }
    return hold("no-relative-value-entry");
  }
};
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}
var arbitrageIndicatorCache = /* @__PURE__ */ new WeakMap();
function getArbitrageIndicators(candles, scenario) {
  let scenarioCache = arbitrageIndicatorCache.get(candles);
  if (!scenarioCache) {
    scenarioCache = /* @__PURE__ */ new Map();
    arbitrageIndicatorCache.set(candles, scenarioCache);
  }
  const key = getMutableCandleCacheKey(candles, scenario);
  const cached = scenarioCache.get(key);
  if (cached) return cached;
  const closes = candles.map((candle) => candle.close);
  const returns = rateOfChange(closes, 1).map((value) => value ?? 0);
  const indicators = {
    returns
  };
  scenarioCache.set(key, indicators);
  return indicators;
}
function getMutableCandleCacheKey(candles, scenario) {
  return `${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}:${JSON.stringify(scenario.params)}`;
}

// scripts/live-trader.ts
var ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? "";
var SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? "";
var LIVE_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
var DRY_RUN = process.argv.includes("--dry-run") || !ACCESS_KEY || !SECRET_KEY || !LIVE_ENABLED;
var TOTAL_BUDGET = Number(process.env.LIVE_BUDGET ?? 1e6);
var MAX_COINS = 9;
var BUDGET_PER_COIN = Math.floor(TOTAL_BUDGET / MAX_COINS);
var TARGET_WEIGHT = 0.45;
var ORDER_AMOUNT = Math.floor(BUDGET_PER_COIN * TARGET_WEIGHT);
var MIN_ORDER_KRW = 5500;
var MAX_DAILY_LOSS_KRW = Number(process.env.MAX_DAILY_LOSS_KRW ?? Math.floor(TOTAL_BUDGET * 0.1));
var root = process.cwd();
var statePath = path.join(root, "data", "local", "live-trader-state.json");
var publicStatusPath = path.join(root, "public", "market", "live-trade-status.json");
var planDir = path.join(root, "data", "local", "traders", "arbitrage");
var maxCandles = 1440;
var wsUrl = "wss://api.upbit.com/websocket/v1";
var closedCandles = {};
var liveCandle = {};
var lastMinute = {};
var state;
var selectedMarkets = [];
var marketScenario = /* @__PURE__ */ new Map();
var saveChain = Promise.resolve();
var orderInProgress = /* @__PURE__ */ new Set();
var emergencyStopPath = path.join(root, "data", "local", "live-trading-disabled.flag");
var freezeAllPath = path.join(root, "data", "local", "live-trading-freeze-all.flag");
var cachedKrwCash = null;
var cachedKrwCashAt = 0;
var statusSequence = 0;
var activeWs = null;
var reconnectTimer = null;
async function isEntryBlocked() {
  try {
    await access(emergencyStopPath);
    return true;
  } catch {
  }
  try {
    await access(freezeAllPath);
    return true;
  } catch {
  }
  return false;
}
async function isAllTradesBlocked() {
  try {
    await access(freezeAllPath);
    return true;
  } catch {
    return false;
  }
}
async function init() {
  if (DRY_RUN) {
    console.log("[live-trader] \u26A0\uFE0F  DRY RUN \uBAA8\uB4DC \u2014 \uC2E4\uC81C \uC8FC\uBB38 \uC5C6\uC74C");
    if (!ACCESS_KEY) console.log("[live-trader] \uC774\uC720: UPBIT_ACCESS_KEY \uBBF8\uC124\uC815");
    else if (!SECRET_KEY) console.log("[live-trader] \uC774\uC720: UPBIT_SECRET_KEY \uBBF8\uC124\uC815");
    else if (!LIVE_ENABLED) console.log("[live-trader] \uC774\uC720: LIVE_TRADING_ENABLED=true \uBBF8\uC124\uC815 (.env)");
  } else {
    console.log("[live-trader] \u{1F534} \uC2E4\uB9E4\uB9E4 \uBAA8\uB4DC");
  }
  const planPath = path.join(planDir, "selected-symbols.ignored.json");
  console.log(`[live-trader] \uD50C\uB79C \uD30C\uC77C: ${planPath}`);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  selectedMarkets = plan.selectedMarkets.map((m) => m.market);
  for (const item of plan.selectedMarkets) {
    const scenario = arbitrageStrategy.scenarios.find((s) => s.id === item.bestResult.scenarioId) ?? arbitrageStrategy.defaultScenario;
    marketScenario.set(item.market, scenario);
  }
  console.log(`[live-trader] \uB300\uC0C1 \uCF54\uC778 (${selectedMarkets.length}\uAC1C): ${selectedMarkets.map((m) => m.replace("KRW-", "")).join(", ")}`);
  for (const [market, scenario] of marketScenario) {
    console.log(`[live-trader]   ${market.replace("KRW-", "").padEnd(8)} \u2192 ${scenario.name}`);
  }
  await loadCandleHistory();
  state = await loadState();
  if (!DRY_RUN) {
    await syncPositionsFromUpbit();
    await reconcilePendingBuys();
    await reconcilePendingSells();
  }
  console.log(`[live-trader] \uCF54\uC778\uB2F9 \uC608\uC0B0: ${BUDGET_PER_COIN.toLocaleString()}\uC6D0 | 1\uD68C \uB9E4\uC218: ${ORDER_AMOUNT.toLocaleString()}\uC6D0`);
  console.log(`[live-trader] \uD604\uC7AC \uD3EC\uC9C0\uC158: ${Object.keys(state.positions).length}\uAC1C`);
  await writePublicStatus(state);
  connect();
}
async function loadCandleHistory() {
  const cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    for (const market of selectedMarkets) {
      closedCandles[market] = (cache.candlesByMarket[market] ?? []).slice(-maxCandles);
    }
    console.log(`[live-trader] \uCE94\uB4E4 \uD788\uC2A4\uD1A0\uB9AC \uB85C\uB4DC \uC644\uB8CC`);
  } catch {
    console.warn("[live-trader] \uCE94\uB4E4 \uD788\uC2A4\uD1A0\uB9AC \uC5C6\uC74C \u2014 \uBE48 \uC0C1\uD0DC\uB85C \uC2DC\uC791 (\uC6CC\uBC0D\uC5C5 \uD544\uC694)");
    for (const market of selectedMarkets) closedCandles[market] = [];
  }
}
async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    const fresh = {
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      totalBudget: TOTAL_BUDGET,
      budgetPerCoin: BUDGET_PER_COIN,
      positions: {},
      trades: [],
      lastSellAt: {},
      startBalance: void 0
    };
    await saveState(fresh);
    return fresh;
  }
}
async function saveState(s) {
  const snapshot = JSON.stringify(s, null, 2);
  await (saveChain = saveChain.catch(() => {
  }).then(async () => {
    await mkdir(path.dirname(statePath), { recursive: true });
    const tmp = statePath + ".tmp";
    await writeFile(tmp, snapshot, "utf8");
    await rename(tmp, statePath);
    await writePublicStatus(s);
  }));
}
async function computeBalance(s) {
  const safe = (v) => isFinite(v) ? v : 0;
  const positions = Object.values(s.positions);
  const invested = safe(positions.reduce((sum, p) => sum + safe(parseFloat(p.quantity)) * safe(p.avgBuyPrice), 0));
  const currentValue = safe(positions.reduce((sum, p) => {
    const candles = closedCandles[p.market];
    const latestPrice = safe(candles?.[candles.length - 1]?.close ?? p.avgBuyPrice);
    return sum + safe(parseFloat(p.quantity)) * latestPrice;
  }, 0));
  if (DRY_RUN) {
    const krwCash2 = Math.max(0, s.totalBudget - invested);
    return { krwCash: krwCash2, invested, currentValue, totalValue: krwCash2 + currentValue, unrealizedPnl: currentValue - invested };
  }
  const now = Date.now();
  if (cachedKrwCash === null || now - cachedKrwCashAt > 6e4) {
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
async function writePublicStatus(s) {
  const balance = await computeBalance(s);
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
    startBalance: s.startBalance
  };
  try {
    await mkdir(path.dirname(publicStatusPath), { recursive: true });
    const tmp = publicStatusPath + ".tmp";
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, publicStatusPath);
  } catch (e) {
    console.error("[live-trader] \u26A0\uFE0F \uC0C1\uD0DC \uD30C\uC77C \uC4F0\uAE30 \uC2E4\uD328:", e);
  }
}
async function syncPositionsFromUpbit() {
  try {
    const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
    for (const market of selectedMarkets) {
      const currency = market.replace("KRW-", "");
      const account = accounts.find((a) => a.currency === currency);
      if (account && parseFloat(account.balance) > 0) {
        if (!state.positions[market]) {
          state.positions[market] = {
            market,
            quantity: account.balance,
            avgBuyPrice: parseFloat(account.avg_buy_price),
            entryAt: (/* @__PURE__ */ new Date()).toISOString(),
            orderUuid: "synced-from-upbit"
          };
          console.log(`[live-trader] \uD3EC\uC9C0\uC158 \uB3D9\uAE30\uD654: ${market} ${account.balance}\uAC1C @ ${account.avg_buy_price}\uC6D0`);
        }
      }
    }
    if (state.startBalance === void 0) {
      const krwAccount = accounts.find((a) => a.currency === "KRW");
      const krwCash = krwAccount ? parseFloat(krwAccount.balance) + parseFloat(krwAccount.locked) : 0;
      const posVal = Object.values(state.positions).reduce((sum, p) => {
        const candles = closedCandles[p.market];
        const price = candles?.[candles.length - 1]?.close ?? p.avgBuyPrice;
        return sum + parseFloat(p.quantity) * price;
      }, 0);
      state.startBalance = krwCash + posVal;
      console.log(`[live-trader] \uC2DC\uC791 \uC794\uACE0 \uAE30\uB85D (\uCD5C\uCD08): ${Math.floor(state.startBalance).toLocaleString()}\uC6D0 (\uD604\uAE08 ${Math.floor(krwCash).toLocaleString()}\uC6D0 + \uCF54\uC778 ${Math.floor(posVal).toLocaleString()}\uC6D0)`);
    } else {
      console.log(`[live-trader] \uC2DC\uC791 \uC794\uACE0 \uC720\uC9C0: ${Math.floor(state.startBalance).toLocaleString()}\uC6D0`);
    }
    await saveState(state);
  } catch (e) {
    console.error("[live-trader] \uC794\uACE0 \uB3D9\uAE30\uD654 \uC2E4\uD328:", e);
  }
}
async function reconcilePendingBuys() {
  const pending = state.pendingBuys;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] \uBBF8\uC644\uB8CC \uB9E4\uC218 \uC8FC\uBB38 \uC815\uC0B0 (${Object.keys(pending).length}\uAC74)...`);
  for (const [uuid, pb] of Object.entries(pending)) {
    try {
      const filled = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      if (filled.state === "done") {
        const executedVolume = parseFloat(filled.executed_volume ?? "0");
        if (executedVolume > 0 && !state.positions[pb.market]) {
          const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : pb.price;
          state.positions[pb.market] = { market: pb.market, quantity: String(executedVolume), avgBuyPrice: actualPrice, entryAt: pb.at, orderUuid: uuid };
          state.trades.push({ at: pb.at, market: pb.market, side: "buy", amount: pb.amount, price: pb.price, actualPrice, netKrw: pb.amount, dryRun: false, reasonCodes: pb.reasonCodes });
          console.log(`[live-trader] \u2705 \uD39C\uB529 \uB9E4\uC218 \uC644\uB8CC \uC815\uC0B0: ${pb.market} ${executedVolume}\uAC1C @ ${actualPrice.toLocaleString()}\uC6D0`);
        }
      } else if (filled.state === "wait" || filled.state === "watch") {
        let cancelOk = false;
        try {
          await cancelOrder(ACCESS_KEY, SECRET_KEY, uuid);
          cancelOk = true;
          console.log(`[live-trader] \u{1F5D1}\uFE0F \uBBF8\uCCB4\uACB0 \uB9E4\uC218 \uCDE8\uC18C: ${uuid} (${pb.market})`);
        } catch (cancelErr) {
          console.error(`[live-trader] \uBBF8\uCCB4\uACB0 \uB9E4\uC218 \uCDE8\uC18C \uC2E4\uD328 (${uuid}):`, cancelErr);
        }
        if (cancelOk) {
          try {
            const afterCancel = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
            const partialVol = parseFloat(afterCancel.executed_volume ?? "0");
            if (partialVol > 0 && !state.positions[pb.market]) {
              const actualPrice = afterCancel.avg_price ? parseFloat(afterCancel.avg_price) : pb.price;
              const netKrw = afterCancel.executed_funds ? parseFloat(afterCancel.executed_funds) : partialVol * actualPrice;
              state.positions[pb.market] = { market: pb.market, quantity: String(partialVol), avgBuyPrice: actualPrice, entryAt: pb.at, orderUuid: uuid };
              state.trades.push({ at: pb.at, market: pb.market, side: "buy", amount: pb.amount, price: pb.price, actualPrice, netKrw, dryRun: false, reasonCodes: pb.reasonCodes });
              console.log(`[live-trader] \u26A0\uFE0F \uBD80\uBD84 \uCCB4\uACB0 \uD3EC\uC9C0\uC158 \uAE30\uB85D: ${pb.market} ${partialVol}\uAC1C @ ${actualPrice.toLocaleString()}\uC6D0`);
            }
          } catch (reQueryErr) {
            console.error(`[live-trader] \uCDE8\uC18C \uD6C4 \uC7AC\uC870\uD68C \uC2E4\uD328 (${uuid}):`, reQueryErr);
            continue;
          }
        }
      } else {
        console.log(`[live-trader] \uB9E4\uC218 \uC774\uBBF8 \uCDE8\uC18C\uB428: ${uuid} (${pb.market})`);
      }
      delete pending[uuid];
    } catch (e) {
      console.error(`[live-trader] \uD39C\uB529 \uC8FC\uBB38 \uC870\uD68C \uC2E4\uD328 (${uuid}):`, e);
    }
  }
  await saveState(state);
}
async function reconcilePendingSells() {
  const pending = state.pendingSells;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] \uBBF8\uC644\uB8CC \uB9E4\uB3C4 \uC8FC\uBB38 \uC815\uC0B0 (${Object.keys(pending).length}\uAC74)...`);
  for (const [uuid, ps] of Object.entries(pending)) {
    try {
      const filled = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      if (filled.state === "done") {
        const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : void 0;
        const netKrw = filled.executed_funds && filled.paid_fee ? parseFloat(filled.executed_funds) - parseFloat(filled.paid_fee) : void 0;
        const pnlKrw = netKrw !== void 0 ? netKrw - ps.costBasis : void 0;
        const candleTs = closedCandles[ps.market]?.[closedCandles[ps.market].length - 1]?.timestamp;
        if (candleTs) state.lastSellAt[ps.market] = candleTs;
        delete state.positions[ps.market];
        state.trades.push({ at: ps.at, market: ps.market, side: "sell", amount: parseFloat(ps.quantity), price: ps.price, actualPrice, netKrw, pnlKrw, dryRun: false, reasonCodes: ps.reasonCodes });
        console.log(`[live-trader] \u2705 \uD39C\uB529 \uB9E4\uB3C4 \uC644\uB8CC \uC815\uC0B0: ${ps.market} @ ${actualPrice?.toLocaleString() ?? "?"}\uC6D0`);
        delete pending[uuid];
      } else if (filled.state === "wait" || filled.state === "watch") {
        console.log(`[live-trader] \uB9E4\uB3C4 \uC5EC\uC804\uD788 \uBBF8\uCCB4\uACB0: ${uuid} (${ps.market}, state=${filled.state})`);
      } else {
        console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uB3C4 \uCDE8\uC18C\uB428: ${uuid} (${ps.market}) \u2014 \uC218\uB3D9 \uD655\uC778 \uD544\uC694`);
        delete pending[uuid];
      }
    } catch (e) {
      console.error(`[live-trader] \uD39C\uB529 \uB9E4\uB3C4 \uC870\uD68C \uC2E4\uD328 (${uuid}):`, e);
    }
  }
  await saveState(state);
}
function connect() {
  if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  console.log("[live-trader] WebSocket \uC5F0\uACB0 \uC911...");
  const ws = new WebSocket(wsUrl);
  activeWs = ws;
  ws.on("open", () => {
    ws.send(JSON.stringify([{ ticket: "live-trader" }, { type: "trade", codes: selectedMarkets }]));
    console.log("[live-trader] WebSocket \uC5F0\uACB0\uB428");
  });
  ws.on("message", (data) => {
    try {
      const tick = JSON.parse(data.toString("utf8"));
      if (tick.type === "trade") handleTick(tick);
    } catch {
    }
  });
  ws.on("close", () => {
    console.log("[live-trader] WebSocket \uB04A\uAE40. 5\uCD08 \uD6C4 \uC7AC\uC5F0\uACB0...");
    if (activeWs === ws) activeWs = null;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5e3);
  });
  ws.on("error", (e) => {
    console.error("[live-trader] WebSocket \uC624\uB958:", e.message);
    ws.terminate();
  });
}
function handleTick(tick) {
  const market = tick.code;
  const tickTs = tick.trade_timestamp;
  const minuteTs = Math.floor(tickTs / 6e4) * 6e4;
  const prev = lastMinute[market];
  if (prev !== void 0 && minuteTs > prev) {
    const closed = closeLiveCandle(market);
    if (closed) {
      upsertCandle(closedCandles[market], closed);
      setTimeout(() => processMinuteClose(market, closed), 1500);
    }
    liveCandle[market] = newLiveCandle(market, tick, minuteTs);
  } else if (!liveCandle[market]) {
    liveCandle[market] = newLiveCandle(market, tick, minuteTs);
  } else {
    updateLiveCandle(liveCandle[market], tick);
  }
  lastMinute[market] = minuteTs;
  checkTickStopLoss(market, tick.trade_price);
}
function closeLiveCandle(market) {
  const c = liveCandle[market];
  if (!c) return null;
  return { market: c.market, timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, quoteVolume: c.quoteVolume };
}
function newLiveCandle(market, tick, minuteTs) {
  return { market, timestamp: minuteTs, open: tick.trade_price, high: tick.trade_price, low: tick.trade_price, close: tick.trade_price, volume: tick.trade_volume, quoteVolume: tick.trade_price * tick.trade_volume };
}
function updateLiveCandle(c, tick) {
  c.close = tick.trade_price;
  if (tick.trade_price > c.high) c.high = tick.trade_price;
  if (tick.trade_price < c.low) c.low = tick.trade_price;
  c.volume += tick.trade_volume;
  c.quoteVolume += tick.trade_price * tick.trade_volume;
}
function upsertCandle(arr, candle) {
  const last = arr[arr.length - 1];
  if (last?.timestamp === candle.timestamp) {
    arr[arr.length - 1] = candle;
  } else {
    arr.push(candle);
    if (arr.length > maxCandles) arr.shift();
  }
}
function derivePnlKrw(sell) {
  if (sell.pnlKrw !== void 0) return sell.pnlKrw;
  if (!sell.netKrw) return 0;
  const buyEntry = [...state.trades].reverse().find(
    (t) => t.market === sell.market && t.side === "buy" && t.at <= sell.at
  );
  const costBasis = buyEntry ? buyEntry.netKrw ?? buyEntry.amount : 0;
  return sell.netKrw - costBasis;
}
function getDailyRealizedLoss() {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return state.trades.filter((t) => t.at.startsWith(today) && t.side === "sell" && !t.dryRun).reduce((sum, t) => {
    const pnl = derivePnlKrw(t);
    return sum + (pnl < 0 ? Math.abs(pnl) : 0);
  }, 0);
}
function checkTickStopLoss(market, tickPrice) {
  if (!state) return;
  const position = state.positions[market];
  if (!position || orderInProgress.has(market)) return;
  const scenario = getScenarioForMarket(market);
  const stopLossPct = scenario.params.stopLossPct;
  if (!stopLossPct || stopLossPct <= 0) return;
  const lossRatio = (position.avgBuyPrice - tickPrice) / position.avgBuyPrice;
  if (lossRatio >= stopLossPct) {
    executeSell(market, position, tickPrice, ["stop-loss-tick"]).catch(console.error);
  }
}
async function processMinuteClose(market, _closedCandle) {
  const candles = closedCandles[market];
  if (!candles || candles.length < 60) return;
  const scenario = getScenarioForMarket(market);
  if (!scenario) return;
  const position = state.positions[market];
  const candleIndex = candles.length - 1;
  const lastSellCandleIndex = state.lastSellAt[market] !== void 0 ? candles.findIndex((c) => c.timestamp === state.lastSellAt[market]) : void 0;
  const context = {
    candles,
    candleIndex,
    position: position ? {
      market,
      averagePrice: position.avgBuyPrice,
      quantity: parseFloat(position.quantity),
      holdCandles: Math.floor((Date.now() - new Date(position.entryAt).getTime()) / 6e4),
      highestPrice: position.avgBuyPrice
      // simplified
    } : null,
    lastSellPrice: void 0,
    lastSellCandleIndex: lastSellCandleIndex !== void 0 && lastSellCandleIndex >= 0 ? lastSellCandleIndex : void 0
  };
  if (position) {
    const stopLossPct = scenario.params.stopLossPct;
    if (stopLossPct && stopLossPct > 0) {
      const currentPrice = candles[candleIndex].close;
      const candleLow = candles[candleIndex].low;
      const checkPrice = Math.min(currentPrice, candleLow);
      const lossRatio = (position.avgBuyPrice - checkPrice) / position.avgBuyPrice;
      if (lossRatio >= stopLossPct) {
        console.warn(`[live-trader] \u{1F6D1} \uD558\uB4DC \uC190\uC808 \u2014 ${market} \uC190\uC2E4 ${(lossRatio * 100).toFixed(2)}% \u2265 ${(stopLossPct * 100).toFixed(2)}%`);
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
function getScenarioForMarket(market) {
  return marketScenario.get(market) ?? arbitrageStrategy.defaultScenario;
}
async function executeBuy(market, price, reasonCodes) {
  if (orderInProgress.has(market)) return;
  orderInProgress.add(market);
  try {
    const coin = market.replace("KRW-", "");
    const log = `[BUY] ${coin} ${ORDER_AMOUNT.toLocaleString()}\uC6D0 @ ~${price.toLocaleString()}\uC6D0 | ${reasonCodes.join(",")}`;
    if (ORDER_AMOUNT < MIN_ORDER_KRW) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 \uC8FC\uBB38\uAE08\uC561 \uBD80\uC871 (${ORDER_AMOUNT}\uC6D0 < ${MIN_ORDER_KRW}\uC6D0)`);
      return;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] ${log}`);
      await recordDryTrade(market, "buy", ORDER_AMOUNT, price, reasonCodes);
      return;
    }
    if (await isEntryBlocked()) {
      console.warn(`[live-trader] \u{1F6D1} \uBE44\uC0C1 \uC815\uC9C0 \uD30C\uC77C \uAC10\uC9C0 \u2014 \uB9E4\uC218 \uCC28\uB2E8: ${market}`);
      return;
    }
    const openCount = Object.keys(state.positions).length;
    if (openCount >= MAX_COINS) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 \uCD5C\uB300 \uD3EC\uC9C0\uC158 \uC218 \uB3C4\uB2EC (${openCount}/${MAX_COINS})`);
      return;
    }
    const totalInvested = Object.values(state.positions).reduce(
      (sum, p) => sum + parseFloat(p.quantity) * p.avgBuyPrice,
      0
    );
    if (totalInvested + ORDER_AMOUNT > TOTAL_BUDGET) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 \uC608\uC0B0 \uCD08\uACFC (\uD22C\uC790 ${Math.floor(totalInvested).toLocaleString()}\uC6D0 + ${ORDER_AMOUNT.toLocaleString()}\uC6D0 > \uC608\uC0B0 ${TOTAL_BUDGET.toLocaleString()}\uC6D0)`);
      return;
    }
    const krwAvailable = await getKrwBalance(ACCESS_KEY, SECRET_KEY).catch(() => 0);
    if (krwAvailable < ORDER_AMOUNT) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 KRW \uC794\uACE0 \uBD80\uC871 (${Math.floor(krwAvailable).toLocaleString()}\uC6D0 < ${ORDER_AMOUNT.toLocaleString()}\uC6D0)`);
      return;
    }
    const dailyLoss = getDailyRealizedLoss();
    if (dailyLoss >= MAX_DAILY_LOSS_KRW) {
      console.warn(`[live-trader] \uC2A4\uD0B5 \u2014 \uC77C\uC77C \uC190\uC2E4 \uD55C\uB3C4 \uB3C4\uB2EC (${Math.floor(dailyLoss).toLocaleString()}\uC6D0 \u2265 ${MAX_DAILY_LOSS_KRW.toLocaleString()}\uC6D0)`);
      return;
    }
    const order = await placeMarketBuy(ACCESS_KEY, SECRET_KEY, market, ORDER_AMOUNT);
    console.log(`[live-trader] \u2705 ${log} \u2192 uuid=${order.uuid}`);
    await sleep2(2e3);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep2(2e3);
      filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    }
    if (filled.state !== "done") {
      console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uC218 \uCCB4\uACB0 \uBBF8\uC644\uB8CC (uuid=${order.uuid}, state=${filled.state}, vol=${filled.executed_volume}) \u2014 \uD39C\uB529\uC73C\uB85C \uAE30\uB85D`);
      state.pendingBuys = state.pendingBuys ?? {};
      state.pendingBuys[order.uuid] = { uuid: order.uuid, market, amount: ORDER_AMOUNT, price, reasonCodes, at: (/* @__PURE__ */ new Date()).toISOString() };
      await saveState(state);
      return;
    }
    const executedVolume = parseFloat(filled.executed_volume ?? "0");
    if (executedVolume <= 0) {
      console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uC218 \uCCB4\uACB0\uB7C9 0 (uuid=${order.uuid}) \u2014 \uC0C1\uD0DC \uBBF8\uBC18\uC601`);
      return;
    }
    const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : void 0;
    const avgBuyPrice = actualPrice ?? price;
    const netKrw = ORDER_AMOUNT;
    state.positions[market] = {
      market,
      quantity: String(executedVolume),
      avgBuyPrice,
      entryAt: (/* @__PURE__ */ new Date()).toISOString(),
      orderUuid: order.uuid
    };
    state.trades.push({ at: (/* @__PURE__ */ new Date()).toISOString(), market, side: "buy", amount: ORDER_AMOUNT, price, actualPrice, netKrw, dryRun: false, reasonCodes });
    await saveState(state);
  } catch (e) {
    console.error(`[live-trader] \u274C \uB9E4\uC218 \uC2E4\uD328 ${market}:`, e);
  } finally {
    orderInProgress.delete(market);
  }
}
async function executeSell(market, position, price, reasonCodes) {
  if (orderInProgress.has(market)) return;
  if (state.pendingSells && Object.values(state.pendingSells).some((ps) => ps.market === market)) {
    console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uB3C4 \uC2A4\uD0B5 \u2014 \uBBF8\uC644\uB8CC \uB9E4\uB3C4 \uC8FC\uBB38\uC774 \uC788\uC74C: ${market}`);
    return;
  }
  orderInProgress.add(market);
  try {
    const coin = market.replace("KRW-", "");
    const log = `[SELL] ${coin} ${position.quantity}\uAC1C @ ~${price.toLocaleString()}\uC6D0 | ${reasonCodes.join(",")}`;
    if (DRY_RUN) {
      console.log(`[dry-run] ${log}`);
      const qty = parseFloat(position.quantity);
      await recordDryTrade(market, "sell", qty, price, reasonCodes);
      return;
    }
    if (await isAllTradesBlocked()) {
      console.warn(`[live-trader] \u{1F6D1} freeze-all \uD30C\uC77C \uAC10\uC9C0 \u2014 \uB9E4\uB3C4 \uCC28\uB2E8: ${market}`);
      return;
    }
    const order = await placeMarketSell(ACCESS_KEY, SECRET_KEY, market, position.quantity);
    console.log(`[live-trader] \u2705 ${log} \u2192 uuid=${order.uuid}`);
    await sleep2(2e3);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep2(2e3);
      filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    }
    if (filled.state !== "done") {
      console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uB3C4 \uCCB4\uACB0 \uBBF8\uD655\uC778 (uuid=${order.uuid}, state=${filled.state}) \u2014 \uD39C\uB529\uC73C\uB85C \uAE30\uB85D`);
      state.pendingSells = state.pendingSells ?? {};
      state.pendingSells[order.uuid] = {
        uuid: order.uuid,
        market,
        quantity: position.quantity,
        price,
        reasonCodes,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        costBasis: parseFloat(position.quantity) * position.avgBuyPrice
      };
      await saveState(state);
      return;
    }
    const actualPrice = filled.avg_price ? parseFloat(filled.avg_price) : void 0;
    const netKrw = filled.executed_funds && filled.paid_fee ? parseFloat(filled.executed_funds) - parseFloat(filled.paid_fee) : void 0;
    const costBasis = parseFloat(position.quantity) * position.avgBuyPrice;
    const pnlKrw = netKrw !== void 0 ? netKrw - costBasis : void 0;
    if (actualPrice) {
      const pnlStr = pnlKrw !== void 0 ? ` | \uC190\uC775: ${pnlKrw >= 0 ? "+" : ""}${Math.floor(pnlKrw).toLocaleString()}\uC6D0` : "";
      console.log(`[live-trader]   \uCCB4\uACB0\uAC00: ${actualPrice.toLocaleString()}\uC6D0 | \uC21C\uC218\uB839: ${Math.floor(netKrw ?? 0).toLocaleString()}\uC6D0${pnlStr}`);
    }
    const candleTs = closedCandles[market]?.[closedCandles[market].length - 1]?.timestamp;
    if (candleTs) state.lastSellAt[market] = candleTs;
    delete state.positions[market];
    state.trades.push({ at: (/* @__PURE__ */ new Date()).toISOString(), market, side: "sell", amount: parseFloat(position.quantity), price, actualPrice, netKrw, pnlKrw, dryRun: false, reasonCodes });
    await saveState(state);
  } catch (e) {
    console.error(`[live-trader] \u274C \uB9E4\uB3C4 \uC2E4\uD328 ${market}:`, e);
  } finally {
    orderInProgress.delete(market);
  }
}
async function recordDryTrade(market, side, amount, price, reasonCodes) {
  if (side === "buy") {
    state.positions[market] = {
      market,
      quantity: String((amount / price).toFixed(8)),
      avgBuyPrice: price,
      entryAt: (/* @__PURE__ */ new Date()).toISOString(),
      orderUuid: "dry-run"
    };
  } else {
    const candleTs = closedCandles[market]?.[closedCandles[market].length - 1]?.timestamp;
    if (candleTs) state.lastSellAt[market] = candleTs;
    delete state.positions[market];
  }
  state.trades.push({ at: (/* @__PURE__ */ new Date()).toISOString(), market, side, amount, price, dryRun: true, reasonCodes });
  await saveState(state);
}
setInterval(() => {
  writePublicStatus(state).catch((e) => console.error("[live-trader] \uD558\uD2B8\uBE44\uD2B8 \uC0C1\uD0DC \uC4F0\uAE30 \uC2E4\uD328:", e));
}, 3e4);
setInterval(() => {
  const pos = Object.values(state.positions).map((p) => p.market.replace("KRW-", "")).join(", ") || "\uC5C6\uC74C";
  const trades = state.trades.length;
  console.log(`[live-trader] \uD3EC\uC9C0\uC158: ${pos} | \uB204\uC801 \uAC70\uB798: ${trades}\uD68C | ${DRY_RUN ? "DRY-RUN" : "\uC2E4\uB9E4\uB9E4"}`);
}, 6e4);
function sleep2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
init().catch((e) => {
  console.error("[live-trader] \uCD08\uAE30\uD654 \uC2E4\uD328:", e);
  process.exit(1);
});
