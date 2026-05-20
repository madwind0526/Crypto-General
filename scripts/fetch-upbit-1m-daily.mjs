import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const strategyIds = ["momentum", "range-grid", "arbitrage", "general-d", "general-e"];
const guideModes = ["strict", "ignored"];
const selectedMarkets = new Set();

if (!process.env.UPBIT_MARKETS) {
  for (const strategyId of strategyIds) {
    for (const guideMode of guideModes) {
      const selectedPath = path.join(root, "data", "local", "traders", strategyId, `selected-symbols.${guideMode}.json`);
      try {
        const payload = JSON.parse(await readFile(selectedPath, "utf8"));
        for (const item of payload.selectedMarkets ?? []) {
          if (item.market) selectedMarkets.add(item.market);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }

  process.env.UPBIT_MARKETS = [...selectedMarkets].join(",");
}

const marketCount = process.env.UPBIT_MARKETS.split(",").filter(Boolean).length;
if (marketCount === 0) {
  throw new Error("No selected markets found for 1m daily fetch. Run persist:traders first or set UPBIT_MARKETS.");
}

process.env.UPBIT_MARKET_COUNT = process.env.UPBIT_MARKET_COUNT ?? String(marketCount);
process.env.UPBIT_CANDLE_UNIT = process.env.UPBIT_CANDLE_UNIT ?? "1";
process.env.UPBIT_LOOKBACK_DAYS = process.env.UPBIT_LOOKBACK_DAYS ?? "1";
process.env.UPBIT_REQUEST_DELAY_MS = process.env.UPBIT_REQUEST_DELAY_MS ?? "100";
process.env.UPBIT_PRETTY_JSON = process.env.UPBIT_PRETTY_JSON ?? "false";
process.env.UPBIT_WRITE_PUBLIC = process.env.UPBIT_WRITE_PUBLIC ?? "true";
process.env.UPBIT_CACHE_LABEL = process.env.UPBIT_CACHE_LABEL ?? "upbit-krw-1m-daily";

console.log(`Fetching 1m daily candles for ${marketCount} selected markets`);
await import("./fetch-upbit-market-data.mjs");
