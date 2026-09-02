import { t } from "../i18n";
import { isDraftThread } from "../components/sidebar/statusGrouping";
import { useChatStore } from "../stores/chatStore";
import { hasDraftContent, useComposerDraftStore } from "../stores/composerDraftStore";
import { useSidebarListModeStore } from "../stores/sidebarListModeStore";
import { useSidebarViewStore } from "../stores/sidebarViewStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useThreadStore } from "../stores/threadStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Thread } from "../types";
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

/** An untouched draft in the target project is reused instead of stacking a
 * second empty thread next to it. A draft the user has typed into is theirs:
 * new thread leaves it alone and starts fresh. */
export function findReusableDraftThread(threads: Thread[]): Thread | null {
  const prompts = useComposerDraftStore.getState().promptByThread;
  return (
    threads.find((thread) => isDraftThread(thread) && !hasDraftContent(prompts[thread.id])) ??
    null
  );
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

  const reusable = findReusableDraftThread(
    useThreadStore.getState().threadsByWorkspace[workspaceId] ?? [],
  );
  const threadId =
    reusable?.id ??
    (await useThreadStore.getState().createThread({
      workspaceId,
      repoId: null,
      title: t("app:sidebar.newThreadTitle"),
    }));

  if (!threadId) {
    return null;
  }

  if (reusable) {
    useThreadStore.getState().setActiveThread(reusable.id);
  }
  await useChatStore.getState().setActiveThread(threadId);
  return threadId;
}
