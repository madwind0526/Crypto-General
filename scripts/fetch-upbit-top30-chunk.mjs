import { readFile } from "node:fs/promises";
import path from "node:path";

const chunkIndex = Number(process.argv[2] ?? process.env.UPBIT_CHUNK_INDEX ?? 0);
const chunkDays = Number(process.env.UPBIT_CHUNK_DAYS ?? 30);
const startDaysAgo = (chunkIndex + 1) * chunkDays;
const endDaysAgo = chunkIndex * chunkDays;

process.env.UPBIT_MARKET_COUNT = process.env.UPBIT_MARKET_COUNT ?? "30";
process.env.UPBIT_CANDLE_UNIT = process.env.UPBIT_CANDLE_UNIT ?? "5";
process.env.UPBIT_REQUEST_DELAY_MS = process.env.UPBIT_REQUEST_DELAY_MS ?? "90";
process.env.UPBIT_PRETTY_JSON = process.env.UPBIT_PRETTY_JSON ?? "false";
process.env.UPBIT_WRITE_PUBLIC = process.env.UPBIT_WRITE_PUBLIC ?? "false";
process.env.UPBIT_WINDOW_START_DAYS_AGO = String(startDaysAgo);
process.env.UPBIT_WINDOW_END_DAYS_AGO = String(endDaysAgo);
process.env.UPBIT_CACHE_LABEL = `upbit-krw-${process.env.UPBIT_CANDLE_UNIT}m-top30-${startDaysAgo}-${endDaysAgo}d`;

if (chunkIndex > 0 && !process.env.UPBIT_MARKETS) {
  const firstChunkPath = path.join(
    process.cwd(),
    "data",
    "market",
    `upbit-krw-${process.env.UPBIT_CANDLE_UNIT}m-top30-${chunkDays}-0d.json`,
  );
  const firstChunk = JSON.parse(await readFile(firstChunkPath, "utf8"));
  process.env.UPBIT_MARKETS = firstChunk.selectedMarkets.join(",");
}

await import("./fetch-upbit-market-data.mjs");
