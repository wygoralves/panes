import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const requiredArtifacts = [
  path.join(repoRoot, "dist", "index.html"),
  path.join(
    repoRoot,
    "src-tauri",
    "sidecar-dist",
    "claude-agent-sdk-server.mjs",
  ),
];

const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function ensureArtifactsExist() {
  for (const artifactPath of requiredArtifacts) {
    try {
      await access(artifactPath, fsConstants.F_OK);
    } catch {
      throw new Error(
        `Expected prebuilt desktop artifact was not found: ${path.relative(repoRoot, artifactPath)}`,
      );
    }
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} ${args.join(" ")} exited with signal ${signal}`
            : `${command} ${args.join(" ")} exited with code ${code}`,
        ),
      );
    });
  });
}

if (process.env.PANES_SKIP_DESKTOP_PREBUILD === "1") {
  await ensureArtifactsExist();
  console.log("Using prebuilt desktop artifacts.");
  process.exit(0);
}

await run(pnpmExecutable, ["run", "build"]);
await run(pnpmExecutable, ["run", "build:claude-sidecar"]);
