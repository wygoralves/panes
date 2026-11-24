import type { HarnessInfo } from "../types";

export const HARNESS_INSTALL_COMMANDS: Readonly<Record<string, string>> = {
  codex: "npm install -g @openai/codex",
  "claude-code": "curl -fsSL https://claude.ai/install.sh | bash",
  "gemini-cli": "npm install -g @google/gemini-cli",
  antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
  kiro: "curl -fsSL https://cli.kiro.dev/install | bash",
  opencode: "npm install -g opencode-ai",
  "kilo-code": "npm install -g @kilocode/cli",
  "factory-droid": "curl -fsSL https://app.factory.ai/cli | sh",
  "cursor-cli": "curl https://cursor.com/install -fsS | bash",
  "copilot-cli": "npm install -g @github/copilot",
  amp: "curl -fsSL https://ampcode.com/install.sh | bash",
  "qwen-code": "npm install -g @qwen-code/qwen-code",
  crush: "npm install -g @charmland/crush",
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
  "copilot-cli": "@github/copilot",
  "qwen-code": "@qwen-code/qwen-code",
  crush: "@charmland/crush",
};

export type HarnessTileAction = "launch" | "install" | "manual";

type HarnessInstallTarget = Pick<HarnessInfo, "id" | "installCommandDisplay">;

export function getHarnessInstallCommand(
  harness: string | HarnessInstallTarget,
  preferredInstallMethod: string | null = null,
): string | null {
  const harnessId = typeof harness === "string" ? harness : harness.id;
  if (preferredInstallMethod === "mise") {
    const npmPackage = NPM_PACKAGE_NAMES[harnessId];
    if (npmPackage) {
      return `mise use -g npm:${npmPackage}`;
    }
  }

  // The backend picks the command for the host OS (Windows gets PowerShell
  // installers instead of curl | bash). The table covers id-only lookups and
  // hosts that do not send it.
  if (typeof harness !== "string" && harness.installCommandDisplay !== undefined) {
    return harness.installCommandDisplay;
  }

  return HARNESS_INSTALL_COMMANDS[harnessId] ?? null;
}

export function getHarnessTileAction(harness: HarnessInfo): HarnessTileAction | null {
  if (harness.found) {
    return "launch";
  }

  if (harness.canAutoInstall && getHarnessInstallCommand(harness)) {
    return "install";
  }

  if (harness.website) {
    return "manual";
  }

  return null;
}
