// scripts/live-trader.ts
import "dotenv/config";
import WebSocket from "ws";
import { access, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// scripts/upbitOrder.ts
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
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
    nonce: uuidv4()
  };
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString();
    const hash = crypto.createHash("sha512").update(qs).digest("hex");
    payload = { ...payload, query_hash: hash, query_hash_alg: "SHA512" };
  }
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secretKey).update(`${header}.${body}`).digest("base64url");
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

// src/data/upbitClient.ts
var UPBIT_BASE_URL2 = "https://api.upbit.com";
var DEFAULT_REQUEST_DELAY_MS = 120;
var DEFAULT_MAX_RETRIES = 4;
var lastRequestAt = 0;
async function fetchKrwMarkets() {
  const markets = await fetchUpbitJson("/v1/market/all?isDetails=false");
  return markets.filter((market) => market.market.startsWith("KRW-")).map((market) => ({
    market: market.market,
    koreanName: market.korean_name,
    englishName: market.english_name
  }));
}
async function fetchTickers(markets) {
  if (markets.length === 0) return [];
  const params = new URLSearchParams({ markets: markets.join(",") });
  const tickers = await fetchUpbitJson(`/v1/ticker?${params.toString()}`);
  return tickers.map((ticker) => ({
    market: ticker.market,
    tradePrice: ticker.trade_price,
    accTradePrice24h: ticker.acc_trade_price_24h,
    accTradeVolume24h: ticker.acc_trade_volume_24h,
    signedChangeRate: ticker.signed_change_rate
  }));
}
async function fetchUpbitJson(pathname) {
  let attempt = 0;
  let lastError = null;
  while (attempt <= DEFAULT_MAX_RETRIES) {
    await waitForRateLimit();
    let response;
    try {
      response = await fetch(`${UPBIT_BASE_URL2}${pathname}`, {
        headers: { Accept: "application/json" }
      });
    } catch (error) {
      lastError = error;
      if (attempt === DEFAULT_MAX_RETRIES) break;
      await sleep2(getRetryDelayMs(null, attempt));
      attempt += 1;
      continue;
    }
    if (response.ok) return await response.json();
    const text = await response.text();
    lastError = new Error(`Upbit request failed ${response.status}: ${text}`);
    if (!shouldRetry(response.status) || attempt === DEFAULT_MAX_RETRIES) break;
    await sleep2(getRetryDelayMs(response, attempt));
    attempt += 1;
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < DEFAULT_REQUEST_DELAY_MS) await sleep2(DEFAULT_REQUEST_DELAY_MS - elapsed);
  lastRequestAt = Date.now();
}
function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}
function getRetryDelayMs(response, attempt) {
  const retryAfter = response?.headers.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1e3 : 0;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  return Math.min(8e3, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}
function sleep2(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// src/strategies/averageDropCycle.ts
var averageDropCycleScenario = {
  id: "average-drop-cycle-5m-entry-0.5-stop-2.0-take-0.5",
  traderId: "general-e",
  name: "5m / entry-0.5% / stop-2.0% / take-0.5%",
  description: "Buy a drop from recent average price, then sell by average-based stop or take-profit.",
  params: {
    averageWindowCandles: 5,
    entryDropPct: 5e-3,
    entryRisePct: 0,
    avgStopPct: 0.02,
    avgTakeProfitPct: 5e-3
  }
};
var averageDropCycleScenarios = buildAverageDropCycleScenarios();
var averageDropCycleStrategy = {
  id: "general-e",
  name: "General-E Average Drop Cycle",
  description: "\uCD5C\uADFC \uD3C9\uADE0 \uAC70\uB798\uAC00\uACA9 \uB300\uBE44 \uAE09\uB77D \uAD6C\uAC04\uC5D0\uC11C \uB9E4\uC218\uD558\uACE0, \uBCF4\uC720 \uC911\uC5D0\uB294 \uD3C9\uADE0\uAC00\uACA9 \uAE30\uBC18 \uC190\uC808/\uC775\uC808 \uC870\uAC74\uC73C\uB85C \uBC18\uBCF5 \uB9E4\uB9E4\uD558\uB294 \uC804\uB7B5\uC785\uB2C8\uB2E4.",
  defaultScenario: averageDropCycleScenario,
  scenarios: averageDropCycleScenarios,
  decide(context, scenario = averageDropCycleScenario) {
    const { candles, candleIndex, position } = context;
    const current = candles[candleIndex];
    const averagePrice = getAverageTradePrice(candles, candleIndex, scenario.params.averageWindowCandles);
    if (averagePrice === null || averagePrice <= 0) return hold("warming-up");
    const entryRisePct = scenario.params.entryRisePct ?? 0;
    const entryDropPct = scenario.params.entryDropPct;
    const isRiseMode = entryRisePct > 0;
    if (position) {
      if (isRiseMode) {
        if (current.close <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["rise-stop-loss"], targetWeight: 0 };
        }
        if (current.close >= position.averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["rise-take-profit"], targetWeight: 0 };
        }
      } else {
        if (averagePrice <= position.averagePrice * (1 - scenario.params.avgStopPct)) {
          return { action: "sell", confidence: 0.76, reasonCodes: ["average-below-entry-stop"], targetWeight: 0 };
        }
        if (current.close >= averagePrice * (1 + scenario.params.avgTakeProfitPct)) {
          return { action: "sell", confidence: 0.72, reasonCodes: ["price-above-average-take-profit"], targetWeight: 0 };
        }
      }
      return hold("average-cycle-position-running");
    }
    if (isRiseMode && current.close >= averagePrice * (1 + entryRisePct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryRisePct * 5),
        reasonCodes: ["price-above-average-entry"],
        targetWeight: 0.65
      };
    }
    if (!isRiseMode && entryDropPct > 0 && current.close <= averagePrice * (1 - entryDropPct)) {
      return {
        action: "buy",
        confidence: Math.min(0.9, 0.55 + entryDropPct * 5),
        reasonCodes: ["price-below-average-entry"],
        targetWeight: 0.65
      };
    }
    return hold("waiting-average-signal");
  }
};
function buildAverageDropCycleScenarios() {
  const scenarios = [];
  const averageWindows = [5, 10, 30, 60];
  const entryPcts = [0.01, 0.02, 0.03, 0.04, 0.05];
  const stopPcts = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06];
  const takePcts = [0.01, 0.02, 0.03, 0.04, 0.05];
  for (const averageWindowCandles of averageWindows) {
    for (const entryDropPct of entryPcts) {
      for (const avgStopPct of stopPcts) {
        if (Math.round(avgStopPct * 100) < Math.round(entryDropPct * 100) + 1) continue;
        for (const avgTakeProfitPct of takePcts) {
          const p = (entryDropPct * 100).toFixed(0);
          const s = (avgStopPct * 100).toFixed(0);
          const t = (avgTakeProfitPct * 100).toFixed(0);
          scenarios.push({
            id: `average-drop-cycle-${averageWindowCandles}m-entry-${p}-stop-${s}-take-${t}`,
            traderId: "general-e",
            name: `${averageWindowCandles}m / drop-${p}% / stop-${s}% / take-${t}%`,
            description: "Drop mode: buy when price falls below VWAP.",
            params: {
              averageWindowCandles,
              entryDropPct,
              entryRisePct: 0,
              avgStopPct,
              avgTakeProfitPct
            }
          });
        }
      }
    }
  }
  return scenarios;
}
function getAverageTradePrice(candles, candleIndex, windowCandles) {
  return getAverageTradePrices(candles, windowCandles)[candleIndex] ?? null;
}
var averagePriceCache = /* @__PURE__ */ new WeakMap();
function getAverageTradePrices(candles, windowCandles) {
  let byWindow = averagePriceCache.get(candles);
  if (!byWindow) {
    byWindow = /* @__PURE__ */ new Map();
    averagePriceCache.set(candles, byWindow);
  }
  const window = Math.max(1, windowCandles);
  const key = `${window}:${candles.length}:${candles[candles.length - 1]?.timestamp ?? 0}`;
  const cached = byWindow.get(key);
  if (cached) return cached;
  const averages = [];
  let volumeSum = 0;
  let quoteVolumeSum = 0;
  let closeSum = 0;
  for (let index = 0; index < candles.length; index += 1) {
    if (index < window) {
      averages.push(null);
    } else {
      averages.push(volumeSum > 0 && quoteVolumeSum > 0 ? quoteVolumeSum / volumeSum : closeSum / window);
    }
    const current = candles[index];
    volumeSum += current.volume;
    quoteVolumeSum += current.quoteVolume;
    closeSum += current.close;
    if (index >= window) {
      const removed = candles[index - window];
      volumeSum -= removed.volume;
      quoteVolumeSum -= removed.quoteVolume;
      closeSum -= removed.close;
    }
  }
  byWindow.set(key, averages);
  return averages;
}
function hold(reason) {
  return { action: "hold", confidence: 0, reasonCodes: [reason], targetWeight: 0 };
}

