import type { MouseEvent } from "react";
import { t } from "../i18n";
import { ipc } from "./ipc";
import { useFileStore } from "../stores/fileStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUiStore } from "../stores/uiStore";
import { toast } from "../stores/toastStore";

export interface EditorFileReferenceContext {
  workspaceId: string | null;
  preferredRepoPath?: string | null;
  currentCwd?: string | null;
}

export async function openEditorFileReference(
  rawReference: string,
  context: EditorFileReferenceContext,
): Promise<boolean> {
  if (!context.workspaceId) {
    return false;
  }

  const resolved = await ipc.resolveEditorFileReference(
    context.workspaceId,
    rawReference,
    context.preferredRepoPath,
    context.currentCwd,
  );
  if (!resolved) {
    toast.warning(t("common:fileReferences.resolveFailed", { reference: rawReference }));
    return false;
  }

  await useFileStore.getState().openFile(resolved.repoPath, resolved.filePath);
  useUiStore.getState().setExplorerOpen(false);
  await useTerminalStore.getState().setLayoutMode(context.workspaceId, "editor");
  return true;
}

export function handleEditorFileReferenceClick(
  event: MouseEvent<HTMLElement>,
  rawReference: string,
  context: EditorFileReferenceContext,
): void {
  event.preventDefault();
  if (!event.shiftKey) {
    return;
  }
  void openEditorFileReference(rawReference, context);
}
