import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIpc = vi.hoisted(() => ({
  getHarnessLaunchArgs: vi.fn(),
  setHarnessLaunchArgs: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

import { useHarnessStore } from "./harnessStore";

describe("harnessStore launch args", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHarnessStore.setState({ launchArgs: {}, launchArgsLoaded: false });
  });

  it("does not report the stored flags as loaded before they arrive", () => {
    expect(useHarnessStore.getState().launchArgsLoaded).toBe(false);
    expect(useHarnessStore.getState().launchArgs.codex).toBeUndefined();
  });

  it("marks the flags loaded even when the backend read fails", async () => {
    mockIpc.getHarnessLaunchArgs.mockRejectedValueOnce(new Error("nope"));

    await useHarnessStore.getState().loadLaunchArgs();

    expect(useHarnessStore.getState().launchArgsLoaded).toBe(true);
  });

  it("drops the stored flags when an empty value is saved", async () => {
    mockIpc.getHarnessLaunchArgs.mockResolvedValueOnce({ codex: "--yolo" });
    await useHarnessStore.getState().loadLaunchArgs();
    expect(useHarnessStore.getState().launchArgs.codex).toBe("--yolo");

    // Saving before the read resolves is what the modal has to prevent: an
    // empty field deletes the flags the user already had.
    mockIpc.setHarnessLaunchArgs.mockResolvedValueOnce("");
    await useHarnessStore.getState().saveLaunchArgs("codex", "");

    expect(useHarnessStore.getState().launchArgs.codex).toBeUndefined();
  });
});
