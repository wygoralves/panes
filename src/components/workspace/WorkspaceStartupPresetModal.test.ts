import { describe, expect, it } from "vitest";
import {
  canCommitWorkspaceStartupPresetLoad,
  serializeWorkspaceStartupPresetAsJson,
} from "./WorkspaceStartupPresetModal";

describe("WorkspaceStartupPresetModal helpers", () => {
  it("serializes stale presets to JSON without backend validation", () => {
    const raw = serializeWorkspaceStartupPresetAsJson({
      version: 1,
      defaultView: "chat",
      splitPanelSize: 32,
      terminal: {
        applyWhen: "no_live_sessions",
        groups: [
          {
            id: "g1",
            name: "Startup",
            sessions: [
              {
                id: "pane-1",
                cwd: "apps/missing",
                cwdBase: "workspace",
                harnessId: "codex",
                launchHarnessOnCreate: true,
              },
            ],
            root: { type: "leaf", sessionId: "pane-1" },
          },
        ],
        activeGroupId: "g1",
        focusedSessionId: "pane-1",
      },
    });

    expect(raw).toContain("\"cwd\": \"apps/missing\"");
    expect(raw).toContain("\"harnessId\": \"codex\"");
  });

  it("ignores stale modal load responses", () => {
    expect(canCommitWorkspaceStartupPresetLoad(2, 2, true)).toBe(true);
    expect(canCommitWorkspaceStartupPresetLoad(1, 2, true)).toBe(false);
    expect(canCommitWorkspaceStartupPresetLoad(2, 2, false)).toBe(false);
  });
});
