import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const UPBIT_BASE_URL = "https://api.upbit.com";
const root = process.cwd();
const strategyIds = ["momentum", "range-grid", "arbitrage", "general-d", "general-e", "general-sum"];
const guideModes = ["strict", "ignored"];
const cachePath = path.join(root, "data", "market", "upbit-krw-1m-daily.json");
const publicCachePath = path.join(root, "public", "market", "upbit-krw-1m-daily.json");
const statusPath = path.join(root, "data", "local", "paper-trading-1m-daily", "marathon-status.json");
const pidPath = path.join(root, "data", "local", "paper-trading-1m-daily", "marathon.pid");
const durationMs = Number(process.env.MARATHON_DURATION_HOURS ?? 24) * 60 * 60 * 1000;
const intervalMs = Number(process.env.MARATHON_INTERVAL_MINUTES ?? 1) * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const retentionTiers = [
  { label: "1m/6h", bucketMs: 60_000, fromAgeMs: 0, toAgeMs: Number(process.env.MARATHON_KEEP_1M_HOURS ?? 6) * hourMs },
  {
    label: "5m/1d",
    bucketMs: 5 * 60_000,
    fromAgeMs: Number(process.env.MARATHON_KEEP_1M_HOURS ?? 6) * hourMs,
    toAgeMs: Number(process.env.MARATHON_KEEP_5M_HOURS ?? 24) * hourMs,
  },
  {
    label: "30m/1w",
    bucketMs: 30 * 60_000,
    fromAgeMs: Number(process.env.MARATHON_KEEP_5M_HOURS ?? 24) * hourMs,
    toAgeMs: Number(process.env.MARATHON_KEEP_30M_DAYS ?? 7) * dayMs,
  },
  {
    label: "1h/1mo",
    bucketMs: 60 * 60_000,
    fromAgeMs: Number(process.env.MARATHON_KEEP_30M_DAYS ?? 7) * dayMs,
    toAgeMs: Number(process.env.MARATHON_KEEP_1H_DAYS ?? 30) * dayMs,
  },
];
const retainMs = Math.max(...retentionTiers.map((tier) => tier.toAgeMs));
const requestDelayMs = Number(process.env.UPBIT_REQUEST_DELAY_MS ?? 120);
const maxRetries = Number(process.env.UPBIT_MAX_RETRIES ?? 4);
const fetchTimeoutMs = Number(process.env.UPBIT_FETCH_TIMEOUT_MS ?? 15_000);
const childTimeoutMs = Number(process.env.MARATHON_CHILD_TIMEOUT_MINUTES ?? 30) * 60 * 1000;
const candleFetchCount = Number(process.env.MARATHON_FETCH_CANDLES ?? 20);
const paperMaxCandles = Number(process.env.PAPER_MAX_CANDLES ?? process.env.MARATHON_PAPER_MAX_CANDLES ?? 2000);
const once = process.argv.includes("--once") || process.env.MARATHON_ONCE === "true";
const resetCache = process.env.MARATHON_RESET_CACHE === "true";
const forcedStartAt = parseStartAt(process.env.MARATHON_START_AT_KST ?? process.env.MARATHON_START_AT);
const dailyRollover = process.env.MARATHON_DAILY_ROLLOVER !== "false";

let selectedMarkets = await loadSelectedMarkets();
if (selectedMarkets.length === 0) {
  throw new Error("No selected markets found. Run persist:traders first or set UPBIT_MARKETS.");
}

console.log(
  `Starting day-trading marathon: ${selectedMarkets.length} markets, ${once ? "single cycle" : `${durationMs / 3_600_000}h`}`,
);
console.log(`Retention: ${retentionTiers.map((tier) => tier.label).join(", ")}`);
console.log(`Timeouts: Upbit fetch ${fetchTimeoutMs}ms, child command ${childTimeoutMs / 60_000}m`);

const startedAt = Date.now();
let effectiveStartAt = forcedStartAt ?? startedAt;
let lastRolloverDayStart = getKstDayStart(effectiveStartAt);
let cycle = 0;
let shuttingDown = false;

await writeJson(pidPath, { pid: process.pid, startedAt: new Date(startedAt).toISOString() }, true);
await writeStatus({
  cycle,
  cachePath: path.relative(root, cachePath),
  lastCycleAt: new Date().toISOString(),
  marketCount: selectedMarkets.length,
  running: !once,
  startedAt: new Date(effectiveStartAt).toISOString(),
});

