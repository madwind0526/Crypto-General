// @ts-nocheck
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, execSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const refreshStepSets = {
  general: [
  { label: "Fetch top-30 1m / latest 7 days", script: "fetch:upbit:1m:backtracking" },
  { label: "Persist trader optimization plans", script: "persist:traders" },
  { label: "Build dashboard candle cache", script: "build:dashboard-cache:1m:backtracking" },
  { label: "Build dashboard results", script: "build:dashboard-results" },
  ],
  daily: [
    { label: "Fetch selected-market 1m daily candles", script: "fetch:upbit:1m:daily" },
    { label: "Run 1m daily paper simulation", script: "paper:sim:1m:daily" },
  ],
};
refreshStepSets.anomaly = refreshStepSets.daily;

const refreshState = {
  completedAt: "",
  error: "",
  logs: [],
  progress: 0,
  running: false,
  scope: "idle",
  stepIndex: 0,
  stepLabel: "Idle",
  totalSteps: refreshStepSets.general.length,
};

function strategyRefreshPlugin() {
  return {
    name: "strategy-refresh-api",
    configureServer(server) {
      server.middlewares.use("/api/strategy-refresh/status", (_req, res) => {
        sendJson(res, refreshState);
      });

      server.middlewares.use("/api/strategy-refresh", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          sendJson(res, { error: "Method not allowed" });
          return;
        }

        if (refreshState.running) {
          res.statusCode = 409;
          sendJson(res, refreshState);
          return;
        }

        const url = new URL(req.url ?? "", "http://127.0.0.1");
        const requestedScope = url.searchParams.get("scope");
        const scope = requestedScope === "daily" || requestedScope === "anomaly" ? "daily" : "general";
        runRefreshJob(scope);
        sendJson(res, refreshState);
      });
    },
  };
}

async function runRefreshJob(scope) {
  const refreshSteps = refreshStepSets[scope] ?? refreshStepSets.general;
  refreshState.completedAt = "";
  refreshState.error = "";
  refreshState.logs = [];
  refreshState.progress = 0;
  refreshState.running = true;
  refreshState.scope = scope;
  refreshState.stepIndex = 0;
  refreshState.stepLabel = "Starting";
  refreshState.totalSteps = refreshSteps.length;

  try {
    for (let index = 0; index < refreshSteps.length; index += 1) {
      const step = refreshSteps[index];
      refreshState.stepIndex = index + 1;
      refreshState.stepLabel = step.label;
      refreshState.progress = Math.round((index / refreshSteps.length) * 100);
      await runNpmScript(step.script);
      refreshState.progress = Math.round(((index + 1) / refreshSteps.length) * 100);
    }

    refreshState.stepLabel = "Completed";
    refreshState.completedAt = new Date().toISOString();
  } catch (error) {
    refreshState.error = error instanceof Error ? error.message : String(error);
    refreshState.stepLabel = "Failed";
  } finally {
    refreshState.running = false;
  }
}

function runNpmScript(script) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["run", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UPBIT_REQUEST_DELAY_MS: process.env.UPBIT_REQUEST_DELAY_MS ?? "90",
      },
      shell: false,
    });

    child.stdout.on("data", (data) => appendLog(data.toString()));
    child.stderr.on("data", (data) => appendLog(data.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${script} failed with exit code ${code}`));
    });
  });
}

function appendLog(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  refreshState.logs.push(...lines);
  refreshState.logs = refreshState.logs.slice(-80);
}

function sendJson(res, payload) {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

// ─── ws-live restart plugin ───────────────────────────────────────────────────
const wsLivePidFile = `${process.cwd()}/data/local/paper-trading-1m-daily/ws-live.pid`;

const wsLiveState = {
  pid: null,
  running: false,
  startedAt: "",
  error: "",
};

function readPersistedPid() {
  try {
    const n = parseInt(readFileSync(wsLivePidFile, "utf8").trim(), 10);
    return isNaN(n) || n <= 0 ? null : n;
  } catch { return null; }
}

function persistPid(pid) {
  try { writeFileSync(wsLivePidFile, String(pid), "utf8"); } catch { /* non-fatal */ }
}

function clearPersistedPid() {
  try { unlinkSync(wsLivePidFile); } catch { /* already gone */ }
}

function killWsLive() {
  // Only kill PIDs this project started — never touch other projects' processes
  const pid = wsLiveState.pid ?? readPersistedPid();
  if (pid) {
    try {
      // /F force-kills, /T kills entire child tree (catches esbuild subprocess)
      execSync(`taskkill /F /T /PID ${pid}`, { timeout: 3000 });
    } catch { /* already dead or access denied */ }
  }
  clearPersistedPid();
  wsLiveState.pid = null;
  wsLiveState.running = false;
}

function startWsLive() {
  const root = process.cwd();
  const logName = `ws-live-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`;
  const logDir = `${root}/data/local/paper-trading-1m-daily/logs`;
  const logPath = `${logDir}/${logName}`;
  mkdirSync(logDir, { recursive: true });

  const child = spawn("node", ["scripts/ws-live.mjs"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Write stdout/stderr to log file without keeping parent alive
  try {
    const log = createWriteStream(logPath, { flags: "a" });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
  } catch { /* log write failure is non-fatal */ }

  child.unref();
  wsLiveState.pid     = child.pid;
  wsLiveState.running = true;
  wsLiveState.startedAt = new Date().toISOString();
  wsLiveState.error   = "";
  persistPid(child.pid);
  return child.pid;
}

function wsLivePlugin() {
  return {
    name: "ws-live-api",
    configureServer(server) {
      server.middlewares.use("/api/ws-live/status", (_req, res) => {
        // Recover PID from file if Vite restarted and lost in-memory state
        if (!wsLiveState.pid) wsLiveState.pid = readPersistedPid();
        // Sync running state with actual process existence
        if (wsLiveState.pid) {
          try {
            process.kill(wsLiveState.pid, 0);
            wsLiveState.running = true;
          } catch {
            wsLiveState.running = false;
            wsLiveState.pid = null;
            clearPersistedPid();
          }
        }
        sendJson(res, wsLiveState);
      });

      server.middlewares.use("/api/ws-live/restart", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          sendJson(res, { error: "Method not allowed" });
          return;
        }
        try {
          killWsLive();
          // Small delay so OS releases the WebSocket connection before reconnect
          setTimeout(() => {
            try {
              const pid = startWsLive();
              sendJson(res, { ...wsLiveState, pid });
            } catch (err) {
              wsLiveState.error = err instanceof Error ? err.message : String(err);
              wsLiveState.running = false;
              res.statusCode = 500;
              sendJson(res, wsLiveState);
            }
          }, 1500);
        } catch (err) {
          wsLiveState.error = err instanceof Error ? err.message : String(err);
          res.statusCode = 500;
          sendJson(res, wsLiveState);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [strategyRefreshPlugin(), wsLivePlugin(), react()],
  server: {
    port: 5178,
    strictPort: true,
  },
});
