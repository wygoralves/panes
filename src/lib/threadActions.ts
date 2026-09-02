import { t } from "../i18n";
import { useChatStore } from "../stores/chatStore";
import { useSidebarListModeStore } from "../stores/sidebarListModeStore";
import { useSidebarViewStore } from "../stores/sidebarViewStore";
import { useThreadReadStore } from "../stores/threadReadStore";
import { useThreadStore } from "../stores/threadStore";
import { toast } from "../stores/toastStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Thread } from "../types";

/** Settling is a manual act, so it is blocked exactly where the row button is
 * blocked: while the engine still owns the thread. */
export function canSettleThread(thread: Thread): boolean {
  return thread.status !== "streaming" && thread.status !== "awaiting_approval";
}

export function getActiveThread(): Thread | null {
  const state = useThreadStore.getState();
  return state.threads.find((thread) => thread.id === state.activeThreadId) ?? null;
}

/** Open the section a thread lives in, so a selection made from outside the
 * sidebar can never land on a row the list is not showing. */
export function revealThreadInSidebar(thread: Thread): void {
  const view = useSidebarViewStore.getState();

  if (useSidebarListModeStore.getState().mode === "status") {
    if (thread.settledAt && view.settledCollapsed) {
      view.setSettledCollapsed(false);
    }
    return;
  }

  view.expandProject(thread.workspaceId);
}

/** Open a thread from outside the sidebar: keyboard jump, palette, toast. */
export async function activateThread(thread: Thread): Promise<void> {
  revealThreadInSidebar(thread);

  const uiStore = useUiStore.getState();
  if (uiStore.activeView !== "chat") {
    uiStore.setActiveView("chat");
  }

  const workspaceStore = useWorkspaceStore.getState();
  if (thread.workspaceId !== workspaceStore.activeWorkspaceId) {
    await workspaceStore.setActiveWorkspace(thread.workspaceId);
  }
  useWorkspaceStore
    .getState()
    .setActiveRepo(thread.repoId ?? null, { remember: false });

  useThreadStore.getState().setActiveThread(thread.id);
  await useChatStore.getState().setActiveThread(thread.id);
}

export async function settleThreadWithUndo(thread: Thread): Promise<boolean> {
  const settled = await useThreadStore.getState().settleThread(thread.id);
  if (!settled) {
    toast.error(t("app:sidebar.settleThreadFailed"));
    return false;
  }

  toast.success(t("app:sidebar.threadSettled"), {
    action: {
      label: t("app:sidebar.undo"),
      onClick: () => {
        void useThreadStore
          .getState()
          .unsettleThread(thread.id, { unsettledAt: thread.unsettledAt ?? null });
      },
    },
  });
  return true;
}

export async function unsettleThreadWithUndo(thread: Thread): Promise<boolean> {
  const unsettled = await useThreadStore.getState().unsettleThread(thread.id);
  if (!unsettled) {
    toast.error(t("app:sidebar.unsettleThreadFailed"));
    return false;
  }

  toast.success(t("app:sidebar.threadUnsettled"), {
    action: {
      label: t("app:sidebar.undo"),
      onClick: () => {
        void useThreadStore
          .getState()
          .settleThread(thread.id, { settledAt: thread.settledAt ?? null });
      },
    },
  });
  return true;
}

/** Toggle settlement for a thread, refusing while the engine is still busy. */
export async function toggleThreadSettlement(thread: Thread): Promise<boolean> {
  if (thread.settledAt) {
    return unsettleThreadWithUndo(thread);
  }
  if (!canSettleThread(thread)) {
    toast.info(t("app:sidebar.settleUnavailable"));
    return false;
  }
  return settleThreadWithUndo(thread);
}

/** Unread describes a completion the user has not come back to, so only a
 * completed thread can be sent back to it. */
export function canMarkThreadUnread(thread: Thread): boolean {
  return thread.status === "completed";
}

/** Put a finished thread back in the unread state so it keeps asking for
 * attention. */
export function markThreadUnread(thread: Thread): boolean {
  if (!canMarkThreadUnread(thread)) {
    toast.info(t("app:sidebar.markUnreadUnavailable"));
    return false;
  }

  useThreadReadStore.getState().markThreadUnread(thread.id, thread.lastActivityAt);
  return true;
}