process.on("SIGINT", () => {
  shutdown("SIGINT", 130).catch((error) => {
    console.error(error);
    process.exit(130);
  });
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 143).catch((error) => {
    console.error(error);
    process.exit(143);
  });
});
process.on("uncaughtException", (error) => {
  console.error(error);
  shutdown("uncaughtException", 1, error).catch(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  console.error(reason);
  shutdown("unhandledRejection", 1, reason).catch(() => process.exit(1));
});

do {
  if (shuttingDown) break;
  cycle += 1;
  const cycleStartedAt = Date.now();

  try {
    await maybeRunDailyRollover();
    await runCycle(cycle);
  } catch (error) {
    console.error(error);
    await writeStatus({
      cycle,
      error: error instanceof Error ? error.message : String(error),
      lastCycleAt: new Date().toISOString(),
      running: !once,
      startedAt: new Date(effectiveStartAt).toISOString(),
    });
  }

  if (once) break;

  const elapsed = Date.now() - cycleStartedAt;
  await sleep(Math.max(5_000, intervalMs - elapsed));
} while (Date.now() - startedAt < durationMs);

await writeStatus({
  cycle,
  completedAt: new Date().toISOString(),
  running: false,
  startedAt: new Date(effectiveStartAt).toISOString(),
});

async function shutdown(reason, exitCode, error) {
  if (shuttingDown) return;
  shuttingDown = true;
  await writeStatus({
    cycle,
    cachePath: path.relative(root, cachePath),
    stoppedAt: new Date().toISOString(),
    running: false,
    reason,
    error: error instanceof Error ? error.message : error ? String(error) : undefined,
    startedAt: new Date(effectiveStartAt).toISOString(),
  });
  process.exit(exitCode);
}

async function runCycle(cycleNumber) {
  console.log(`[cycle ${cycleNumber}] fetching latest 1m candles`);
  const previous = await readCache();
  const nextCandlesByMarket = { ...(previous?.candlesByMarket ?? {}) };

  for (const market of selectedMarkets) {
    await sleep(requestDelayMs);
    const latest = await fetchLatestOneMinuteCandles(market);
    const merged = mergeCandles(nextCandlesByMarket[market] ?? [], latest);
    nextCandlesByMarket[market] = applyRetention(merged, Date.now());
    console.log(`[cycle ${cycleNumber}] ${market}: ${nextCandlesByMarket[market].length} candles`);
  }
  const activeCandlesByMarket = Object.fromEntries(
    selectedMarkets.map((market) => [market, nextCandlesByMarket[market] ?? []]),
  );

  const payload = {
    source: "upbit-public-api",
    generatedAt: new Date().toISOString(),
    marketCount: selectedMarkets.length,
    candleUnitMinutes: 1,
    retentionPolicy: {
      operationStartAt: new Date(effectiveStartAt).toISOString(),
      resetFrom: resetCache ? new Date(effectiveStartAt).toISOString() : previous?.retentionPolicy?.resetFrom,
      tiers: retentionTiers.map((tier) => ({
        label: tier.label,
        bucketMinutes: tier.bucketMs / 60_000,
        fromAgeHours: tier.fromAgeMs / hourMs,
        toAgeHours: tier.toAgeMs / hourMs,
      })),
      retainDays: retainMs / dayMs,
    },
    selectedMarkets,
    candlesByMarket: activeCandlesByMarket,
  };

  await writeJson(cachePath, payload, true);
  try {
    await writeJson(publicCachePath, payload, false);
  } catch (err) {
    if (err.code !== "EPERM" && err.code !== "EBUSY") throw err;
    // Atomic rename blocked (Vite file watcher lock) — fall back to direct write
    try {
      await mkdir(path.dirname(publicCachePath), { recursive: true });
      await writeFile(publicCachePath, `${JSON.stringify(payload)}\n`, "utf8");
    } catch {
      console.warn(`[cycle ${cycleNumber}] skipped public cache write (${err.code})`);
    }
  }
  console.log(`[cycle ${cycleNumber}] wrote retained cache`);

  await runPaperSimulation();
  await writeStatus({
    cycle: cycleNumber,
    cachePath: path.relative(root, cachePath),
    lastCycleAt: new Date().toISOString(),
    marketCount: selectedMarkets.length,
    running: !once,
    startedAt: new Date(effectiveStartAt).toISOString(),
  });
}

function parseStartAt(value) {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}+09:00`;
  const timestamp = Date.parse(withZone);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid MARATHON_START_AT value: ${value}`);
  }
  return timestamp;
}

function getKstDayStart(timestamp) {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const shifted = new Date(timestamp + kstOffsetMs);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - kstOffsetMs;
}

