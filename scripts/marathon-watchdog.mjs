import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stateDir = path.join(root, "data", "local", "paper-trading-1m-daily");
const paperPath = path.join(root, "public", "market", "paper-trading-1m-daily-results.json");
const statusPath = path.join(stateDir, "marathon-status.json");
const watchdogPidPath = path.join(stateDir, "marathon-watchdog.pid");
const watchdogStatusPath = path.join(stateDir, "marathon-watchdog-status.json");
const marathonScript = path.join(root, "scripts", "day-trading-marathon.mjs");

const durationMs = Number(process.env.MARATHON_DURATION_HOURS ?? 24) * 60 * 60 * 1000;
const restartDelayMs = Number(process.env.MARATHON_RESTART_DELAY_SECONDS ?? 15) * 1000;
const staleMs = Number(process.env.MARATHON_STALE_MINUTES ?? 10) * 60 * 1000;
const checkMs = Number(process.env.MARATHON_WATCHDOG_CHECK_SECONDS ?? 60) * 1000;
const continuous = process.env.MARATHON_WATCHDOG_CONTINUOUS !== "false";

await mkdir(stateDir, { recursive: true });
const startedAt = Date.now();
let child = null;
let stopping = false;
let restartCount = 0;
let runCount = 0;

await writeJson(watchdogPidPath, { pid: process.pid, startedAt: new Date(startedAt).toISOString() });
await writeWatchdogStatus("starting");

process.on("SIGINT", () => {
  shutdown("SIGINT", 130).catch(() => process.exit(130));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 143).catch(() => process.exit(143));
});

while (!stopping) {
  runCount += 1;
  const exitCode = await runChild(durationMs / 3_600_000, runCount);
  if (stopping) break;
  if (!continuous) break;

  restartCount += 1;
  await writeWatchdogStatus("restarting", {
    lastExitCode: exitCode,
    restartCount,
    runCount,
    nextRestartAt: new Date(Date.now() + restartDelayMs).toISOString(),
  });
  await sleep(restartDelayMs);
}

await writeWatchdogStatus(continuous ? "stopped" : "completed", {
  restartCount,
  runCount,
  completedAt: new Date().toISOString(),
});

async function runChild(runHours, currentRunCount) {
  const runDeadline = Date.now() + runHours * 3_600_000;
  await writeWatchdogStatus("running", {
    restartCount,
    runCount: currentRunCount,
    currentRunHours: runHours,
    currentRunDeadline: new Date(runDeadline).toISOString(),
  });

  return await new Promise((resolve) => {
    // Initialize to null so any write after spawn counts as fresh,
    // avoiding a premature stale-kill when the file already exists with the same mtime.
    let lastSeenPaperMtime = null;
    let lastFreshAt = Date.now();
    child = spawn(process.execPath, [marathonScript], {
      cwd: root,
      env: {
        ...process.env,
        MARATHON_DURATION_HOURS: String(runHours),
        MARATHON_WATCHDOG_CHILD: "true",
      },
      stdio: "inherit",
    });
    writeWatchdogStatus("running", {
      restartCount,
      runCount: currentRunCount,
      currentRunHours: runHours,
      currentRunDeadline: new Date(runDeadline).toISOString(),
    }).catch((error) => console.error("[marathon-watchdog] status write failed", error));

    let isChecking = false;
    const staleTimer = setInterval(async () => {
      if (isChecking || !child || stopping) return;
      isChecking = true;
      try {
      const currentPaperMtime = getPaperResultMtimeMs();
      const statusStaleFor = await getStatusStaleForMs();
      if (
        currentPaperMtime !== null &&
        (lastSeenPaperMtime === null || currentPaperMtime > lastSeenPaperMtime)
      ) {
        lastSeenPaperMtime = currentPaperMtime;
        lastFreshAt = Date.now();
        await writeWatchdogStatus("running", {
          restartCount,
          runCount: currentRunCount,
          childPid: child.pid,
          currentRunHours: runHours,
          currentRunDeadline: new Date(runDeadline).toISOString(),
          lastSeenPaperMtime,
          paperStaleForMs: 0,
          statusStaleForMs: statusStaleFor,
        });
        return;
      }
      const paperStaleFor = currentPaperMtime === null ? null : Date.now() - lastFreshAt;
      const staleFor = paperStaleFor ?? statusStaleFor;
      await writeWatchdogStatus("running", {
        restartCount,
        runCount: currentRunCount,
        currentRunHours: runHours,
        currentRunDeadline: new Date(runDeadline).toISOString(),
        childPid: child.pid,
        lastSeenPaperMtime,
        paperStaleForMs: paperStaleFor,
        statusStaleForMs: statusStaleFor,
      });
      if (staleFor === null || staleFor < staleMs) return;

      await writeWatchdogStatus("stale-restart", {
        restartCount,
        runCount: currentRunCount,
        childPid: child.pid,
        lastSeenPaperMtime,
        paperStaleForMs: paperStaleFor,
        statusStaleForMs: statusStaleFor,
        staleForMs: staleFor,
      });
      child.kill("SIGTERM");
      setTimeout(() => child?.kill("SIGKILL"), 10_000).unref();
      } finally {
        isChecking = false;
      }
    }, checkMs);

    child.on("exit", (code, signal) => {
      clearInterval(staleTimer);
      child = null;
      resolve(code ?? signal ?? 1);
    });

    child.on("error", (error) => {
      clearInterval(staleTimer);
      child = null;
      console.error("[marathon-watchdog] child error", error);
      resolve(1);
    });
  });
}

function getPaperResultMtimeMs() {
  if (!existsSync(paperPath)) return null;
  return statSync(paperPath).mtimeMs;
}

async function getStatusStaleForMs() {
  if (!existsSync(statusPath)) return null;
  try {
    const status = JSON.parse(await readFile(statusPath, "utf8"));
    const timestamp = Date.parse(status.lastCycleAt ?? status.startedAt ?? status.stoppedAt ?? "");
    if (!Number.isFinite(timestamp)) return null;
    return Date.now() - timestamp;
  } catch {
    return null;
  }
}

async function shutdown(reason, exitCode) {
  if (stopping) return;
  stopping = true;
  if (child) child.kill("SIGTERM");
  await writeWatchdogStatus("stopped", {
    reason,
    restartCount,
    runCount,
    stoppedAt: new Date().toISOString(),
  });
  process.exit(exitCode);
}

async function writeWatchdogStatus(status, extra = {}) {
  await writeJson(watchdogStatusPath, {
    status,
    pid: process.pid,
    childPid: child?.pid ?? null,
    startedAt: new Date(startedAt).toISOString(),
    mode: continuous ? "continuous" : "single",
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
