import type { HarnessInfo } from "../types";

export const HARNESS_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  codex: "npm install -g @openai/codex",
  "claude-code": "curl -fsSL https://claude.ai/install.sh | bash",
  "gemini-cli": "npm install -g @google/gemini-cli",
  kiro: "curl -fsSL https://cli.kiro.dev/install | bash",
  opencode: "npm install -g opencode-ai",
  "kilo-code": "npm install -g @kilocode/cli",
  "factory-droid": "curl -fsSL https://app.factory.ai/cli | sh",
};

// npm package name for each harness whose install command in
// HARNESS_INSTALL_COMMANDS is an `npm install -g <package>` invocation.
// Used to build the `mise use -g npm:<package>` equivalent when mise is
// the preferred install method (e.g. inside a Flatpak sandbox, where /app
// is read-only and a global npm install has nowhere to write to).
const NPM_PACKAGE_NAMES: Readonly<Record<string, string>> = {
  codex: "@openai/codex",
  "gemini-cli": "@google/gemini-cli",
  opencode: "opencode-ai",
  "kilo-code": "@kilocode/cli",
};

export type HarnessTileAction = "launch" | "install" | "manual";

export function getHarnessInstallCommand(
  harnessId: string,
  preferredInstallMethod: string | null = null,
): string | null {
  if (preferredInstallMethod === "mise") {
    const npmPackage = NPM_PACKAGE_NAMES[harnessId];
    if (npmPackage) {
      return `mise use -g npm:${npmPackage}`;
    }
  }

  return HARNESS_INSTALL_COMMANDS[harnessId] ?? null;
}

export function getHarnessTileAction(harness: HarnessInfo): HarnessTileAction | null {
  if (harness.found) {
    return "launch";
  }

  if (harness.canAutoInstall && getHarnessInstallCommand(harness.id)) {
    return "install";
  }

  if (harness.website) {
    return "manual";
  }

  return null;
}
