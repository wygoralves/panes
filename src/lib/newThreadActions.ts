import { t } from "../i18n";
import { useChatStore } from "../stores/chatStore";
import { useSidebarListModeStore } from "../stores/sidebarListModeStore";
import { useSidebarViewStore } from "../stores/sidebarViewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useThreadStore } from "../stores/threadStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { resolveNewThreadTargetLayoutMode } from "./newThreadLayout";
import {
  applyWorkspaceLayoutMode,
  getWorkspacePaneLayoutMode,
} from "./workspacePaneNavigation";

/** The project a new thread belongs to. While the status list is filtered to
 * one project, that filter is the user's stated scope, so the new thread is
 * created there instead of in the last opened project. */
export function resolveNewThreadWorkspaceId(): string | null {
  const workspaceStore = useWorkspaceStore.getState();
  const filterId = useSidebarViewStore.getState().projectFilterId;
  const isStatusMode = useSidebarListModeStore.getState().mode === "status";

  if (
    isStatusMode &&
    filterId &&
    workspaceStore.workspaces.some((workspace) => workspace.id === filterId)
  ) {
    return filterId;
  }

  return workspaceStore.activeWorkspaceId;
}

export async function createAndActivateWorkspaceThread(
  workspaceId: string | null | undefined,
): Promise<string | null> {
  if (!workspaceId) {
    return null;
  }

  const workspaceStore = useWorkspaceStore.getState();
  const activeWorkspaceId = workspaceStore.activeWorkspaceId;
  const terminalStore = useTerminalStore.getState();
  const currentLayoutMode =
    (activeWorkspaceId ? getWorkspacePaneLayoutMode(activeWorkspaceId) : null) ??
    (activeWorkspaceId
      ? terminalStore.workspaces[activeWorkspaceId]?.layoutMode
      : terminalStore.workspaces[workspaceId]?.layoutMode) ?? null;
  const targetLayoutMode = resolveNewThreadTargetLayoutMode(currentLayoutMode);

  useUiStore.getState().setActiveView("chat");

  if (activeWorkspaceId !== workspaceId) {
    await workspaceStore.setActiveWorkspace(workspaceId);
  }

  applyWorkspaceLayoutMode(workspaceId, targetLayoutMode);
  useWorkspaceStore.getState().setActiveRepo(null, { remember: false });

  const threadId = await useThreadStore.getState().createThread({
    workspaceId,
    repoId: null,
    title: t("app:sidebar.newThreadTitle"),
  });

  if (!threadId) {
    return null;
  }

  await useChatStore.getState().setActiveThread(threadId);
  return threadId;
}
