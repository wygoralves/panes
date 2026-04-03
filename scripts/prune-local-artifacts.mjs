import { rm, lstat, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const apply = args.has("--apply");
const staleOnly = args.has("--stale");
const checkOnly = args.has("--check") || !apply;
const olderThanDays = parseOlderThanDays(rawArgs);
const staleCutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
const rustTargetRelativePath = "src-tauri/target";
const cargoCacheDirectoryNames = new Set(["incremental", "deps", "build", ".fingerprint"]);

const targets = [
  {
    relativePath: rustTargetRelativePath,
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

function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDays(days) {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function parseOlderThanDays(argv) {
  const rawValue = argv.find((arg) => arg.startsWith("--older-than-days="));
  if (!rawValue) {
    return 7;
  }

  const value = Number.parseInt(rawValue.split("=")[1] ?? "", 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid --older-than-days value: ${rawValue}`);
  }

  return value;
}

function toRepoRelative(absolutePath) {
  const relativePath = path.relative(repoRoot, absolutePath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function hardLinkKey(stats) {
  if (
    typeof stats.dev !== "number" ||
    typeof stats.ino !== "number" ||
    stats.dev === 0 ||
    stats.ino === 0
  ) {
    return null;
  }

  return `${stats.dev}:${stats.ino}`;
}

function fileSizeFromStats(stats, seenHardLinks) {
  if (stats.nlink > 1) {
    const linkKey = hardLinkKey(stats);
    if (linkKey) {
      if (seenHardLinks.has(linkKey)) {
        return 0;
      }
      seenHardLinks.add(linkKey);
    }
  }

  return stats.size;
}

async function pathSize(targetPath, seenHardLinks = new Set()) {
  const stats = await lstat(targetPath);
  return entrySize(targetPath, stats, seenHardLinks);
}

async function entrySize(targetPath, stats, seenHardLinks) {
  if (!stats.isDirectory()) {
    return fileSizeFromStats(stats, seenHardLinks);
  }

  let total = 0;
  for (const entry of await readdir(targetPath, { withFileTypes: true })) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      total += await pathSize(entryPath, seenHardLinks);
      continue;
    }
    const entryStats = await lstat(entryPath);
    total += fileSizeFromStats(entryStats, seenHardLinks);
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

function assertManagedPath(absolutePath, { allowNested = false } = {}) {
  const resolvedPath = path.resolve(absolutePath);
  const matchesManagedTarget = targets.some((target) => {
    const managedRoot = path.join(repoRoot, target.relativePath);
    const relativeToTarget = path.relative(managedRoot, resolvedPath);

    if (!allowNested) {
      return managedRoot === resolvedPath;
    }

    return (
      relativeToTarget === "" ||
      (!relativeToTarget.startsWith("..") && !path.isAbsolute(relativeToTarget))
    );
  });

  if (!matchesManagedTarget) {
    throw new Error(`Refusing to prune unmanaged path: ${absolutePath}`);
  }
}

function shouldPruneRustTopLevelArtifact(name) {
  return (
    name === "_up_" ||
    name === "sidecar-dist" ||
    name === "com.panes.app.helper.keepawake" ||
    /^Panes(?:HelperRegistrar)?(?:$|[.-])/.test(name) ||
    /^(?:lib)?agent_workspace_lib(?:$|[.-])/.test(name)
  );
}

function isOlderThanCutoff(stats) {
  return stats.mtimeMs < staleCutoffMs;
}

async function collectStaleTargetCandidates() {
  const targetRoot = path.join(repoRoot, rustTargetRelativePath);

  try {
    await lstat(targetRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const candidates = [];
  await walkRustTargetTree(targetRoot, candidates);

  const seenHardLinks = new Set();
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  for (const candidate of candidates) {
    candidate.sizeBytes = await entrySize(
      candidate.absolutePath,
      candidate.stats,
      seenHardLinks,
    );
  }

  return candidates;
}

async function walkRustTargetTree(currentPath, candidates) {
  for (const entry of await readdir(currentPath, { withFileTypes: true })) {
    const absolutePath = path.join(currentPath, entry.name);
    const stats = await lstat(absolutePath);

    if (entry.isDirectory()) {
      if (cargoCacheDirectoryNames.has(entry.name)) {
        await collectStaleCargoCacheEntries(absolutePath, candidates);
        continue;
      }

      if (shouldPruneRustTopLevelArtifact(entry.name) && isOlderThanCutoff(stats)) {
        candidates.push({
          absolutePath,
          relativePath: toRepoRelative(absolutePath),
          bucketRelativePath: toRepoRelative(currentPath),
          stats,
        });
        continue;
      }

      await walkRustTargetTree(absolutePath, candidates);
      continue;
    }

    if (shouldPruneRustTopLevelArtifact(entry.name) && isOlderThanCutoff(stats)) {
      candidates.push({
        absolutePath,
        relativePath: toRepoRelative(absolutePath),
        bucketRelativePath: toRepoRelative(currentPath),
        stats,
      });
    }
  }
}

async function collectStaleCargoCacheEntries(cacheDirectoryPath, candidates) {
  for (const entry of await readdir(cacheDirectoryPath, { withFileTypes: true })) {
    const absolutePath = path.join(cacheDirectoryPath, entry.name);
    const stats = await lstat(absolutePath);

    if (!isOlderThanCutoff(stats)) {
      continue;
    }

    candidates.push({
      absolutePath,
      relativePath: toRepoRelative(absolutePath),
      bucketRelativePath: toRepoRelative(cacheDirectoryPath),
      stats,
    });
  }
}

function summarizeStaleCandidates(candidates) {
  const groups = new Map();

  for (const candidate of candidates) {
    const existingGroup = groups.get(candidate.bucketRelativePath);
    if (existingGroup) {
      existingGroup.count += 1;
      existingGroup.sizeBytes += candidate.sizeBytes;
      continue;
    }

    groups.set(candidate.bucketRelativePath, {
      bucketRelativePath: candidate.bucketRelativePath,
      count: 1,
      sizeBytes: candidate.sizeBytes,
    });
  }

  return [...groups.values()].sort((left, right) => {
    if (right.sizeBytes !== left.sizeBytes) {
      return right.sizeBytes - left.sizeBytes;
    }
    return left.bucketRelativePath.localeCompare(right.bucketRelativePath);
  });
}

async function runFullPruneMode() {
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
    return;
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
}

async function runStalePruneMode() {
  const candidates = await collectStaleTargetCandidates();
  const groups = summarizeStaleCandidates(candidates);
  const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);
  const ageWindow = formatDays(olderThanDays);

  if (checkOnly) {
    if (candidates.length === 0) {
      console.log(`No stale Rust/Tauri artifacts older than ${ageWindow} were found.`);
    } else {
      console.log(`Stale Rust/Tauri artifacts older than ${ageWindow}:`);
      for (const group of groups) {
        console.log(
          `- ${group.bucketRelativePath}: ${formatBytes(group.sizeBytes)} across ${formatCount(group.count, "entry", "entries")}`,
        );
      }
      console.log(`Total reclaimable: ${formatBytes(totalBytes)}`);
    }
  }

  if (!apply) {
    if (checkOnly) {
      console.log(
        `Run with --apply --stale to remove Rust/Tauri artifacts older than ${ageWindow}.`,
      );
    }
    return;
  }

  for (const candidate of candidates) {
    assertManagedPath(candidate.absolutePath, { allowNested: true });
    await rm(candidate.absolutePath, { recursive: true, force: true });
  }

  if (candidates.length === 0) {
    console.log("Nothing to prune.");
  } else {
    console.log(
      `Removed ${formatCount(candidates.length, "stale artifact")} older than ${ageWindow}.`,
    );
    for (const group of groups) {
      console.log(
        `- ${group.bucketRelativePath}: ${formatBytes(group.sizeBytes)} across ${formatCount(group.count, "entry", "entries")}`,
      );
    }
    console.log(`Reclaimed ${formatBytes(totalBytes)} total.`);
  }
}

if (staleOnly) {
  await runStalePruneMode();
} else {
  await runFullPruneMode();
}
