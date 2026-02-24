import { describe, expect, it, beforeEach, vi } from "vitest";

// Stub localStorage before any module imports that use it
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

// Import after localStorage is available
const { useUiStore } = await import("../src/stores/uiStore");

beforeEach(() => {
  storage.clear();
  useUiStore.setState({
    showSidebar: true,
    sidebarPinned: true,
    showGitPanel: true,
    searchOpen: false,
    activeView: "chat",
    messageFocusTarget: null,
  });
});

describe("useUiStore", () => {
  it("has correct initial state", () => {
    const state = useUiStore.getState();
    expect(state.showSidebar).toBe(true);
    expect(state.showGitPanel).toBe(true);
    expect(state.searchOpen).toBe(false);
    expect(state.activeView).toBe("chat");
    expect(state.messageFocusTarget).toBeNull();
  });

  it("toggleSidebar flips showSidebar", () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().showSidebar).toBe(false);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().showSidebar).toBe(true);
  });

  it("toggleSidebarPin flips sidebarPinned and persists to localStorage", () => {
    useUiStore.getState().toggleSidebarPin();
    expect(useUiStore.getState().sidebarPinned).toBe(false);
    expect(storage.get("panes:sidebarPinned")).toBe("false");
    expect(useUiStore.getState().showSidebar).toBe(true);
  });

  it("setSidebarPinned sets specific value and persists", () => {
    useUiStore.getState().setSidebarPinned(false);
    expect(useUiStore.getState().sidebarPinned).toBe(false);
    expect(storage.get("panes:sidebarPinned")).toBe("false");
    expect(useUiStore.getState().showSidebar).toBe(true);
  });

  it("toggleGitPanel flips showGitPanel", () => {
    useUiStore.getState().toggleGitPanel();
    expect(useUiStore.getState().showGitPanel).toBe(false);
    useUiStore.getState().toggleGitPanel();
    expect(useUiStore.getState().showGitPanel).toBe(true);
  });

  it("setSearchOpen sets searchOpen state", () => {
    useUiStore.getState().setSearchOpen(true);
    expect(useUiStore.getState().searchOpen).toBe(true);
    useUiStore.getState().setSearchOpen(false);
    expect(useUiStore.getState().searchOpen).toBe(false);
  });

  it("setActiveView changes active view", () => {
    useUiStore.getState().setActiveView("harnesses");
    expect(useUiStore.getState().activeView).toBe("harnesses");
  });

  it("setMessageFocusTarget sets target with timestamp", () => {
    const before = Date.now();
    useUiStore.getState().setMessageFocusTarget({
      threadId: "t1",
      messageId: "m1",
    });
    const after = Date.now();

    const target = useUiStore.getState().messageFocusTarget;
    expect(target).not.toBeNull();
    expect(target!.threadId).toBe("t1");
    expect(target!.messageId).toBe("m1");
    expect(target!.requestedAt).toBeGreaterThanOrEqual(before);
    expect(target!.requestedAt).toBeLessThanOrEqual(after);
  });

  it("clearMessageFocusTarget resets target to null", () => {
    useUiStore.getState().setMessageFocusTarget({
      threadId: "t1",
      messageId: "m1",
    });
    useUiStore.getState().clearMessageFocusTarget();
    expect(useUiStore.getState().messageFocusTarget).toBeNull();
  });
});
