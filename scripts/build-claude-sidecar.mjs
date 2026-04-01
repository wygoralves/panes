import { cp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
const outDir = path.dirname(outFile);
const sdkEntryPoint = fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"));
const sdkPackageDir = path.resolve(path.dirname(sdkEntryPoint), "..", "..");
const sdkDistNodeModulesDir = path.join(outDir, "node_modules");
const sdkDistPackageDir = path.join(
  sdkDistNodeModulesDir,
  "@anthropic-ai",
  "claude-agent-sdk",
);
const ripgrepVendorDir = path.join(sdkDistPackageDir, "vendor", "ripgrep");

function resolveRipgrepTargets() {
  const targetPlatform = process.env.PANES_CLAUDE_SDK_PLATFORM ?? process.platform;
  const targetArch = process.env.PANES_CLAUDE_SDK_ARCH ?? process.arch;

  if (targetPlatform === "darwin") {
    // The release job builds a universal macOS bundle, so keep both darwin targets.
    return new Set(["arm64-darwin", "x64-darwin"]);
  }

  if (targetPlatform === "linux") {
    return new Set([targetArch === "arm64" ? "arm64-linux" : "x64-linux"]);
  }

  if (targetPlatform === "win32") {
    return new Set([targetArch === "arm64" ? "arm64-win32" : "x64-win32"]);
  }

  throw new Error(
    `Unsupported Claude SDK staging target for ripgrep vendor assets: ${targetPlatform}/${targetArch}`,
  );
}

async function pruneUnusedRipgrepVendors() {
  const keepTargets = resolveRipgrepTargets();
  const entries = await readdir(ripgrepVendorDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || keepTargets.has(entry.name)) {
        return;
      }

      await rm(path.join(ripgrepVendorDir, entry.name), {
        recursive: true,
        force: true,
      });
    }),
  );

  console.log(
    `Staged Claude SDK ripgrep vendor assets for ${Array.from(keepTargets).join(", ")}.`,
  );
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await cp(entryPoint, outFile, {
  force: true,
});

await cp(sdkPackageDir, sdkDistNodeModulesDir, {
  recursive: true,
  dereference: true,
  force: true,
});

await pruneUnusedRipgrepVendors();

const output = await readFile(outFile, "utf8");
if (!output.includes('import("@anthropic-ai/claude-agent-sdk")')) {
  throw new Error(
    "Claude sidecar staging no longer imports @anthropic-ai/claude-agent-sdk from node_modules as expected.",
  );
}
