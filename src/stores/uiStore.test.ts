import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_PALETTE_DEFAULT_LAUNCH } from "../lib/commandPalette";

type UiStoreModule = typeof import("./uiStore");

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

describe("uiStore focus mode", () => {
  let useUiStore: UiStoreModule["useUiStore"];

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageStub());
    ({ useUiStore } = await import("./uiStore"));
    useUiStore.setState({
      showSidebar: true,
      sidebarPinned: true,
      showGitPanel: true,
      gitPanelPinned: true,
      showExplorer: true,
      focusMode: false,
      focusModeSnapshot: null,
      activeView: "chat",
      settingsWorkspaceId: null,
      commandPaletteOpen: false,
      commandPaletteLaunch: COMMAND_PALETTE_DEFAULT_LAUNCH,
      messageFocusTarget: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures the current shell state and hides the left sidebar on entry", () => {
    useUiStore.getState().setFocusMode(true);

    expect(useUiStore.getState()).toMatchObject({
      focusMode: true,
      showSidebar: false,
      showGitPanel: true,
      focusModeSnapshot: {
        showSidebar: true,
        showGitPanel: true,
      },
    });
  });

  it("keeps sidebar and git toggles working while focus mode is active", () => {
    const state = useUiStore.getState();

    state.setFocusMode(true);
    state.toggleSidebar();
    state.toggleGitPanel();

    expect(useUiStore.getState()).toMatchObject({
      focusMode: true,
      showSidebar: true,
      showGitPanel: false,
    });
  });

  it("restores the pre-focus shell state when leaving focus mode", () => {
    useUiStore.setState({
      showSidebar: true,
      showGitPanel: false,
      gitPanelPinned: true,
      focusMode: false,
      focusModeSnapshot: null,
    });

    const state = useUiStore.getState();
    state.setFocusMode(true);
    state.toggleSidebar();
    state.toggleGitPanel();
    state.toggleFocusMode();

    expect(useUiStore.getState()).toMatchObject({
      focusMode: false,
      showSidebar: true,
      showGitPanel: false,
      focusModeSnapshot: null,
    });
  });

  it("does not overwrite the original snapshot on repeated activation", () => {
    useUiStore.setState({
      showSidebar: false,
      showGitPanel: true,
      gitPanelPinned: false,
      focusMode: false,
      focusModeSnapshot: null,
    });

    const state = useUiStore.getState();
    state.setFocusMode(true);
    state.toggleGitPanel();
    state.setFocusMode(true);
    state.setFocusMode(false);

    expect(useUiStore.getState()).toMatchObject({
      focusMode: false,
      showSidebar: false,
      showGitPanel: true,
      gitPanelPinned: false,
      focusModeSnapshot: null,
    });
  });

  it("keeps git pin state separate from visibility toggles", () => {
    const state = useUiStore.getState();

    state.setGitPanelPinned(false);
    state.toggleGitPanel();
    state.toggleGitPanel();

    expect(useUiStore.getState()).toMatchObject({
      showGitPanel: true,
      gitPanelPinned: false,
    });
  });

  it("persists git pin state changes and forces the panel visible", () => {
    const storage = globalThis.localStorage as unknown as ReturnType<typeof createStorageStub>;
    const state = useUiStore.getState();

    useUiStore.setState({ showGitPanel: false, gitPanelPinned: true });
    state.toggleGitPanelPin();

    expect(storage.setItem).toHaveBeenCalledWith("panes:gitPanelPinned", "false");
    expect(useUiStore.getState()).toMatchObject({
      showGitPanel: true,
      gitPanelPinned: false,
    });
  });

  it("persists explicit explorer visibility changes", () => {
    const storage = globalThis.localStorage as unknown as ReturnType<typeof createStorageStub>;

    useUiStore.getState().setExplorerOpen(false);

    expect(storage.setItem).toHaveBeenCalledWith("panes:explorerOpen", "false");
    expect(useUiStore.getState().showExplorer).toBe(false);
  });

  it("opens the command palette with structured launch defaults", () => {
    useUiStore.getState().openCommandPalette({ variant: "search", initialQuery: "?", searchScope: "threads" });

    expect(useUiStore.getState()).toMatchObject({
      commandPaletteOpen: true,
      commandPaletteLaunch: {
        variant: "search",
        initialQuery: "?",
        searchScope: "threads",
      },
    });
  });

  it("resets command palette launch state when closing", () => {
    const state = useUiStore.getState();
    state.openCommandPalette({ variant: "search", initialQuery: "?", searchScope: "files" });
    state.closeCommandPalette();

    expect(useUiStore.getState()).toMatchObject({
      commandPaletteOpen: false,
      commandPaletteLaunch: COMMAND_PALETTE_DEFAULT_LAUNCH,
    });
  });
});
