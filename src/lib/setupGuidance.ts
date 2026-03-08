import type { DependencyReport } from "../types";

const LINUX_PACKAGE_MANAGER_ORDER = ["apt", "dnf", "pacman", "zypper", "apk"] as const;

export interface NodeManualGuidance {
  command: string | null;
  altKey: string;
  altVars?: Record<string, string>;
}

export function getNodeManualGuidance(report: DependencyReport): NodeManualGuidance {
  const hasHomebrew = report.packageManagers.includes("homebrew");

  if (report.platform === "macos") {
    return {
      command: hasHomebrew ? "brew install node" : null,
      altKey: hasHomebrew ? "manual.nodeAltOrDownload" : "manual.nodeAltInstall",
    };
  }

  const detectedManager = getPreferredLinuxPackageManager(report.packageManagers);
  if (detectedManager) {
    return {
      command: null,
      altKey: "manual.nodeAltPackageManagerDetected",
      altVars: { manager: detectedManager },
    };
  }

  return {
    command: null,
    altKey: "manual.nodeAltPackageManager",
  };
}

function getPreferredLinuxPackageManager(packageManagers: string[]): string | null {
  const match = LINUX_PACKAGE_MANAGER_ORDER.find((manager) => packageManagers.includes(manager));
  return match ?? null;
}
