import { describe, expect, it } from "vitest";
import {
  resolveStartupSessionHarnessSelection,
  shouldShowStartupSplitPanelSize,
} from "./workspaceStartupUi";

describe("workspaceStartupUi", () => {
  it("enables harness autostart when an agent is selected", () => {
    expect(resolveStartupSessionHarnessSelection("codex")).toEqual({
      harnessId: "codex",
      launchHarnessOnCreate: true,
    });
  });

  it("clears harness autostart when plain terminal is selected", () => {
    expect(resolveStartupSessionHarnessSelection("")).toEqual({
      harnessId: null,
      launchHarnessOnCreate: false,
    });
  });

  it("shows the split size control only for split home screens", () => {
    expect(shouldShowStartupSplitPanelSize("split")).toBe(true);
    expect(shouldShowStartupSplitPanelSize("chat")).toBe(false);
    expect(shouldShowStartupSplitPanelSize("terminal")).toBe(false);
    expect(shouldShowStartupSplitPanelSize("editor")).toBe(false);
  });
});
