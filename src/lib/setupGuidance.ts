import type { DependencyReport } from "../types";

const LINUX_PACKAGE_MANAGER_ORDER = ["apt", "dnf", "pacman", "zypper", "apk"] as const;
const WINDOWS_PACKAGE_MANAGER_ORDER = ["winget", "choco", "scoop"] as const;

const NODE_INSTALL_COMMANDS = {
  apt: "sudo apt install nodejs npm",
  dnf: "sudo dnf install nodejs npm",
  pacman: "sudo pacman -S nodejs npm",
  zypper: "sudo zypper install nodejs npm",
  apk: "sudo apk add nodejs npm",
  winget: "winget install OpenJS.NodeJS.LTS",
  choco: "choco install nodejs-lts -y",
  scoop: "scoop install nodejs-lts",
} as const;

const GIT_INSTALL_COMMANDS = {
  apt: "sudo apt install git",
  dnf: "sudo dnf install git",
  pacman: "sudo pacman -S git",
  zypper: "sudo zypper install git",
  apk: "sudo apk add git",
  winget: "winget install --id Git.Git -e",
  choco: "choco install git -y",
  scoop: "scoop install git",
} as const;

export interface ManualInstallGuidance {
  command: string | null;
  altKey: string;
  altVars?: Record<string, string>;
}

export function getNodeManualGuidance(report: DependencyReport): ManualInstallGuidance {
  const hasHomebrew = report.packageManagers.includes("homebrew");

  if (report.platform === "macos") {
    return {
      command: hasHomebrew ? "brew install node" : null,
      altKey: hasHomebrew ? "manual.nodeAltOrDownload" : "manual.nodeAltInstall",
    };
  }

  if (report.platform === "windows") {
    const detectedManager = getPreferredWindowsPackageManager(report.packageManagers);
    if (detectedManager) {
      return {
        command: NODE_INSTALL_COMMANDS[detectedManager],
        altKey: "manual.nodeAltPackageManagerDetected",
        altVars: { manager: detectedManager },
      };
    }

    return {
      command: null,
      altKey: "manual.nodeAltInstall",
    };
  }

  const detectedManager = getPreferredLinuxPackageManager(report.packageManagers);
  if (detectedManager) {
    return {
      command: NODE_INSTALL_COMMANDS[detectedManager],
      altKey: "manual.nodeAltPackageManagerDetected",
      altVars: { manager: detectedManager },
    };
  }

  return {
    command: null,
    altKey: "manual.nodeAltPackageManager",
  };
}

export function getGitManualGuidance(report: DependencyReport): ManualInstallGuidance {
  const hasHomebrew = report.packageManagers.includes("homebrew");

  if (report.platform === "macos") {
    return {
      command: hasHomebrew ? "brew install git" : null,
      altKey: hasHomebrew ? "manual.gitAltOrDownload" : "manual.gitAltInstall",
    };
  }

  if (report.platform === "windows") {
    const detectedManager = getPreferredWindowsPackageManager(report.packageManagers);
    if (detectedManager) {
      return {
        command: GIT_INSTALL_COMMANDS[detectedManager],
        altKey: "manual.gitAltPackageManagerDetected",
        altVars: { manager: detectedManager },
      };
    }

    return {
      command: null,
      altKey: "manual.gitAltInstall",
    };
  }

  const detectedManager = getPreferredLinuxPackageManager(report.packageManagers);
  if (detectedManager) {
    return {
      command: GIT_INSTALL_COMMANDS[detectedManager],
      altKey: "manual.gitAltPackageManagerDetected",
      altVars: { manager: detectedManager },
    };
  }

  return {
    command: null,
    altKey: "manual.gitAltPackageManager",
  };
}

function getPreferredLinuxPackageManager(packageManagers: string[]): string | null {
  const match = LINUX_PACKAGE_MANAGER_ORDER.find((manager) => packageManagers.includes(manager));
  return match ?? null;
}

function getPreferredWindowsPackageManager(packageManagers: string[]): string | null {
  const match = WINDOWS_PACKAGE_MANAGER_ORDER.find((manager) => packageManagers.includes(manager));
  return match ?? null;
}
