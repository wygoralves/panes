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
});
