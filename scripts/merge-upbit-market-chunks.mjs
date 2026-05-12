import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const unit = Number(process.env.UPBIT_CANDLE_UNIT ?? 5);
const chunkDays = Number(process.env.UPBIT_CHUNK_DAYS ?? 30);
const chunkCount = Number(process.env.UPBIT_CHUNK_COUNT ?? 3);
const outputLabel = process.env.UPBIT_MERGE_OUTPUT_LABEL ?? `upbit-krw-${unit}m`;
const prettyJson = process.env.UPBIT_PRETTY_JSON !== "false";
const writePublic = process.env.UPBIT_WRITE_PUBLIC !== "false";
const chunkFiles = getChunkFiles();

const chunks = [];
for (const filePath of chunkFiles) {
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  chunks.push(payload);
}

const selectedMarkets = chunks[0]?.selectedMarkets ?? unique(chunks.flatMap((chunk) => chunk.selectedMarkets ?? []));
const candlesByMarket = {};
for (const market of selectedMarkets) {
  const byTimestamp = new Map();
  for (const chunk of chunks) {
    for (const candle of chunk.candlesByMarket?.[market] ?? []) {
      byTimestamp.set(candle.timestamp, candle);
    }
  }
  candlesByMarket[market] = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

const payload = {
  source: "upbit-public-api",
  generatedAt: new Date().toISOString(),
  mergedFrom: chunkFiles.map((filePath) => path.relative(root, filePath)),
  marketCount: selectedMarkets.length,
  candleUnitMinutes: unit,
  lookbackDays: chunkDays * chunkCount,
  candleCountPerMarket: Math.max(0, ...Object.values(candlesByMarket).map((candles) => candles.length)),
  selectedMarkets,
  candlesByMarket,
};

const dataPath = path.join(root, "data", "market", `${outputLabel}.json`);
await writeJson(dataPath, payload, prettyJson);
console.log(`Wrote ${path.relative(root, dataPath)}`);

if (writePublic) {
  const publicPath = path.join(root, "public", "market", `${outputLabel}.json`);
  await writeJson(publicPath, payload, false);
  console.log(`Wrote ${path.relative(root, publicPath)}`);
}

function getChunkFiles() {
  const explicit = process.env.UPBIT_CHUNK_FILES;
  if (explicit) {
    return explicit.split(",").map((filePath) => path.resolve(root, filePath.trim()));
  }

  return Array.from({ length: chunkCount }, (_, index) => {
    const startDaysAgo = (index + 1) * chunkDays;
    const endDaysAgo = index * chunkDays;
    return path.join(root, "data", "market", `upbit-krw-${unit}m-top30-${startDaysAgo}-${endDaysAgo}d.json`);
  });
}

function unique(values) {
  return [...new Set(values)];
}

async function writeJson(filePath, value, pretty) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}
