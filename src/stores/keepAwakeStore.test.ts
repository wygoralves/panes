import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIpc = vi.hoisted(() => ({
  getKeepAwakeState: vi.fn(),
  setKeepAwakeEnabled: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ipc: mockIpc,
}));

vi.mock("../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("./toastStore", () => ({
  toast: mockToast,
}));

import { useKeepAwakeStore } from "./keepAwakeStore";

function createStorageStub() {
  const storage = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

describe("keepAwakeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageStub());
    useKeepAwakeStore.setState({
      state: null,
      loading: false,
      loadedOnce: false,
    });
  });

  it("loads keep awake state from IPC", async () => {
    mockIpc.getKeepAwakeState.mockResolvedValue({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().load();

    expect(result).toEqual({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });
    expect(useKeepAwakeStore.getState()).toMatchObject({
      loadedOnce: true,
      loading: false,
    });
  });

  it("toggles keep awake and shows success toast on enable", async () => {
    mockIpc.getKeepAwakeState.mockResolvedValue({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(mockIpc.setKeepAwakeEnabled).toHaveBeenCalledWith(true);
    expect(result?.enabled).toBe(true);
    expect(mockToast.success).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeEnabled");
  });

  it("warns when keep awake is unsupported", async () => {
    mockIpc.getKeepAwakeState.mockResolvedValue({
      supported: false,
      enabled: false,
      active: false,
      message: "unsupported",
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(result?.supported).toBe(false);
    expect(mockIpc.setKeepAwakeEnabled).not.toHaveBeenCalled();
    expect(mockToast.warning).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeUnsupported");
  });

  it("shows an error toast when activation does not become active", async () => {
    mockIpc.getKeepAwakeState.mockResolvedValue({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: true,
      enabled: true,
      active: false,
      message: "failed",
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(result?.enabled).toBe(true);
    expect(result?.active).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeEnableFailed");
  });

  it("retries enable when preference is enabled but runtime is inactive", async () => {
    useKeepAwakeStore.setState({
      state: {
        supported: true,
        enabled: true,
        active: false,
        message: "failed",
      },
      loading: false,
      loadedOnce: true,
    });
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(mockIpc.setKeepAwakeEnabled).toHaveBeenCalledWith(true);
    expect(result).toMatchObject({
      enabled: true,
      active: true,
    });
    expect(mockToast.success).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeEnabled");
  });

  it("registers the keep awake command in the command palette", async () => {
    const { getStaticCommands } = await import("../components/shared/CommandPalette");

    const commands = getStaticCommands(((key: string) => key) as never);

    expect(commands.some((command) => command.id === "toggle-keep-awake")).toBe(true);
  });
});
