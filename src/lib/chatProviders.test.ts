import { describe, expect, it } from "vitest";
import { chatProviderSignInCommand, defaultChatProviderHomePath } from "./chatProviders";
import type { ChatProviderInstance } from "../types";

const base: ChatProviderInstance = {
  id: "claude_work",
  kind: "claude",
  displayName: "Work",
  binaryPath: null,
  homePath: "~/.claude-work",
  launchArgs: null,
  env: {},
  enabled: true,
  builtIn: false,
};

describe("chat provider helpers", () => {
  it("derives the default home directory from kind and slug", () => {
    expect(defaultChatProviderHomePath("codex", "work")).toBe("~/.codex-work");
  });

  it("builds the sign-in command with the instance environment", () => {
    expect(chatProviderSignInCommand(base)).toBe('CLAUDE_CONFIG_DIR="~/.claude-work" claude auth login');
    expect(
      chatProviderSignInCommand({
        ...base,
        id: "codex_work",
        kind: "codex",
        homePath: "/Users/me/codex work",
        binaryPath: "/opt/bin/codex",
        env: { OPENAI_BASE_URL: "http://x", CODEX_HOME: "ignored" },
      }),
    ).toBe('CODEX_HOME="/Users/me/codex work" OPENAI_BASE_URL="http://x" "/opt/bin/codex" login');
  });
});
