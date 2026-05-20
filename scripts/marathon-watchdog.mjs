import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const stateDir = path.join(root, "data", "local", "paper-trading-1m-daily");
const statusPath = path.join(stateDir, "marathon-status.json");
const watchdogPidPath = path.join(stateDir, "marathon-watchdog.pid");
const watchdogStatusPath = path.join(stateDir, "marathon-watchdog-status.json");
const marathonScript = path.join(root, "scripts", "day-trading-marathon.mjs");

const durationMs = Number(process.env.MARATHON_DURATION_HOURS ?? 24) * 60 * 60 * 1000;
const restartDelayMs = Number(process.env.MARATHON_RESTART_DELAY_SECONDS ?? 15) * 1000;
const staleMs = Number(process.env.MARATHON_STALE_MINUTES ?? 45) * 60 * 1000;
const checkMs = Number(process.env.MARATHON_WATCHDOG_CHECK_SECONDS ?? 60) * 1000;

await mkdir(stateDir, { recursive: true });
const startedAt = Date.now();
const deadline = startedAt + durationMs;
let child = null;
let stopping = false;
let restartCount = 0;

await writeJson(watchdogPidPath, { pid: process.pid, startedAt: new Date(startedAt).toISOString() });
await writeWatchdogStatus("starting");

process.on("SIGINT", () => {
  shutdown("SIGINT", 130).catch(() => process.exit(130));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM", 143).catch(() => process.exit(143));
});

while (!stopping && Date.now() < deadline) {
  const remainingHours = Math.max(0.01, (deadline - Date.now()) / 3_600_000);
  const exitCode = await runChild(remainingHours);
  if (stopping || Date.now() >= deadline) break;

  restartCount += 1;
  await writeWatchdogStatus("restarting", {
    lastExitCode: exitCode,
    restartCount,
    nextRestartAt: new Date(Date.now() + restartDelayMs).toISOString(),
  });
  await sleep(restartDelayMs);
}

await writeWatchdogStatus("completed", { restartCount, completedAt: new Date().toISOString() });

async function runChild(remainingHours) {
  await writeWatchdogStatus("running", { restartCount, remainingHours });

  return await new Promise((resolve) => {
    child = spawn(process.execPath, [marathonScript], {
      cwd: root,
      env: {
        ...process.env,
        MARATHON_DURATION_HOURS: String(remainingHours),
        MARATHON_WATCHDOG_CHILD: "true",
      },
      stdio: "inherit",
    });
    writeWatchdogStatus("running", { restartCount, remainingHours }).catch((error) =>
      console.error("[marathon-watchdog] status write failed", error),
    );

    const staleTimer = setInterval(async () => {
      if (!child || stopping) return;
      const staleFor = await getStatusStaleForMs();
      if (staleFor === null || staleFor < staleMs) return;

      await writeWatchdogStatus("stale-restart", {
        restartCount,
        childPid: child.pid,
        staleForMs: staleFor,
      });
      child.kill("SIGTERM");
      setTimeout(() => child?.kill("SIGKILL"), 10_000).unref();
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
    deadline: new Date(deadline).toISOString(),
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
