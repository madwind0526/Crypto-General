import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, process.env.MARKET_CACHE_PATH ?? "data/market/upbit-krw-5m.json");
const outputPath = path.join(root, process.env.DASHBOARD_CACHE_PATH ?? "public/market/upbit-krw-5m-dashboard.json");
const candleLimit = Number(process.env.DASHBOARD_CANDLE_LIMIT ?? 9000);

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const candlesByMarket = {};

for (const market of source.selectedMarkets ?? []) {
  const candles = source.candlesByMarket?.[market] ?? [];
  candlesByMarket[market] = candles.slice(Math.max(0, candles.length - candleLimit));
}

const payload = {
  ...source,
  source: `${source.source}:dashboard-slim`,
  generatedAt: new Date().toISOString(),
  dashboardWindowCandles: candleLimit,
  candleCountPerMarket: Math.max(0, ...Object.values(candlesByMarket).map((candles) => candles.length)),
  candlesByMarket,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`Wrote ${path.relative(root, outputPath)}`);
