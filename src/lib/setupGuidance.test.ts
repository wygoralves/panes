import { describe, expect, it } from "vitest";
import { getGitManualGuidance, getNodeManualGuidance } from "./setupGuidance";
import type { DependencyReport } from "../types";

const baseReport: DependencyReport = {
  node: {
    found: false,
    version: null,
    path: null,
    canAutoInstall: false,
    installMethod: null,
  },
  codex: {
    found: false,
    version: null,
    path: null,
    canAutoInstall: false,
    installMethod: null,
  },
  git: {
    found: true,
    version: "2.50.0",
    path: "/usr/bin/git",
    canAutoInstall: false,
    installMethod: null,
  },
  platform: "linux",
  packageManagers: [],
};

describe("setup guidance", () => {
  it("uses detected Linux package managers for manual Node guidance", () => {
    expect(
      getNodeManualGuidance({
        ...baseReport,
        packageManagers: ["apt"],
      }),
    ).toEqual({
      command: "sudo apt install nodejs npm",
      altKey: "manual.nodeAltPackageManagerDetected",
      altVars: { manager: "apt" },
    });
  });

  it("keeps brew install guidance on macOS when homebrew is available", () => {
    expect(
      getNodeManualGuidance({
        ...baseReport,
        platform: "macos",
        packageManagers: ["homebrew"],
      }),
    ).toEqual({
      command: "brew install node",
      altKey: "manual.nodeAltOrDownload",
    });
  });

  it("uses detected Windows package managers for manual Node guidance", () => {
    expect(
      getNodeManualGuidance({
        ...baseReport,
        platform: "windows",
        packageManagers: ["winget"],
      }),
    ).toEqual({
      command: "winget install OpenJS.NodeJS.LTS",
      altKey: "manual.nodeAltPackageManagerDetected",
      altVars: { manager: "winget" },
    });
  });

  it("falls back to direct install guidance on Windows without a package manager", () => {
    expect(
      getNodeManualGuidance({
        ...baseReport,
        platform: "windows",
      }),
    ).toEqual({
      command: null,
      altKey: "manual.nodeAltInstall",
    });
  });

  it("uses detected Windows package managers for manual Git guidance", () => {
    expect(
      getGitManualGuidance({
        ...baseReport,
        platform: "windows",
        packageManagers: ["winget"],
      }),
    ).toEqual({
      command: "winget install --id Git.Git -e",
      altKey: "manual.gitAltPackageManagerDetected",
      altVars: { manager: "winget" },
    });
  });

  it("falls back to direct Git install guidance without package managers", () => {
    expect(getGitManualGuidance(baseReport)).toEqual({
      command: null,
      altKey: "manual.gitAltPackageManager",
    });
  });
});
