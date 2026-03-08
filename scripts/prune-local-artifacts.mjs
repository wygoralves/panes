import { rm, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const checkOnly = args.has("--check") || !apply;

const targets = [
  {
    relativePath: "src-tauri/target",
    label: "Rust/Tauri build artifacts",
  },
  {
    relativePath: "dist",
    label: "frontend production bundle",
  },
  {
    relativePath: "remotion/node_modules/.remotion",
    label: "Remotion browser/runtime cache",
  },
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex <= 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

async function pathSize(targetPath) {
  const stats = await lstat(targetPath);
  if (!stats.isDirectory()) {
    return stats.size;
  }

  let total = 0;
  for (const entry of await readdir(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await pathSize(entryPath);
      continue;
    }
    const entryStats = await lstat(entryPath);
    total += entryStats.size;
  }
  return total;
}

async function inspectTarget(target) {
  const absolutePath = path.join(repoRoot, target.relativePath);
  try {
    const sizeBytes = await pathSize(absolutePath);
    return {
      ...target,
      absolutePath,
      exists: true,
      sizeBytes,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        ...target,
        absolutePath,
        exists: false,
        sizeBytes: 0,
      };
    }
    throw error;
  }
}

function assertManagedPath(absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !targets.some((target) => path.join(repoRoot, target.relativePath) === absolutePath)
  ) {
    throw new Error(`Refusing to prune unmanaged path: ${absolutePath}`);
  }
}

const inspected = await Promise.all(targets.map(inspectTarget));
const existing = inspected.filter((target) => target.exists);
const totalBytes = existing.reduce((sum, target) => sum + target.sizeBytes, 0);

if (checkOnly) {
  if (existing.length === 0) {
    console.log("No generated artifacts found in the managed prune paths.");
  } else {
    console.log("Generated artifacts:");
    for (const target of existing) {
      console.log(
        `- ${target.relativePath}: ${formatBytes(target.sizeBytes)} (${target.label})`,
      );
    }
    console.log(`Total reclaimable: ${formatBytes(totalBytes)}`);
  }
}

if (!apply) {
  if (checkOnly) {
    console.log("Run with --apply to remove the generated artifacts above.");
  }
  process.exit(0);
}

for (const target of existing) {
  assertManagedPath(target.absolutePath);
  await rm(target.absolutePath, { recursive: true, force: true });
  console.log(`Removed ${target.relativePath} (${formatBytes(target.sizeBytes)})`);
}

if (existing.length === 0) {
  console.log("Nothing to prune.");
} else {
  console.log(`Reclaimed ${formatBytes(totalBytes)} total.`);
}