async function loadSelectedMarkets() {
  const explicit = (process.env.UPBIT_MARKETS ?? "")
    .split(",")
    .map((market) => market.trim())
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)].sort();

  const markets = new Set();
  for (const strategyId of strategyIds) {
    for (const guideMode of guideModes) {
      const selectedPath = path.join(root, "data", "local", "traders", strategyId, `selected-symbols.${guideMode}.json`);
      try {
        const payload = JSON.parse(await readFile(selectedPath, "utf8"));
        for (const item of payload.selectedMarkets ?? []) {
          if (item.market) markets.add(item.market);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  return [...markets].sort();
}

async function readCache() {
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("[cache] readCache failed:", error.message);
    return null;
  }
}

async function fetchLatestOneMinuteCandles(market) {
  const params = new URLSearchParams({ market, count: String(candleFetchCount) });
  const candles = await fetchJson(`/v1/candles/minutes/1?${params.toString()}`);
  return candles
    .map((candle) => ({
      market: candle.market,
      timestamp: candle.timestamp,
      open: candle.opening_price,
      high: candle.high_price,
      low: candle.low_price,
      close: candle.trade_price,
      volume: candle.candle_acc_trade_volume,
      quoteVolume: candle.candle_acc_trade_price,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function mergeCandles(existing, incoming) {
  const byTimestamp = new Map();
  for (const candle of existing) byTimestamp.set(candle.timestamp, candle);
  for (const candle of incoming) byTimestamp.set(candle.timestamp, candle);
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function applyRetention(candles, now) {
  const retained = [];

  for (const tier of retentionTiers) {
    const tierStart = now - tier.toAgeMs;
    const tierEnd = now - tier.fromAgeMs;
    const tierCandles = candles.filter((candle) => candle.timestamp >= tierStart && candle.timestamp < tierEnd);
    retained.push(...aggregateCandles(tierCandles, tier.bucketMs));
  }

  return mergeCandles([], retained);
}

function aggregateCandles(candles, bucketMs) {
  const buckets = new Map();
  for (const candle of candles) {
    const bucketTimestamp = Math.floor(candle.timestamp / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketTimestamp);
    if (!bucket) {
      buckets.set(bucketTimestamp, {
        market: candle.market,
        timestamp: bucketTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        quoteVolume: candle.quoteVolume,
      });
      continue;
    }

    bucket.high = Math.max(bucket.high, candle.high);
    bucket.low = Math.min(bucket.low, candle.low);
    bucket.close = candle.close;
    bucket.volume += candle.volume;
    bucket.quoteVolume += candle.quoteVolume;
  }

  return [...buckets.values()].sort((a, b) => a.timestamp - b.timestamp);
}

async function runPaperSimulation() {
  await runCommand(process.execPath, [path.join(root, "scripts", "paper-trading-1m-daily.mjs")], {
    MARKET_CACHE_PATH: path.relative(root, cachePath),
    PAPER_MAX_CANDLES: String(paperMaxCandles),
    PAPER_START_AT: new Date(effectiveStartAt).toISOString(),
  });
}

async function maybeRunDailyRollover() {
  if (!dailyRollover || once) return;

  const currentDayStart = getKstDayStart(Date.now());
  if (currentDayStart <= lastRolloverDayStart) return;

  console.log("[rollover] KST day changed. Saving daily simulation log...");
  try {
    await runCommand(process.execPath, [path.join(root, "scripts", "save-daily-log.mjs")]);
  } catch (e) {
    console.warn("[rollover] save-daily-log failed (non-fatal):", e.message);
  }

  console.log("[rollover] Re-optimizing plans with previous 24h data.");
  await runCommand(process.execPath, [path.join(root, "scripts", "daily-rollover.mjs")], {
    ROLLOVER_AT: new Date(currentDayStart).toISOString(),
  });

  selectedMarkets = await loadSelectedMarkets();
  if (selectedMarkets.length === 0) {
    throw new Error("Daily rollover produced no selected markets.");
  }

  effectiveStartAt = currentDayStart;
  lastRolloverDayStart = currentDayStart;
  console.log(`[rollover] Restarted daily monitoring at ${new Date(effectiveStartAt).toISOString()}.`);
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
      reject(new Error(`${command} ${args.join(" ")} timed out after ${childTimeoutMs / 60_000} minutes`));
    }, childTimeoutMs);

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    child.on("exit", (code) => finish(() => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    }));
    child.on("error", (error) => finish(() => reject(error)));
  });
}

async function fetchJson(pathname) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      response = await fetch(`${UPBIT_BASE_URL}${pathname}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      lastError =
        error?.name === "AbortError"
          ? new Error(`Upbit request timed out after ${fetchTimeoutMs}ms: ${pathname}`)
          : error;
      if (attempt === maxRetries) break;
      await sleep(getRetryDelayMs(null, attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) return response.json();

    const text = await response.text();
    lastError = new Error(`Upbit request failed ${response.status}: ${text}`);
    if (!shouldRetry(response.status) || attempt === maxRetries) break;

    await sleep(getRetryDelayMs(response, attempt));
  }

  throw lastError;
}

function shouldRetry(status) {
  return status === 408 || status === 429 || status >= 500;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get("retry-after");
  const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : 0;
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs;
  return Math.min(8_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function writeJson(filePath, payload, pretty) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`, "utf8");
  await rename(tmp, filePath);
}

async function writeStatus(status) {
  await writeJson(statusPath, status, true);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
