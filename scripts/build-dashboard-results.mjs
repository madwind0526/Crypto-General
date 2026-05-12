import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outdir = path.join(root, ".tmp", "scripts");
const outfile = path.join(outdir, "build-dashboard-results.bundle.mjs");

await mkdir(outdir, { recursive: true });
await build({
  bundle: true,
  entryPoints: [path.join(root, "scripts", "build-dashboard-results.ts")],
  format: "esm",
  outfile,
  platform: "node",
  target: "node20",
});

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outfile, { force: true });
}
