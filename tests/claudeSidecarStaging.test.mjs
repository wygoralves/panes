import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { stageClaudeSdkPlatformAssets } from "../scripts/claude-sidecar-staging.mjs";

const fixtureRoots = [];

async function createSdkFixture(optionalDependencies = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "panes-claude-staging-"));
  fixtureRoots.push(root);
  const nodeModulesDir = path.join(root, "node_modules");
  const anthropicDir = path.join(nodeModulesDir, "@anthropic-ai");
  const sdkPackageDir = path.join(anthropicDir, "claude-agent-sdk");
  await mkdir(sdkPackageDir, { recursive: true });
  await writeFile(
    path.join(sdkPackageDir, "package.json"),
    JSON.stringify({ optionalDependencies }),
  );
  return { anthropicDir, nodeModulesDir, sdkPackageDir };
}

async function createNativePackage(anthropicDir, packageName, binaryName) {
  const packageDir = path.join(anthropicDir, packageName.split("/").at(-1));
  await mkdir(packageDir, { recursive: true });
  await writeFile(path.join(packageDir, binaryName), "binary");
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("Claude sidecar SDK staging", () => {
  it("keeps the legacy universal macOS ripgrep targets", async () => {
    const fixture = await createSdkFixture();
    const ripgrepDir = path.join(
      fixture.sdkPackageDir,
      "vendor",
      "ripgrep",
    );
    await Promise.all(
      ["arm64-darwin", "x64-darwin", "x64-linux"].map((target) =>
        mkdir(path.join(ripgrepDir, target), { recursive: true }),
      ),
    );

    const layout = await stageClaudeSdkPlatformAssets({
      sdkDistNodeModulesDir: fixture.nodeModulesDir,
      sdkDistPackageDir: fixture.sdkPackageDir,
      targetPlatform: "darwin",
      targetArch: "arm64",
      logger: () => {},
    });

    expect(layout).toBe("legacy");
    expect((await readdir(ripgrepDir)).sort()).toEqual([
      "arm64-darwin",
      "x64-darwin",
    ]);
  });

  it("keeps only the required Windows native package", async () => {
    const optionalDependencies = {
      "@anthropic-ai/claude-agent-sdk-win32-x64": "0.3.207",
      "@anthropic-ai/claude-agent-sdk-linux-x64": "0.3.207",
    };
    const fixture = await createSdkFixture(optionalDependencies);
    await createNativePackage(
      fixture.anthropicDir,
      "@anthropic-ai/claude-agent-sdk-win32-x64",
      "claude.exe",
    );
    await createNativePackage(
      fixture.anthropicDir,
      "@anthropic-ai/claude-agent-sdk-linux-x64",
      "claude",
    );

    const layout = await stageClaudeSdkPlatformAssets({
      sdkDistNodeModulesDir: fixture.nodeModulesDir,
      sdkDistPackageDir: fixture.sdkPackageDir,
      targetPlatform: "win32",
      targetArch: "x64",
      logger: () => {},
    });

    expect(layout).toBe("native");
    expect((await readdir(fixture.anthropicDir)).sort()).toEqual([
      "claude-agent-sdk",
      "claude-agent-sdk-win32-x64",
    ]);
  });

  it("keeps both native packages for universal macOS", async () => {
    const optionalDependencies = {
      "@anthropic-ai/claude-agent-sdk-darwin-arm64": "0.3.207",
      "@anthropic-ai/claude-agent-sdk-darwin-x64": "0.3.207",
      "@anthropic-ai/claude-agent-sdk-linux-x64": "0.3.207",
    };
    const fixture = await createSdkFixture(optionalDependencies);
    for (const packageName of Object.keys(optionalDependencies)) {
      await createNativePackage(
        fixture.anthropicDir,
        packageName,
        "claude",
      );
    }

    await stageClaudeSdkPlatformAssets({
      sdkDistNodeModulesDir: fixture.nodeModulesDir,
      sdkDistPackageDir: fixture.sdkPackageDir,
      targetPlatform: "darwin",
      targetArch: "arm64",
      logger: () => {},
    });

    expect((await readdir(fixture.anthropicDir)).sort()).toEqual([
      "claude-agent-sdk",
      "claude-agent-sdk-darwin-arm64",
      "claude-agent-sdk-darwin-x64",
    ]);
  });

  it("fails when a required native package was not installed", async () => {
    const optionalDependencies = {
      "@anthropic-ai/claude-agent-sdk-darwin-arm64": "0.3.207",
      "@anthropic-ai/claude-agent-sdk-darwin-x64": "0.3.207",
    };
    const fixture = await createSdkFixture(optionalDependencies);
    await createNativePackage(
      fixture.anthropicDir,
      "@anthropic-ai/claude-agent-sdk-darwin-arm64",
      "claude",
    );

    await expect(
      stageClaudeSdkPlatformAssets({
        sdkDistNodeModulesDir: fixture.nodeModulesDir,
        sdkDistPackageDir: fixture.sdkPackageDir,
        targetPlatform: "darwin",
        targetArch: "arm64",
        logger: () => {},
      }),
    ).rejects.toThrow("claude-agent-sdk-darwin-x64 is missing");
  });
});
