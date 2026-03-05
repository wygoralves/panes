import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const entryPoint = path.join(
  repoRoot,
  "src-tauri",
  "sidecar",
  "claude-agent-sdk-server.mjs",
);
const outFile = path.join(
  repoRoot,
  "src-tauri",
  "sidecar-dist",
  "claude-agent-sdk-server.mjs",
);

await mkdir(path.dirname(outFile), { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  legalComments: "none",
  logLevel: "info",
});
