// @ts-nocheck
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";

const refreshSteps = [
  { label: "Fetch top-30 chunk 0 / latest 30 days", script: "fetch:upbit:top30:chunk0" },
  { label: "Fetch top-30 chunk 1 / 30-60 days", script: "fetch:upbit:top30:chunk1" },
  { label: "Fetch top-30 chunk 2 / 60-90 days", script: "fetch:upbit:top30:chunk2" },
  { label: "Merge top-30 market chunks", script: "merge:upbit:top30" },
  { label: "Persist trader optimization plans", script: "persist:traders" },
  { label: "Build dashboard candle cache", script: "build:dashboard-cache" },
  { label: "Build dashboard results", script: "build:dashboard-results" },
];

const refreshState = {
  completedAt: "",
  error: "",
  logs: [],
  progress: 0,
  running: false,
  stepIndex: 0,
  stepLabel: "Idle",
  totalSteps: refreshSteps.length,
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

        runRefreshJob();
        sendJson(res, refreshState);
      });
    },
  };
}

async function runRefreshJob() {
  refreshState.completedAt = "";
  refreshState.error = "";
  refreshState.logs = [];
  refreshState.progress = 0;
  refreshState.running = true;
  refreshState.stepIndex = 0;
  refreshState.stepLabel = "Starting";

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

export default defineConfig({
  plugins: [strategyRefreshPlugin(), react()],
});
