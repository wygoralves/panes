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

export type HarnessTileAction = "launch" | "install" | "manual";

export function getHarnessInstallCommand(harnessId: string): string | null {
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
