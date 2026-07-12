import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const NATIVE_PACKAGE_PREFIX = "@anthropic-ai/claude-agent-sdk-";

function normalizeTargetArch(targetArch) {
  if (targetArch === "arm64" || targetArch === "x64") {
    return targetArch;
  }

  throw new Error(`Unsupported Claude SDK staging architecture: ${targetArch}`);
}

function resolveLegacyRipgrepTargets(targetPlatform, targetArch) {
  const arch = normalizeTargetArch(targetArch);

  if (targetPlatform === "darwin") {
    return new Set(["arm64-darwin", "x64-darwin"]);
  }

  if (targetPlatform === "linux") {
    return new Set([`${arch}-linux`]);
  }

  if (targetPlatform === "win32") {
    return new Set([`${arch}-win32`]);
  }

  throw new Error(
    `Unsupported Claude SDK staging target: ${targetPlatform}/${targetArch}`,
  );
}

export function resolveNativeSdkPackageTargets(
  targetPlatform,
  targetArch,
  targetLibc = "glibc",
) {
  const arch = normalizeTargetArch(targetArch);

  if (targetPlatform === "darwin") {
    return new Set([
      `${NATIVE_PACKAGE_PREFIX}darwin-arm64`,
      `${NATIVE_PACKAGE_PREFIX}darwin-x64`,
    ]);
  }

  if (targetPlatform === "linux") {
    const libcSuffix = targetLibc === "musl" ? "-musl" : "";
    return new Set([`${NATIVE_PACKAGE_PREFIX}linux-${arch}${libcSuffix}`]);
  }

  if (targetPlatform === "win32") {
    return new Set([`${NATIVE_PACKAGE_PREFIX}win32-${arch}`]);
  }

  throw new Error(
    `Unsupported Claude SDK staging target: ${targetPlatform}/${targetArch}`,
  );
}

async function stageNativePackages({
  sdkDistNodeModulesDir,
  sdkPackage,
  targetPlatform,
  targetArch,
  targetLibc,
  logger,
}) {
  const declaredNativePackages = new Set(
    Object.keys(sdkPackage.optionalDependencies ?? {}).filter((name) =>
      name.startsWith(NATIVE_PACKAGE_PREFIX),
    ),
  );
  const requiredPackages = resolveNativeSdkPackageTargets(
    targetPlatform,
    targetArch,
    targetLibc,
  );
  const anthropicDir = path.join(sdkDistNodeModulesDir, "@anthropic-ai");
  const binaryName = targetPlatform === "win32" ? "claude.exe" : "claude";

  for (const packageName of requiredPackages) {
    if (!declaredNativePackages.has(packageName)) {
      throw new Error(
        `Claude SDK does not declare the required native package ${packageName}.`,
      );
    }

    const packageDir = path.join(anthropicDir, packageName.split("/").at(-1));
    try {
      await access(path.join(packageDir, binaryName));
    } catch {
      throw new Error(
        `Claude SDK native package ${packageName} is missing from staged node_modules. Install optional dependencies for ${targetPlatform}/${targetArch} before building.`,
      );
    }
  }

  const entries = await readdir(anthropicDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const packageName = `@anthropic-ai/${entry.name}`;
      if (
        !declaredNativePackages.has(packageName) ||
        requiredPackages.has(packageName)
      ) {
        return;
      }

      await rm(path.join(anthropicDir, entry.name), {
        recursive: true,
        force: true,
      });
    }),
  );

  logger(
    `Staged Claude SDK native packages: ${Array.from(requiredPackages).join(", ")}.`,
  );
}

async function stageLegacyRipgrep({
  sdkDistPackageDir,
  targetPlatform,
  targetArch,
  logger,
}) {
  const ripgrepVendorDir = path.join(sdkDistPackageDir, "vendor", "ripgrep");
  const keepTargets = resolveLegacyRipgrepTargets(targetPlatform, targetArch);
  let entries;

  try {
    entries = await readdir(ripgrepVendorDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Claude SDK staging found neither native optional packages nor the legacy vendor/ripgrep layout.",
      );
    }
    throw error;
  }

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

  logger(
    `Staged Claude SDK ripgrep vendor assets for ${Array.from(keepTargets).join(", ")}.`,
  );
}

export async function stageClaudeSdkPlatformAssets({
  sdkDistNodeModulesDir,
  sdkDistPackageDir,
  targetPlatform,
  targetArch,
  targetLibc = "glibc",
  logger = console.log,
}) {
  const sdkPackage = JSON.parse(
    await readFile(path.join(sdkDistPackageDir, "package.json"), "utf8"),
  );
  const usesNativePackages = Object.keys(
    sdkPackage.optionalDependencies ?? {},
  ).some((name) => name.startsWith(NATIVE_PACKAGE_PREFIX));

  if (usesNativePackages) {
    await stageNativePackages({
      sdkDistNodeModulesDir,
      sdkPackage,
      targetPlatform,
      targetArch,
      targetLibc,
      logger,
    });
    return "native";
  }

  await stageLegacyRipgrep({
    sdkDistPackageDir,
    targetPlatform,
    targetArch,
    logger,
  });
  return "legacy";
}
