import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSetLayoutMode = vi.hoisted(() => vi.fn());
const terminalWorkspaces = vi.hoisted(() => (
  {} as Record<string, { layoutMode: string }>
));

vi.mock("../stores/terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({
      workspaces: terminalWorkspaces,
      setLayoutMode: mockSetLayoutMode,
    }),
  },
}));

import {
  collectWorkspacePaneLeaves,
  getWorkspacePaneActiveTab,
  useWorkspacePaneStore,
} from "../stores/workspacePaneStore";
import { useUiStore } from "../stores/uiStore";
import { showWorkspaceEditorForFileLink } from "./workspacePaneNavigation";

describe("showWorkspaceEditorForFileLink", () => {
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
    useUiStore.setState({ activeView: "harnesses" });
    mockSetLayoutMode.mockClear();
    for (const key of Object.keys(terminalWorkspaces)) {
      delete terminalWorkspaces[key];
    }
  });

  it("opens an editor split next to a chat-only focused pane", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");
    const sourceLeaf = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0];

    showWorkspaceEditorForFileLink("ws-1");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(layout.root.type).toBe("split");
    expect(layout.root.type === "split" ? layout.root.direction : null).toBe("vertical");
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "chat",
      "editor",
    ]);
    expect(leaves[0].id).toBe(sourceLeaf.id);
    expect(layout.focusedLeafId).toBe(leaves[1].id);
    expect(useUiStore.getState().activeView).toBe("chat");
    expect(mockSetLayoutMode).toHaveBeenCalledWith("ws-1", "editor");
  });

  it("opens an editor split next to a terminal-only focused pane", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "terminal");

    showWorkspaceEditorForFileLink("ws-1");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(layout.root.type).toBe("split");
    expect(layout.root.type === "split" ? layout.root.direction : null).toBe("vertical");
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "terminal",
      "editor",
    ]);
    expect(mockSetLayoutMode).toHaveBeenCalledWith("ws-1", "split");
  });

  it("opens an editor split from the source pane when focus is elsewhere", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "split");
    const leaves = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    );
    const chatLeaf = leaves.find((leaf) => getWorkspacePaneActiveTab(leaf)?.kind === "chat");
    const terminalLeaf = leaves.find((leaf) => getWorkspacePaneActiveTab(leaf)?.kind === "terminal");
    if (!chatLeaf || !terminalLeaf) {
      throw new Error("expected chat and terminal leaves");
    }
    useWorkspacePaneStore.getState().focusLeaf("ws-1", chatLeaf.id);

    showWorkspaceEditorForFileLink("ws-1", terminalLeaf.id);

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const nextLeaves = collectWorkspacePaneLeaves(layout.root);
    expect(nextLeaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "chat",
      "terminal",
      "editor",
    ]);
    expect(nextLeaves[1].id).toBe(terminalLeaf.id);
    expect(layout.focusedLeafId).toBe(nextLeaves[2].id);
  });

  it("materializes a missing terminal layout before opening the editor split", () => {
    terminalWorkspaces["ws-1"] = { layoutMode: "terminal" };

    showWorkspaceEditorForFileLink("ws-1");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "terminal",
      "editor",
    ]);
  });

  it("moves a hidden editor tab into a split instead of flipping the terminal pane", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "terminal");
    const sourceLeaf = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0];
    useWorkspacePaneStore.getState().showSurface("ws-1", "editor", sourceLeaf.id);
    const terminalTab = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0].tabs.find((tab) => tab.kind === "terminal");
    if (!terminalTab) {
      throw new Error("expected terminal tab");
    }
    useWorkspacePaneStore.getState().setActiveTab("ws-1", sourceLeaf.id, terminalTab.id);

    showWorkspaceEditorForFileLink("ws-1", sourceLeaf.id);

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "terminal",
      "editor",
    ]);
    expect(leaves[0].id).toBe(sourceLeaf.id);
  });

  it("uses an already visible editor instead of moving the source pane", () => {
    useWorkspacePaneStore.getState().ensureWorkspace("ws-1", "chat");
    const sourceLeaf = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    )[0];
    useWorkspacePaneStore.getState().splitLeaf("ws-1", sourceLeaf.id, "vertical", "editor");
    const splitLeaves = collectWorkspacePaneLeaves(
      useWorkspacePaneStore.getState().workspaces["ws-1"].root,
    );
    const chatLeaf = splitLeaves.find((leaf) => getWorkspacePaneActiveTab(leaf)?.kind === "chat");
    const editorLeaf = splitLeaves.find((leaf) => getWorkspacePaneActiveTab(leaf)?.kind === "editor");
    if (!chatLeaf || !editorLeaf) {
      throw new Error("expected chat and editor leaves");
    }
    useWorkspacePaneStore.getState().focusLeaf("ws-1", chatLeaf.id);

    showWorkspaceEditorForFileLink("ws-1");

    const layout = useWorkspacePaneStore.getState().workspaces["ws-1"];
    const leaves = collectWorkspacePaneLeaves(layout.root);
    expect(leaves.map((leaf) => getWorkspacePaneActiveTab(leaf)?.kind)).toEqual([
      "chat",
      "editor",
    ]);
    expect(layout.focusedLeafId).toBe(editorLeaf.id);
  });
});
