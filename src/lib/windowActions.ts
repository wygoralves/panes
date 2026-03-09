import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFileStore } from "../stores/fileStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

export function isLinuxDesktop(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("linux");
}

export async function closeCurrentWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function requestWindowClose(): Promise<void> {
  const wsId = useWorkspaceStore.getState().activeWorkspaceId;
  const wsState = wsId ? useTerminalStore.getState().workspaces[wsId] : undefined;
  const fileState = useFileStore.getState();

  if (wsState?.layoutMode === "editor" && fileState.activeTabId) {
    fileState.requestCloseTab(fileState.activeTabId);
    return;
  }

  await closeCurrentWindow();
}
