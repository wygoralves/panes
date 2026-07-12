import { beforeEach, describe, expect, it, vi } from "vitest";

const updaterMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: updaterMocks.check,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: updaterMocks.relaunch,
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
  });

  it("tracks determinate download progress before installation", async () => {
    const downloadAndInstall = vi.fn(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      onEvent({ event: "Progress", data: { chunkLength: 600 } });
      onEvent({ event: "Finished" });
    });
    updaterMocks.check.mockResolvedValue({ downloadAndInstall });

    await useUpdateStore.getState().downloadAndInstall();

    expect(downloadAndInstall).toHaveBeenCalledOnce();
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
      downloadAndInstall: async (onEvent: (event: unknown) => void) => {
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