// scripts/live-trader.ts
var ACCESS_KEY = process.env.UPBIT_ACCESS_KEY ?? "";
var SECRET_KEY = process.env.UPBIT_SECRET_KEY ?? "";
var LIVE_ENABLED = process.env.LIVE_TRADING_ENABLED === "true";
var DRY_RUN = process.argv.includes("--dry-run") || !ACCESS_KEY || !SECRET_KEY || !LIVE_ENABLED;
var TOTAL_BUDGET = Number(process.env.LIVE_BUDGET ?? 1e6);
var MAX_COINS = 15;
var BUDGET_PER_COIN = Math.floor(TOTAL_BUDGET / MAX_COINS);
var TARGET_WEIGHT = 0.9;
var ORDER_AMOUNT = Math.floor(BUDGET_PER_COIN * TARGET_WEIGHT);
var MIN_ORDER_KRW = 5500;
var MAX_DAILY_LOSS_KRW = Number(process.env.MAX_DAILY_LOSS_KRW ?? Math.floor(TOTAL_BUDGET * 0.1));
var root = process.cwd();
var statePath = path.join(root, "data", "local", "live-trader-state.json");
var publicStatusPath = path.join(root, "public", "market", "live-trade-status.json");
var lockPath = path.join(root, "data", "local", "live-trader.lock");
var planDir = path.join(root, "data", "local", "traders", "general-e");
var maxCandles = 1440;
var minPrice = Number(process.env.LIVE_MIN_PRICE ?? 100);
var maxPrice = Number(process.env.LIVE_MAX_PRICE ?? 1e4);
var wsUrl = "wss://api.upbit.com/websocket/v1";
var closedCandles = {};
var liveCandle = {};
var lastMinute = {};
var state;
var selectedMarkets = [];
var marketScenario = /* @__PURE__ */ new Map();
var saveChain = Promise.resolve();
var reconcileChain = Promise.resolve();
var orderInProgress = /* @__PURE__ */ new Set();
var emergencyStopPath = path.join(root, "data", "local", "live-trading-disabled.flag");
var freezeAllPath = path.join(root, "data", "local", "live-trading-freeze-all.flag");
var cachedKrwCash = null;
var cachedKrwCashAt = 0;
var cachedPortfolioSnapshot = null;
var krwMarketSetPromise = null;
var statusSequence = 0;
var writerRunId = `${process.pid}-${Date.now()}`;
var lockHandle = null;
var statusPublishingEnabled = false;
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
async function acquireProcessLock() {
  await mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockHandle = await open(lockPath, "wx");
      await lockHandle.writeFile(JSON.stringify({
        pid: process.pid,
        writerRunId,
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        mode: DRY_RUN ? "dry-run" : "live"
      }, null, 2), "utf8");
      console.log(`[live-trader] lock \uD68D\uB4DD: ${lockPath}`);
      return;
    } catch (e) {
      const error = e;
      if (error.code !== "EEXIST") throw e;
      const lock = await readLockFile();
      if (lock?.pid && isProcessAlive(lock.pid)) {
        throw new Error(`live-trader\uAC00 \uC774\uBBF8 \uC2E4\uD589 \uC911\uC785\uB2C8\uB2E4. pid=${lock.pid}, startedAt=${lock.startedAt ?? "unknown"}`);
      }
      console.warn("[live-trader] stale lock \uAC10\uC9C0 \u2014 \uC81C\uAC70 \uD6C4 \uC7AC\uC2DC\uB3C4");
      await unlink(lockPath).catch(() => {
      });
    }
  }
  throw new Error("live-trader lock \uD68D\uB4DD \uC2E4\uD328");
}
async function readLockFile() {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}
function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const error = e;
    return error.code === "EPERM";
  }
}
async function releaseProcessLock() {
  const handle = lockHandle;
  lockHandle = null;
  if (!handle) return;
  try {
    await handle.close();
  } catch {
  }
  try {
    const lock = await readLockFile();
    if (!lock?.pid || lock.pid === process.pid) {
      await unlink(lockPath);
      console.log("[live-trader] lock \uD574\uC81C");
    }
  } catch {
  }
}
async function init() {
  await acquireProcessLock();
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
  selectedMarkets = await filterKnownOutOfRangeMarkets(plan.selectedMarkets.map((m) => m.market));
  for (const item of plan.selectedMarkets) {
    if (!selectedMarkets.includes(item.market)) continue;
    const scenario = averageDropCycleStrategy.scenarios.find((s) => s.id === item.bestResult.scenarioId) ?? averageDropCycleStrategy.defaultScenario;
    marketScenario.set(item.market, scenario);
  }
  console.log(`[live-trader] \uB300\uC0C1 \uCF54\uC778 (${selectedMarkets.length}\uAC1C): ${selectedMarkets.map((m) => m.replace("KRW-", "")).join(", ")}`);
  for (const [market, scenario] of marketScenario) {
    console.log(`[live-trader]   ${market.replace("KRW-", "").padEnd(8)} \u2192 ${scenario.name}`);
  }
  await loadCandleHistory();
  state = await loadState();
  if (!DRY_RUN) {
    await resetLegacyTradeHistory();
    await syncPositionsFromUpbit();
    await reconcilePendingBuys();
    await reconcilePendingSells();
  }
  await resetStartBalanceForRun();
  statusPublishingEnabled = true;
  console.log(`[live-trader] \uCF54\uC778\uB2F9 \uC608\uC0B0: ${BUDGET_PER_COIN.toLocaleString()}\uC6D0 | 1\uD68C \uB9E4\uC218: ${ORDER_AMOUNT.toLocaleString()}\uC6D0`);
  console.log(`[live-trader] \uD604\uC7AC \uD3EC\uC9C0\uC158: ${Object.keys(state.positions).length}\uAC1C`);
  await writePublicStatus(state);
  connect();
}
async function filterKnownOutOfRangeMarkets(markets) {
  const cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    return markets.filter((market) => {
      const candles = cache.candlesByMarket[market] ?? [];
      const lastPrice = candles[candles.length - 1]?.close;
      const keep = lastPrice === void 0 || lastPrice >= minPrice && lastPrice <= maxPrice;
      if (!keep) console.warn(`[live-trader] \uC81C\uC678 ${market}: ${lastPrice}\uC6D0\uC740 ${minPrice}~${maxPrice}\uC6D0 \uBC94\uC704 \uBC16\uC785\uB2C8\uB2E4.`);
      return keep;
    });
  } catch {
    return markets;
  }
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
    const loaded = JSON.parse(await readFile(statePath, "utf8"));
    return {
      ...loaded,
      totalBudget: TOTAL_BUDGET,
      budgetPerCoin: BUDGET_PER_COIN
    };
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
    const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, snapshot, "utf8");
    await rename(tmp, statePath);
    await writePublicStatus(s);
  }));
}
async function resetLegacyTradeHistory() {
  if (state.tradeHistorySnapshotScope === "upbit-total-assets") return;
  const resetAt = (/* @__PURE__ */ new Date()).toISOString();
  if (state.trades.length > 0) {
    const archivePath = path.join(
      root,
      "data",
      "local",
      `live-trader-trade-history-legacy-${resetAt.replace(/[:.]/g, "-")}.json`
    );
    await writeFile(archivePath, JSON.stringify({
      archivedAt: resetAt,
      reason: "portfolioAfter changed to Upbit total-assets valuation",
      trades: state.trades
    }, null, 2), "utf8");
    console.log(`[live-trader] \uC774\uC804 \uAC70\uB798 \uC774\uB825 ${state.trades.length}\uAC74 \uBCF4\uAD00: ${archivePath}`);
  }
  state.trades = [];
  state.tradeHistorySnapshotScope = "upbit-total-assets";
  state.tradeHistoryResetAt = resetAt;
  await saveState(state);
  console.log(`[live-trader] \uAC70\uB798 \uC774\uB825 \uAE30\uC900 \uC7AC\uC124\uC815: ${resetAt}`);
}
async function computeBalance(s) {
  const snapshot = await computePortfolioSnapshot(s);
  return {
    krwCash: snapshot.krwCash,
    invested: snapshot.invested,
    currentValue: snapshot.coinValue,
    totalValue: snapshot.totalValue,
    unrealizedPnl: snapshot.pnl
  };
}
async function computePortfolioSnapshot(s, options = {}) {
  const safe = (v) => Number.isFinite(v) ? v : 0;
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
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const useCache = !forceFresh && !accounts && cachedPortfolioSnapshot !== null && Date.now() - cachedKrwCashAt < 3e4;
  try {
    const freshAccounts = accounts ?? (useCache ? null : await getAccounts(ACCESS_KEY, SECRET_KEY));
    if (!freshAccounts) {
      return {
        ...cachedPortfolioSnapshot,
        at: (/* @__PURE__ */ new Date()).toISOString()
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
    const markets = coinAccounts.map((account) => `KRW-${account.currency}`).filter((market) => krwMarketSet.has(market));
    const tickerByMarket = new Map(
      (markets.length > 0 ? await fetchTickers(markets) : []).map((ticker) => [ticker.market, ticker.tradePrice])
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
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
    return cachedPortfolioSnapshot;
  } catch {
    if (cachedPortfolioSnapshot !== null) {
      return {
        ...cachedPortfolioSnapshot,
        at: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const krwCash = cachedKrwCash ?? Math.max(0, s.totalBudget - localInvested);
    return {
      krwCash,
      invested: localInvested,
      coinValue: localCoinValue,
      totalValue: krwCash + localCoinValue,
      pnl: localCoinValue - localInvested,
      at: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
}
async function getKrwMarketSet() {
  krwMarketSetPromise ??= fetchKrwMarkets().then((markets) => new Set(markets.map((market) => market.market))).catch((error) => {
    krwMarketSetPromise = null;
    throw error;
  });
  return krwMarketSetPromise;
}
function getLatestPrice(market, fallback) {
  return liveCandle[market]?.close ?? closedCandles[market]?.[closedCandles[market].length - 1]?.close ?? fallback;
}
async function resetStartBalanceForRun() {
  if (state.startSnapshotScope === "upbit-total-assets" && state.startBalance !== void 0 && state.startSnapshot) {
    console.log(`[live-trader] \uC2DC\uC791 \uC794\uACE0 \uC720\uC9C0: ${Math.floor(state.startBalance).toLocaleString()}\uC6D0`);
    return;
  }
  const snapshot = await computePortfolioSnapshot(state, { forceFresh: true });
  state.startedAt = snapshot.at;
  state.startBalance = snapshot.totalValue;
  state.startSnapshot = snapshot;
  state.startSnapshotScope = "upbit-total-assets";
  console.log(`[live-trader] \uC2DC\uC791 \uC794\uACE0 \uC7AC\uACC4\uC0B0: ${Math.floor(state.startBalance).toLocaleString()}\uC6D0 (\uD604\uAE08 ${Math.floor(snapshot.krwCash).toLocaleString()}\uC6D0 + \uCF54\uC778 ${Math.floor(snapshot.coinValue).toLocaleString()}\uC6D0)`);
  await saveState(state);
}
async function writePublicStatus(s) {
  if (!statusPublishingEnabled) return;
  const balance = await computeBalance(s);
  const now = (/* @__PURE__ */ new Date()).toISOString();
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
    tradeHistoryResetAt: s.tradeHistoryResetAt
  };
  try {
    await mkdir(path.dirname(publicStatusPath), { recursive: true });
    const tmp = `${publicStatusPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), "utf8");
    await rename(tmp, publicStatusPath);
  } catch (e) {
    console.error("[live-trader] \u26A0\uFE0F \uC0C1\uD0DC \uD30C\uC77C \uC4F0\uAE30 \uC2E4\uD328:", e);
  }
}
async function syncPositionsFromUpbit() {
  try {
    const accounts = await getAccounts(ACCESS_KEY, SECRET_KEY);
    const syncedPositions = {};
    const marketsToSync = /* @__PURE__ */ new Set([...selectedMarkets, ...Object.keys(state.positions)]);
    for (const market of marketsToSync) {
      const currency = market.replace("KRW-", "");
      const account = accounts.find((a) => a.currency === currency);
      if (account && parseFloat(account.balance) > 0) {
        const existing = state.positions[market];
        syncedPositions[market] = existing ? {
          ...existing,
          quantity: account.balance,
          avgBuyPrice: parseFloat(account.avg_buy_price)
        } : {
          market,
          quantity: account.balance,
          avgBuyPrice: parseFloat(account.avg_buy_price),
          entryAt: (/* @__PURE__ */ new Date()).toISOString(),
          orderUuid: "synced-from-upbit"
        };
        if (!existing) {
          console.log(`[live-trader] \uD3EC\uC9C0\uC158 \uB3D9\uAE30\uD654: ${market} ${account.balance}\uAC1C @ ${account.avg_buy_price}\uC6D0`);
        }
      }
    }
    state.positions = syncedPositions;
    await saveState(state);
  } catch (e) {
    console.error("[live-trader] \uC794\uACE0 \uB3D9\uAE30\uD654 \uC2E4\uD328:", e);
    throw e;
  }
}
async function reconcilePendingBuys() {
  const pending = state.pendingBuys;
  if (!pending || Object.keys(pending).length === 0) return;
  console.log(`[live-trader] \uBBF8\uC644\uB8CC \uB9E4\uC218 \uC8FC\uBB38 \uC815\uC0B0 (${Object.keys(pending).length}\uAC74)...`);
  for (const [uuid, pb] of Object.entries(pending)) {
    try {
      let order = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
      if (order.state === "wait" || order.state === "watch") {
        try {
          await cancelOrder(ACCESS_KEY, SECRET_KEY, uuid);
          console.log(`[live-trader] \u{1F5D1}\uFE0F \uBBF8\uCCB4\uACB0 \uB9E4\uC218 \uCDE8\uC18C: ${uuid} (${pb.market})`);
        } catch (cancelErr) {
          console.error(`[live-trader] \uBBF8\uCCB4\uACB0 \uB9E4\uC218 \uCDE8\uC18C \uC2E4\uD328 (${uuid}):`, cancelErr);
          continue;
        }
        try {
          order = await getOrder(ACCESS_KEY, SECRET_KEY, uuid);
        } catch (reQueryErr) {
          console.error(`[live-trader] \uCDE8\uC18C \uD6C4 \uC7AC\uC870\uD68C \uC2E4\uD328 (${uuid}):`, reQueryErr);
          continue;
        }
      }
      const executedVolume = parseFloat(order.executed_volume ?? "0");
      if (executedVolume > 0) {
        await recordBuyFill(pb, order);
      }
      if (order.state === "wait" || order.state === "watch") {
        console.log(`[live-trader] \uB9E4\uC218 \uC5EC\uC804\uD788 \uBBF8\uCCB4\uACB0: ${uuid} (${pb.market}, state=${order.state})`);
        continue;
      }
      if (executedVolume <= 0) {
        console.log(`[live-trader] \uB9E4\uC218 \uCCB4\uACB0 \uC5C6\uC74C: ${uuid} (${pb.market}, state=${order.state})`);
      } else {
        console.log(`[live-trader] \u2705 \uD39C\uB529 \uB9E4\uC218 \uC815\uC0B0 \uC644\uB8CC: ${pb.market} ${executedVolume}\uAC1C`);
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
      const executedVolume = parseFloat(filled.executed_volume ?? "0");
      if (executedVolume > 0) {
        await recordSellFill(ps, filled);
      }
      if (filled.state === "done") {
        console.log(`[live-trader] \u2705 \uD39C\uB529 \uB9E4\uB3C4 \uC644\uB8CC \uC815\uC0B0: ${ps.market}`);
        delete pending[uuid];
      } else if (filled.state === "wait" || filled.state === "watch") {
        console.log(`[live-trader] \uB9E4\uB3C4 \uC5EC\uC804\uD788 \uBBF8\uCCB4\uACB0: ${uuid} (${ps.market}, state=${filled.state})`);
      } else {
        console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uB3C4 \uCDE8\uC18C\uB428: ${uuid} (${ps.market}, \uCCB4\uACB0 ${executedVolume}\uAC1C)`);
        delete pending[uuid];
      }
    } catch (e) {
      console.error(`[live-trader] \uD39C\uB529 \uB9E4\uB3C4 \uC870\uD68C \uC2E4\uD328 (${uuid}):`, e);
    }
  }
  await saveState(state);
}
async function recordBuyFill(pb, order) {
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
    console.warn(`[live-trader] \uD39C\uB529 \uB9E4\uC218 ${pb.market} \uCCB4\uACB0\uB7C9\uC740 \uAE30\uC874 \uD3EC\uC9C0\uC158\uC5D0 \uC774\uBBF8 \uBC18\uC601\uB41C \uAC83\uC73C\uB85C \uAC04\uC8FC\uD569\uB2C8\uB2E4.`);
    pb.recordedVolume = String(executedVolume);
    return;
  }
  if (existingPosition) {
    const currentQty = parseFloat(existingPosition.quantity);
    const nextQty = currentQty + deltaVolume;
    existingPosition.avgBuyPrice = nextQty > 0 ? (currentQty * existingPosition.avgBuyPrice + deltaFunds) / nextQty : actualPrice;
    existingPosition.quantity = String(nextQty);
  } else {
    state.positions[pb.market] = {
      market: pb.market,
      quantity: String(deltaVolume),
      avgBuyPrice: actualPrice,
      entryAt: pb.at,
      orderUuid: pb.uuid
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
    reasonCodes: pb.reasonCodes
  });
  pb.recordedVolume = String(executedVolume);
}
async function recordSellFill(ps, order) {
  const executedVolume = parseFloat(order.executed_volume ?? "0");
  const alreadyRecorded = parseFloat(ps.recordedVolume ?? "0");
  const deltaVolume = executedVolume - alreadyRecorded;
  if (deltaVolume <= 0) return;
  const actualPrice = order.avg_price ? parseFloat(order.avg_price) : void 0;
  const executedFunds = order.executed_funds ? parseFloat(order.executed_funds) : void 0;
  const paidFee = order.paid_fee ? parseFloat(order.paid_fee) : 0;
  const previousRatio = alreadyRecorded / Math.max(parseFloat(ps.quantity), 1e-12);
  const currentRatio = executedVolume / Math.max(parseFloat(ps.quantity), 1e-12);
  const netKrw = executedFunds !== void 0 ? Math.max(0, executedFunds * (currentRatio - previousRatio) / Math.max(currentRatio, 1e-12) - paidFee * (currentRatio - previousRatio) / Math.max(currentRatio, 1e-12)) : void 0;
  const costBasis = ps.costBasis * (deltaVolume / Math.max(parseFloat(ps.quantity), 1e-12));
  const pnlKrw = netKrw !== void 0 ? netKrw - costBasis : void 0;
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
    reasonCodes: ps.reasonCodes
  });
  ps.recordedVolume = String(executedVolume);
}
function hasPendingOrders() {
  return Boolean(
    state.pendingBuys && Object.keys(state.pendingBuys).length > 0 || state.pendingSells && Object.keys(state.pendingSells).length > 0
  );
}
function queuePendingReconcile(reason) {
  if (DRY_RUN || !state || !hasPendingOrders()) return;
  reconcileChain = reconcileChain.catch(() => {
  }).then(async () => {
    console.log(`[live-trader] pending \uC8FC\uBB38 \uC7AC\uC815\uC0B0 (${reason})`);
    await reconcilePendingBuys();
    await reconcilePendingSells();
  });
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
  const decision = averageDropCycleStrategy.decide(context, scenario);
  if (decision.action === "buy" && !position) {
    await executeBuy(market, candles[candleIndex].close, decision.reasonCodes);
  } else if (decision.action === "sell" && position) {
    await executeSell(market, position, candles[candleIndex].close, decision.reasonCodes);
  }
}
function getScenarioForMarket(market) {
  return marketScenario.get(market) ?? averageDropCycleStrategy.defaultScenario;
}
async function executeBuy(market, price, reasonCodes) {
  if (orderInProgress.has(market)) return;
  if (state.pendingBuys && Object.values(state.pendingBuys).some((pb) => pb.market === market)) {
    console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uC218 \uC2A4\uD0B5 \u2014 \uBBF8\uC644\uB8CC \uB9E4\uC218 \uC8FC\uBB38\uC774 \uC788\uC74C: ${market}`);
    return;
  }
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
    const pendingBuyCount = state.pendingBuys ? Object.keys(state.pendingBuys).length : 0;
    if (openCount + pendingBuyCount >= MAX_COINS) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 \uCD5C\uB300 \uD3EC\uC9C0\uC158 \uC218 \uB3C4\uB2EC (${openCount}+pending ${pendingBuyCount}/${MAX_COINS})`);
      return;
    }
    const totalInvested = Object.values(state.positions).reduce(
      (sum, p) => sum + parseFloat(p.quantity) * p.avgBuyPrice,
      0
    );
    const pendingBuyAmount = Object.values(state.pendingBuys ?? {}).reduce((sum, p) => sum + p.amount, 0);
    if (totalInvested + pendingBuyAmount + ORDER_AMOUNT > TOTAL_BUDGET) {
      console.log(`[live-trader] \uC2A4\uD0B5 \u2014 \uC608\uC0B0 \uCD08\uACFC (\uD22C\uC790 ${Math.floor(totalInvested).toLocaleString()}\uC6D0 + pending ${pendingBuyAmount.toLocaleString()}\uC6D0 + ${ORDER_AMOUNT.toLocaleString()}\uC6D0 > \uC608\uC0B0 ${TOTAL_BUDGET.toLocaleString()}\uC6D0)`);
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
    await sleep3(2e3);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep3(2e3);
      filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    }
    if (filled.state !== "done") {
      console.warn(`[live-trader] \u26A0\uFE0F \uB9E4\uC218 \uCCB4\uACB0 \uBBF8\uC644\uB8CC (uuid=${order.uuid}, state=${filled.state}, vol=${filled.executed_volume}) \u2014 \uD39C\uB529\uC73C\uB85C \uAE30\uB85D`);
      state.pendingBuys = state.pendingBuys ?? {};
      state.pendingBuys[order.uuid] = { uuid: order.uuid, market, amount: ORDER_AMOUNT, price, reasonCodes, at: (/* @__PURE__ */ new Date()).toISOString() };
      await saveState(state);
      setTimeout(() => queuePendingReconcile("new-pending-buy"), 1e4);
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
    state.trades.push({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      market,
      side: "buy",
      amount: ORDER_AMOUNT,
      price,
      actualPrice,
      netKrw,
      portfolioAfter: await computePortfolioSnapshot(state, { forceFresh: true }),
      portfolioSnapshotScope: "upbit-total-assets",
      dryRun: false,
      reasonCodes
    });
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
    await sleep3(2e3);
    let filled = await getOrder(ACCESS_KEY, SECRET_KEY, order.uuid);
    if (filled.state !== "done") {
      await sleep3(2e3);
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
      setTimeout(() => queuePendingReconcile("new-pending-sell"), 1e4);
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
    state.trades.push({
      at: (/* @__PURE__ */ new Date()).toISOString(),
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
      reasonCodes
    });
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
  state.trades.push({
    at: (/* @__PURE__ */ new Date()).toISOString(),
    market,
    side,
    amount,
    price,
    portfolioAfter: await computePortfolioSnapshot(state),
    dryRun: true,
    reasonCodes
  });
  await saveState(state);
}
setInterval(() => {
  queuePendingReconcile("interval");
}, 15e3);
setInterval(() => {
  if (!state) return;
  writePublicStatus(state).catch((e) => console.error("[live-trader] \uD558\uD2B8\uBE44\uD2B8 \uC0C1\uD0DC \uC4F0\uAE30 \uC2E4\uD328:", e));
}, 3e4);
setInterval(() => {
  if (!state) return;
  const pos = Object.values(state.positions).map((p) => p.market.replace("KRW-", "")).join(", ") || "\uC5C6\uC74C";
  const trades = state.trades.length;
  console.log(`[live-trader] \uD3EC\uC9C0\uC158: ${pos} | \uB204\uC801 \uAC70\uB798: ${trades}\uD68C | ${DRY_RUN ? "DRY-RUN" : "\uC2E4\uB9E4\uB9E4"}`);
}, 6e4);
function sleep3(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function shutdown(code) {
  if (activeWs) {
    try {
      activeWs.close();
    } catch {
    }
  }
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  await releaseProcessLock();
  process.exit(code);
}
process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
init().catch(async (e) => {
  console.error("[live-trader] \uCD08\uAE30\uD654 \uC2E4\uD328:", e);
  await releaseProcessLock();
  process.exit(1);
});
