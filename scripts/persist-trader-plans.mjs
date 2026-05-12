import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const outdir = path.join(root, ".tmp", "scripts");
const outfile = path.join(outdir, "persist-trader-plans.bundle.mjs");

await mkdir(outdir, { recursive: true });
await build({
  bundle: true,
  entryPoints: [path.join(root, "scripts", "persist-trader-plans.ts")],
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
