import { useTerminalStore, type LayoutMode } from "../stores/terminalStore";
import { useUiStore } from "../stores/uiStore";
import {
  collectWorkspacePaneLeaves,
  getWorkspacePaneActiveTab,
  useWorkspacePaneStore,
  type WorkspacePaneSurfaceKind,
} from "../stores/workspacePaneStore";

const TERMINAL_CYCLE: LayoutMode[] = ["chat", "split", "terminal"];

function syncTerminalLayoutMode(workspaceId: string): void {
  const mode = useWorkspacePaneStore.getState().workspaces[workspaceId]?.legacyMode;
  if (!mode) {
    return;
  }
  const terminalStore = useTerminalStore.getState();
  if (terminalStore.workspaces[workspaceId]?.layoutMode === mode) {
    return;
  }
  void terminalStore.setLayoutMode(workspaceId, mode);
}

export function showWorkspaceSurface(
  workspaceId: string,
  kind: WorkspacePaneSurfaceKind,
  leafId?: string | null,
): void {
  useUiStore.getState().setActiveView("chat");
  if (leafId == null) {
    useWorkspacePaneStore.getState().showSurface(workspaceId, kind);
  } else {
    useWorkspacePaneStore.getState().showSurface(workspaceId, kind, leafId);
  }
  syncTerminalLayoutMode(workspaceId);
}

export function applyWorkspaceLayoutMode(workspaceId: string, mode: LayoutMode): void {
  useUiStore.getState().setActiveView("chat");
  useWorkspacePaneStore.getState().applyLegacyLayoutMode(workspaceId, mode);
  syncTerminalLayoutMode(workspaceId);
}

export function getWorkspacePaneLayoutMode(workspaceId: string): LayoutMode | null {
  return useWorkspacePaneStore.getState().workspaces[workspaceId]?.legacyMode ?? null;
}

export function isWorkspaceSurfaceVisible(
  workspaceId: string,
  kind: WorkspacePaneSurfaceKind,
): boolean {
  const layout = useWorkspacePaneStore.getState().workspaces[workspaceId];
  if (!layout) {
    return false;
  }
  return collectWorkspacePaneLeaves(layout.root).some(
    (leaf) => getWorkspacePaneActiveTab(leaf)?.kind === kind,
  );
}

export function cycleWorkspaceTerminalLayout(workspaceId: string): void {
  const paneLayout = useWorkspacePaneStore.getState().workspaces[workspaceId];
  const terminalLayout = useTerminalStore.getState().workspaces[workspaceId]?.layoutMode ?? "chat";
  const currentMode = paneLayout?.legacyMode ?? terminalLayout;
  const currentIndex = TERMINAL_CYCLE.indexOf(currentMode);
  const nextMode = TERMINAL_CYCLE[(currentIndex + 1) % TERMINAL_CYCLE.length] ?? "chat";
  applyWorkspaceLayoutMode(workspaceId, nextMode);
}

export function toggleWorkspaceEditorLayout(workspaceId: string): void {
  const terminalWorkspace = useTerminalStore.getState().workspaces[workspaceId];
  const paneLayout = useWorkspacePaneStore.getState().workspaces[workspaceId];
  const currentMode = paneLayout?.legacyMode ?? terminalWorkspace?.layoutMode ?? "chat";
  applyWorkspaceLayoutMode(
    workspaceId,
    currentMode === "editor" ? terminalWorkspace?.preEditorLayoutMode ?? "chat" : "editor",
  );
}
