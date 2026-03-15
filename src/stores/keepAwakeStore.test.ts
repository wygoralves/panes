import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIpc = vi.hoisted(() => ({
  getKeepAwakeState: vi.fn(),
  setKeepAwakeEnabled: vi.fn(),
  getPowerSettings: vi.fn(),
  setPowerSettings: vi.fn(),
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

import { canToggleKeepAwake, useKeepAwakeStore } from "./keepAwakeStore";

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    void rej;
  });
  return { promise, resolve };
}

describe("keepAwakeStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageStub());
    useKeepAwakeStore.setState({
      state: null,
      loading: false,
      loadedOnce: false,
      powerSettingsLoading: false,
      powerSettingsLoaded: false,
      powerSettings: null,
      powerSettingsOpen: false,
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

  it("warns when keep awake enables without closed-display protection", async () => {
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
      supportsClosedDisplay: false,
      closedDisplayActive: false,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(result?.enabled).toBe(true);
    expect(result?.supportsClosedDisplay).toBe(false);
    expect(result?.closedDisplayActive).toBe(false);
    expect(mockToast.warning).toHaveBeenCalledWith(
      "app:commandPalette.toasts.keepAwakeEnabledLimited",
    );
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

  it("treats unsupported disabled keep awake as unavailable", () => {
    expect(
      canToggleKeepAwake({
        supported: false,
        enabled: false,
        active: false,
        message: "unsupported",
      }),
    ).toBe(false);
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

  it("disables keep awake when preference is enabled but runtime is inactive", async () => {
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
      enabled: false,
      active: false,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(mockIpc.setKeepAwakeEnabled).toHaveBeenCalledWith(false);
    expect(result).toMatchObject({
      enabled: false,
      active: false,
    });
    expect(mockToast.success).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeDisabled");

  });

  it("allows disabling an enabled preference even when support disappears", async () => {
    useKeepAwakeStore.setState({
      state: {
        supported: false,
        enabled: true,
        active: false,
        message: "unsupported",
      },
      loading: false,
      loadedOnce: true,
    });
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: false,
      enabled: false,
      active: false,
      message: "unsupported",
    });

    const result = await useKeepAwakeStore.getState().toggle();

    expect(mockIpc.setKeepAwakeEnabled).toHaveBeenCalledWith(false);
    expect(result).toMatchObject({
      supported: false,
      enabled: false,
      active: false,
    });
    expect(mockToast.warning).toHaveBeenCalledWith("app:commandPalette.toasts.keepAwakeUnsupported");
  });

  it("waits for an in-flight load before toggling", async () => {
    const deferred = createDeferred<{
      supported: boolean;
      enabled: boolean;
      active: boolean;
      message: string | null;
    }>();
    mockIpc.getKeepAwakeState.mockReturnValue(deferred.promise);
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });

    const loadPromise = useKeepAwakeStore.getState().load();
    const togglePromise = useKeepAwakeStore.getState().toggle();

    expect(useKeepAwakeStore.getState().loading).toBe(true);
    expect(mockIpc.setKeepAwakeEnabled).not.toHaveBeenCalled();

    deferred.resolve({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });

    await loadPromise;
    const result = await togglePromise;

    expect(mockIpc.getKeepAwakeState).toHaveBeenCalledTimes(1);
    expect(mockIpc.setKeepAwakeEnabled).toHaveBeenCalledWith(true);
    expect(result).toMatchObject({
      enabled: true,
      active: true,
    });
  });

  it("does not let a stale refresh overwrite a newer toggle result", async () => {
    useKeepAwakeStore.setState({
      state: {
        supported: true,
        enabled: true,
        active: true,
        message: null,
      },
      loading: false,
      loadedOnce: true,
    });
    const refreshDeferred = createDeferred<{
      supported: boolean;
      enabled: boolean;
      active: boolean;
      message: string | null;
    }>();
    mockIpc.getKeepAwakeState.mockReturnValue(refreshDeferred.promise);
    mockIpc.setKeepAwakeEnabled.mockResolvedValue({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });

    const refreshPromise = useKeepAwakeStore.getState().refresh();
    const toggleResult = await useKeepAwakeStore.getState().toggle();

    refreshDeferred.resolve({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });
    await refreshPromise;

    expect(toggleResult).toMatchObject({
      enabled: false,
      active: false,
    });
    expect(useKeepAwakeStore.getState().state).toMatchObject({
      enabled: false,
      active: false,
    });
  });

  it("hides the keep awake command when the runtime is unsupported and disabled", async () => {
    const { getStaticCommands } = await import("../components/shared/CommandPalette");
    useKeepAwakeStore.setState({
      state: {
        supported: false,
        enabled: false,
        active: false,
        message: "unsupported",
      },
      loading: false,
      loadedOnce: true,
    });

    const command = getStaticCommands(((key: string) => key) as never, {
      keepAwakeAvailable: false,
    }).find(
      (entry) => entry.id === "toggle-keep-awake",
    );

    expect(command?.isAvailable?.({
      activeWorkspaceId: null,
      activeRepoPath: null,
      repos: [],
      close: () => {},
      openSubFlow: () => {},
    } as never)).toBe(false);
  });

  it("keeps the keep awake command available when a stale enabled preference needs disabling", async () => {
    const { getStaticCommands } = await import("../components/shared/CommandPalette");
    useKeepAwakeStore.setState({
      state: {
        supported: false,
        enabled: true,
        active: false,
        message: "unsupported",
      },
      loading: false,
      loadedOnce: true,
    });

    const command = getStaticCommands(((key: string) => key) as never, {
      keepAwakeAvailable: true,
    }).find(
      (entry) => entry.id === "toggle-keep-awake",
    );

    expect(command?.isAvailable?.({
      activeWorkspaceId: null,
      activeRepoPath: null,
      repos: [],
      close: () => {},
      openSubFlow: () => {},
    } as never)).toBe(true);
  });

  it("loadPowerSettings calls IPC and updates store", async () => {
    const settings = {
      keepAwakeEnabled: true,
      preventDisplaySleep: true,
      preventScreenSaver: false,
      acOnlyMode: true,
      batteryThreshold: 20,
      sessionDurationSecs: 3600,
      preventClosedDisplaySleep: false,
    };
    mockIpc.getPowerSettings.mockResolvedValue(settings);

    const result = await useKeepAwakeStore.getState().loadPowerSettings();

    expect(mockIpc.getPowerSettings).toHaveBeenCalled();
    expect(result).toEqual(settings);
    expect(useKeepAwakeStore.getState().powerSettings).toEqual(settings);
    expect(useKeepAwakeStore.getState().powerSettingsLoaded).toBe(true);
    expect(useKeepAwakeStore.getState().powerSettingsLoading).toBe(false);
  });

  it("loadPowerSettings returns null on failure", async () => {
    mockIpc.getPowerSettings.mockRejectedValue(new Error("ipc error"));

    const result = await useKeepAwakeStore.getState().loadPowerSettings();

    expect(result).toBeNull();
    expect(useKeepAwakeStore.getState().powerSettings).toBeNull();
    expect(useKeepAwakeStore.getState().powerSettingsLoaded).toBe(false);
    expect(useKeepAwakeStore.getState().powerSettingsLoading).toBe(false);
  });

  it("ignores stale power settings loads while a newer request is pending", async () => {
    const firstLoad = createDeferred<{
      keepAwakeEnabled: boolean;
      preventDisplaySleep: boolean;
      preventScreenSaver: boolean;
      acOnlyMode: boolean;
      batteryThreshold: number | null;
      sessionDurationSecs: number | null;
      preventClosedDisplaySleep: boolean;
    }>();
    const secondLoad = createDeferred<{
      keepAwakeEnabled: boolean;
      preventDisplaySleep: boolean;
      preventScreenSaver: boolean;
      acOnlyMode: boolean;
      batteryThreshold: number | null;
      sessionDurationSecs: number | null;
      preventClosedDisplaySleep: boolean;
    }>();
    mockIpc.getPowerSettings
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const firstPromise = useKeepAwakeStore.getState().loadPowerSettings();
    const secondPromise = useKeepAwakeStore.getState().loadPowerSettings();

    firstLoad.resolve({
      keepAwakeEnabled: false,
      preventDisplaySleep: false,
      preventScreenSaver: false,
      acOnlyMode: false,
      batteryThreshold: null,
      sessionDurationSecs: null,
      preventClosedDisplaySleep: false,
    });
    await firstPromise;

    expect(useKeepAwakeStore.getState().powerSettingsLoading).toBe(true);
    expect(useKeepAwakeStore.getState().powerSettingsLoaded).toBe(false);
    expect(useKeepAwakeStore.getState().powerSettings).toBeNull();

    const latestSettings = {
      keepAwakeEnabled: true,
      preventDisplaySleep: true,
      preventScreenSaver: false,
      acOnlyMode: true,
      batteryThreshold: 25,
      sessionDurationSecs: 3600,
      preventClosedDisplaySleep: false,
    };
    secondLoad.resolve(latestSettings);
    const secondResult = await secondPromise;

    expect(secondResult).toEqual(latestSettings);
    expect(useKeepAwakeStore.getState().powerSettings).toEqual(latestSettings);
    expect(useKeepAwakeStore.getState().powerSettingsLoaded).toBe(true);
    expect(useKeepAwakeStore.getState().powerSettingsLoading).toBe(false);
  });

  it("savePowerSettings calls IPC and updates both state and settings", async () => {
    const input = {
      keepAwakeEnabled: true,
      preventDisplaySleep: true,
      preventScreenSaver: true,
      acOnlyMode: false,
      batteryThreshold: null,
      sessionDurationSecs: 1800,
      preventClosedDisplaySleep: false,
    };
    mockIpc.setPowerSettings.mockResolvedValue({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });

    const result = await useKeepAwakeStore.getState().savePowerSettings(input);

    expect(mockIpc.setPowerSettings).toHaveBeenCalledWith(input);
    expect(result).toMatchObject({ enabled: true, active: true });
    expect(useKeepAwakeStore.getState().powerSettings).toEqual(input);
    expect(mockToast.success).toHaveBeenCalledWith("app:commandPalette.toasts.powerSettingsSaved");
  });

  it("does not let an in-flight refresh overwrite a saved power settings result", async () => {
    useKeepAwakeStore.setState({
      state: {
        supported: true,
        enabled: true,
        active: true,
        message: null,
      },
      loading: false,
      loadedOnce: true,
      powerSettingsLoading: false,
      powerSettingsLoaded: true,
      powerSettings: {
        keepAwakeEnabled: true,
        preventDisplaySleep: false,
        preventScreenSaver: false,
        acOnlyMode: false,
        batteryThreshold: null,
        sessionDurationSecs: null,
        preventClosedDisplaySleep: false,
      },
      powerSettingsOpen: false,
    });
    const saveDeferred = createDeferred<{
      supported: boolean;
      enabled: boolean;
      active: boolean;
      message: string | null;
    }>();
    const refreshDeferred = createDeferred<{
      supported: boolean;
      enabled: boolean;
      active: boolean;
      message: string | null;
    }>();
    mockIpc.setPowerSettings.mockReturnValue(saveDeferred.promise);
    mockIpc.getKeepAwakeState.mockReturnValue(refreshDeferred.promise);

    const input = {
      keepAwakeEnabled: false,
      preventDisplaySleep: true,
      preventScreenSaver: false,
      acOnlyMode: false,
      batteryThreshold: null,
      sessionDurationSecs: 1800,
      preventClosedDisplaySleep: false,
    };

    const savePromise = useKeepAwakeStore.getState().savePowerSettings(input);
    const refreshPromise = useKeepAwakeStore.getState().refresh();

    refreshDeferred.resolve({
      supported: true,
      enabled: true,
      active: true,
      message: null,
    });
    await refreshPromise;

    saveDeferred.resolve({
      supported: true,
      enabled: false,
      active: false,
      message: null,
    });
    await savePromise;

    expect(useKeepAwakeStore.getState().state).toMatchObject({
      enabled: false,
      active: false,
    });
    expect(useKeepAwakeStore.getState().powerSettings).toEqual(input);
  });

  it("savePowerSettings shows error toast on failure", async () => {
    mockIpc.setPowerSettings.mockRejectedValue(new Error("save failed"));

    await useKeepAwakeStore.getState().savePowerSettings({
      keepAwakeEnabled: true,
      preventDisplaySleep: false,
      preventScreenSaver: false,
      acOnlyMode: false,
      batteryThreshold: null,
      sessionDurationSecs: null,
      preventClosedDisplaySleep: false,
    });

    expect(mockToast.error).toHaveBeenCalledWith("app:commandPalette.toasts.powerSettingsSaveFailed");
  });

  it("openPowerSettings and closePowerSettings toggle state", () => {
    expect(useKeepAwakeStore.getState().powerSettingsOpen).toBe(false);

    useKeepAwakeStore.getState().openPowerSettings();
    expect(useKeepAwakeStore.getState().powerSettingsOpen).toBe(true);

    useKeepAwakeStore.getState().closePowerSettings();
    expect(useKeepAwakeStore.getState().powerSettingsOpen).toBe(false);
  });
});
