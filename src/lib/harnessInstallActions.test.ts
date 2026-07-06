import { describe, expect, it } from "vitest";
import {
  getHarnessInstallCommand,
  getHarnessTileAction,
} from "./harnessInstallActions";
import type { HarnessInfo } from "../types";

const baseHarness: HarnessInfo = {
  id: "codex",
  name: "Codex CLI",
  description: "Harness",
  command: "codex",
  found: false,
  version: null,
  path: null,
  canAutoInstall: false,
  website: "https://example.com",
  native: false,
};

describe("harness install actions", () => {
  it("keeps installed harnesses in launch mode", () => {
    expect(getHarnessTileAction({
      ...baseHarness,
      found: true,
    })).toBe("launch");
  });

  it("uses install mode only when backend allows auto install", () => {
    expect(getHarnessTileAction({
      ...baseHarness,
      canAutoInstall: true,
    })).toBe("install");
  });

  it("falls back to manual mode when backend disallows a scripted install", () => {
    expect(getHarnessTileAction({
      ...baseHarness,
      id: "kiro",
      command: "kiro-cli",
      canAutoInstall: false,
    })).toBe("manual");
    expect(getHarnessInstallCommand("kiro")).toContain("bash");
  });

  it("falls back to manual mode when the frontend has no known install command", () => {
    expect(getHarnessTileAction({
      ...baseHarness,
      id: "unknown-harness",
      canAutoInstall: true,
    })).toBe("manual");
  });

  it("uses the published npm package name for OpenCode", () => {
    expect(getHarnessInstallCommand("opencode")).toBe(
      "npm install -g opencode-ai",
    );
  });

  it("prefers mise for npm-packaged harnesses when it is the preferred install method", () => {
    expect(getHarnessInstallCommand("codex", "mise")).toBe(
      "mise use -g npm:@openai/codex",
    );
    expect(getHarnessInstallCommand("opencode", "mise")).toBe(
      "mise use -g npm:opencode-ai",
    );
  });

  it("leaves curl-pipe installers unchanged even when mise is preferred", () => {
    expect(getHarnessInstallCommand("kiro", "mise")).toContain("bash");
  });

  it("falls back to npm when no preferred install method is given", () => {
    expect(getHarnessInstallCommand("codex")).toBe("npm install -g @openai/codex");
    expect(getHarnessInstallCommand("codex", null)).toBe("npm install -g @openai/codex");
  });
});
