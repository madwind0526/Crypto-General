import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dailyResultsPath = path.join(root, "public/market/paper-trading-1m-daily-results.json");
const logPath = path.join(root, "simulation-daily-log.md");

const STRATEGY_LABELS = {
  "momentum":   "General-A (Momentum)",
  "range-grid": "General-B (Range-Grid)",
  "arbitrage":  "General-C (Arbitrage)",
  "general-d":  "General-D",
  "general-e":  "General-E",
};
const STRATEGY_ORDER = ["momentum", "range-grid", "arbitrage", "general-d", "general-e"];

const LOG_HEADER = `# 시뮬레이션 일별 결과 로그

> GL-O = Guideline 적용 (strict), GL-X = Guideline 미적용 (ignored)
> SF-O = Safety 적용 (enabled), SF-X = Safety 미적용 (disabled)

---

`;

function formatPct(rate) {
  if (rate == null || isNaN(rate)) return " - ";
  const pct = (rate * 100).toFixed(2);
  return rate >= 0 ? `+${pct}%` : `${pct}%`;
}

function getKstDateStr(ts = Date.now()) {
  return new Date(ts + 9 * 3_600_000).toISOString().slice(0, 10);
}

function formatKst(iso) {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " KST";
}

async function main() {
  let data;
  try {
    data = JSON.parse(await readFile(dailyResultsPath, "utf8"));
  } catch (e) {
    console.error("[save-daily-log] Cannot read daily results:", e.message);
    process.exit(1);
  }

  const date = getKstDateStr();
  const generatedAt = formatKst(data.generatedAt);
  const caseResults = data.caseResults ?? {};

  const rows = STRATEGY_ORDER.map((id) => {
    const label = STRATEGY_LABELS[id] ?? id;
    const c = (gm, sm) => caseResults?.[gm]?.[sm]?.[id]?.returnRate;
    return `| ${label.padEnd(26)} | ${formatPct(c("strict","enabled")).padStart(9)} | ${formatPct(c("strict","disabled")).padStart(9)} | ${formatPct(c("ignored","enabled")).padStart(9)} | ${formatPct(c("ignored","disabled")).padStart(9)} |`;
  }).join("\n");

  const entry = [
    `## ${date} (KST)`,
    ``,
    `> 생성: ${generatedAt}`,
    ``,
    `| 전략                       | GL-O / SF-O | GL-O / SF-X | GL-X / SF-O | GL-X / SF-X |`,
    `|----------------------------|:-----------:|:-----------:|:-----------:|:-----------:|`,
    rows,
    ``,
    `---`,
    ``,
  ].join("\n");

  let existing = existsSync(logPath) ? await readFile(logPath, "utf8") : LOG_HEADER;

  // Replace existing entry for same date, or prepend after header
  const marker = `## ${date}`;
  let updated;
  if (existing.includes(marker)) {
    const start = existing.indexOf(marker);
    const afterMarker = existing.slice(start + marker.length);
    const nextSection = afterMarker.indexOf("\n## ");
    // Always prefix tail with a newline so sections are never merged.
    const tail = nextSection >= 0 ? "\n" + afterMarker.slice(nextSection + 1) : "";
    updated = existing.slice(0, start) + entry + tail;
    console.log(`[save-daily-log] Updated ${date}`);
  } else {
    // LOG_HEADER ends with "\n---\n\n" so indexOf("\n---\n") always matches.
    const insertAt = existing.indexOf("\n---\n");
    if (insertAt >= 0) {
      updated = existing.slice(0, insertAt + 5) + "\n" + entry + existing.slice(insertAt + 5);
    } else {
      updated = existing + "\n" + entry;
    }
    console.log(`[save-daily-log] Appended ${date}`);
  }

  const tmp = `${logPath}.tmp`;
  await writeFile(tmp, updated, "utf8");
  await rename(tmp, logPath);
}

main().catch((e) => {
  console.error("[save-daily-log] Fatal:", e);
  process.exit(1); // non-zero so the parent's non-fatal warning fires
});
