import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectWorkspacePaneLeaves,
  getWorkspacePaneActiveTab,
  useWorkspacePaneStore,
} from "./workspacePaneStore";

describe("workspacePaneStore", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
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
      key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
      get length() {
        return storage.size;
      },
    });
    useWorkspacePaneStore.setState({ workspaces: {} });
  });

  it("materializes legacy split mode as chat over terminal", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    expect(layout.legacyMode).toBe("split");
    expect(layout.root.type).toBe("split");
    expect(layout.root.type === "split" ? layout.root.direction : null).toBe("horizontal");

    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "chat",
      "terminal",
    ]);
  });

  it("splits the focused leaf with the next useful surface", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");
    const firstLeaf = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0];

    useWorkspacePaneStore.getState().splitLeaf("ws-1", firstLeaf.id, "vertical");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    expect(layout.legacyMode).toBe("split");
    expect(layout.root.type).toBe("split");
    expect(layout.root.type === "split" ? layout.root.direction : null).toBe("vertical");
    expect(collectWorkspacePaneLeaves(layout.root).map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "chat",
      "terminal",
    ]);
  });

  it("places dropped surfaces before the target leaf when requested", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");
    const firstLeaf = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0];

    useWorkspacePaneStore.getState().splitLeaf("ws-1", firstLeaf.id, "vertical", "editor", "before");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    expect(layout.root.type).toBe("split");
    expect(collectWorkspacePaneLeaves(layout.root).map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "editor",
      "chat",
    ]);
  });

  it("moves a singleton surface instead of duplicating it", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);

    useWorkspacePaneStore.getState().showSurface("ws-1", "chat", leaves[1].id);

    const nextLeaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);
    const chatLeafCount = nextLeaves.filter((leaf) =>
      leaf.tabs.some((tab) => tab.kind === "chat"),
    ).length;

    expect(chatLeafCount).toBe(1);
    expect(nextLeaves).toHaveLength(1);
    expect(getWorkspacePaneActiveTab(nextLeaves[0])?.kind).toBe("chat");
    expect(nextLeaves[0].tabs.some((tab) => tab.kind === "terminal")).toBe(true);
  });

  it("does not leave an empty pane when splitting with an existing surface", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);

    useWorkspacePaneStore.getState().splitLeaf("ws-1", leaves[0].id, "vertical", "terminal", "before");

    const nextLeaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);
    expect(nextLeaves).toHaveLength(2);
    expect(nextLeaves.every((leaf) => leaf.tabs.length > 0)).toBe(true);
    expect(nextLeaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "terminal",
      "chat",
    ]);
  });

  it("switches only the focused pane when activating a surface from the switcher", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);
    useWorkspacePaneStore.getState().focusLeaf("ws-1", leaves[0].id);

    useWorkspacePaneStore.getState().activateFocusedSurface("ws-1", "editor");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const nextLeaves = collectWorkspacePaneLeaves(layout.root);
    expect(nextLeaves).toHaveLength(2);
    expect(nextLeaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "editor",
      "terminal",
    ]);
    expect(layout.focusedLeafId).toBe(leaves[0].id);
  });

  it("swaps surfaces when the requested switcher surface is already in another pane", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);
    useWorkspacePaneStore.getState().focusLeaf("ws-1", leaves[0].id);

    useWorkspacePaneStore.getState().activateFocusedSurface("ws-1", "terminal");

    const nextLeaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);
    expect(nextLeaves).toHaveLength(2);
    expect(nextLeaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "terminal",
      "chat",
    ]);
  });

  it("collapses the tree when a leaf closes", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root);

    useWorkspacePaneStore.getState().closeLeaf("ws-1", leaves[1].id);

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    expect(layout.root.type).toBe("leaf");
    if (layout.root.type !== "leaf") {
      throw new Error("expected leaf root");
    }
    expect(getWorkspacePaneActiveTab(layout.root)?.kind).toBe("chat");
    expect(layout.legacyMode).toBe("chat");
  });

  it("persists layouts by workspace", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");
    const leaf = collectWorkspacePaneLeaves(useWorkspacePaneStore.getState().workspaces["ws-1"].root)[0];
    useWorkspacePaneStore.getState().splitLeaf("ws-1", leaf.id, "vertical", "editor");

    useWorkspacePaneStore.setState({ workspaces: {} });
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");

    const restored = useWorkspacePaneStore.getState().workspaces["ws-1"];
    expect(restored.root.type).toBe("split");
    expect(collectWorkspacePaneLeaves(restored.root).map((restoredLeaf) =>
      getWorkspacePaneActiveTab(restoredLeaf)?.kind,
    )).toEqual(["chat", "editor"]);
  });
});
