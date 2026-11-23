import { beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  confirmDiscardUnsavedWork: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: updaterMocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: updaterMocks.relaunch,
}));

vi.mock("../lib/unsavedChangesGuard", () => ({
  confirmDiscardUnsavedWork: updaterMocks.confirmDiscardUnsavedWork,
}));

import { useUpdateStore } from "./updateStore";

describe("updateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUpdateStore.setState({
      status: "idle",
      version: null,
      error: null,
      lastCheckedAt: null,
      downloadPhase: "idle",
      downloadedBytes: 0,
      totalBytes: null,
      snoozed: false,
    });
    updaterMocks.relaunch.mockResolvedValue(undefined);
    updaterMocks.confirmDiscardUnsavedWork.mockResolvedValue(true);
  });

  it("asks about unsaved editor changes after the download and before installing", async () => {
    const install = vi.fn();
    const close = vi.fn();
    const download = vi.fn(async () => {
      expect(updaterMocks.confirmDiscardUnsavedWork).not.toHaveBeenCalled();
    });
    updaterMocks.check.mockResolvedValue({ download, install, close });
    updaterMocks.confirmDiscardUnsavedWork.mockResolvedValue(false);

    await useUpdateStore.getState().downloadAndInstall();

    expect(download).toHaveBeenCalledOnce();
    expect(updaterMocks.confirmDiscardUnsavedWork).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(updaterMocks.relaunch).not.toHaveBeenCalled();
    expect(useUpdateStore.getState()).toMatchObject({ status: "available", downloadPhase: "idle" });
  });

  it("asks again after installing and holds the relaunch when edits made meanwhile are kept", async () => {
    const install = vi.fn(async () => {
      expect(updaterMocks.confirmDiscardUnsavedWork).toHaveBeenCalledOnce();
    });
    updaterMocks.check.mockResolvedValue({ download: vi.fn(), install, close: vi.fn() });
    updaterMocks.confirmDiscardUnsavedWork
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await useUpdateStore.getState().downloadAndInstall();

    expect(install).toHaveBeenCalledOnce();
    expect(updaterMocks.confirmDiscardUnsavedWork).toHaveBeenCalledTimes(2);
    expect(updaterMocks.relaunch).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("ready");
  });

  it("releases the downloaded update when installing fails", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    updaterMocks.check.mockResolvedValue({
      download: vi.fn(),
      install: vi.fn().mockRejectedValue(new Error("install failed")),
      close,
    });

    await useUpdateStore.getState().downloadAndInstall();

    expect(close).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState()).toMatchObject({ status: "error", error: "install failed" });
  });

  it("tracks determinate download progress before installation", async () => {
    const install = vi.fn();
    const download = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      onEvent({ event: "Progress", data: { chunkLength: 600 } });
      onEvent({ event: "Finished" });
    });
    updaterMocks.check.mockResolvedValue({ download, install });

    await useUpdateStore.getState().downloadAndInstall();

    expect(download).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
    expect(useUpdateStore.getState()).toMatchObject({
      status: "ready",
      downloadPhase: "installing",
      downloadedBytes: 1000,
      totalBytes: 1000,
    });
    expect(updaterMocks.relaunch).toHaveBeenCalledOnce();
  });

  it("tracks bytes when the server does not provide a total size", async () => {
    updaterMocks.check.mockResolvedValue({
      install: vi.fn(),
      download: async (onEvent: (event: unknown) => void) => {
        onEvent({ event: "Started", data: {} });
        onEvent({ event: "Progress", data: { chunkLength: 256 } });
        onEvent({ event: "Finished" });
      },
    });

    await useUpdateStore.getState().downloadAndInstall();

    expect(useUpdateStore.getState()).toMatchObject({
      status: "ready",
      downloadPhase: "installing",
      downloadedBytes: 256,
      totalBytes: null,
    });
  });
});
