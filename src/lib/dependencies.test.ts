import { describe, expect, it } from "vitest";
import { normalizeDependencyReport } from "./dependencies";

describe("normalizeDependencyReport", () => {
  it("fills missing dependency entries with safe defaults", () => {
    expect(
      normalizeDependencyReport({
        codex: {
          found: true,
          version: "0.1.0",
          path: "/usr/local/bin/codex",
        },
      }),
    ).toEqual({
      node: {
        found: false,
        version: null,
        path: null,
        canAutoInstall: false,
        installMethod: null,
      },
      codex: {
        found: true,
        version: "0.1.0",
        path: "/usr/local/bin/codex",
        canAutoInstall: false,
        installMethod: null,
      },
      git: {
        found: false,
        version: null,
        path: null,
        canAutoInstall: false,
        installMethod: null,
      },
      platform: "unknown",
      packageManagers: [],
    });
  });

  it("keeps only valid package manager names from the payload", () => {
    const report = {
      platform: "linux",
      packageManagers: ["apt", 1, "npm", null],
    } as unknown as Parameters<typeof normalizeDependencyReport>[0];

    expect(
      normalizeDependencyReport(report),
    ).toEqual({
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
        found: false,
        version: null,
        path: null,
        canAutoInstall: false,
        installMethod: null,
      },
      platform: "linux",
      packageManagers: ["apt", "npm"],
    });
  });
});
