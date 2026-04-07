export function normalizeSidebarCollapsedState(
  workspaceIds: string[],
  activeWorkspaceId: string | null,
  previousCollapsed: Record<string, boolean>,
  previousActiveWorkspaceId: string | null,
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  const activeWorkspaceChanged = activeWorkspaceId !== previousActiveWorkspaceId;
  const hasActiveWorkspace =
    typeof activeWorkspaceId === "string" && workspaceIds.includes(activeWorkspaceId);

  if (activeWorkspaceChanged && hasActiveWorkspace && activeWorkspaceId) {
    for (const workspaceId of workspaceIds) {
      next[workspaceId] = workspaceId !== activeWorkspaceId;
    }
    return next;
  }

  for (const workspaceId of workspaceIds) {
    if (workspaceId in previousCollapsed) {
      next[workspaceId] = previousCollapsed[workspaceId];
      continue;
    }

    next[workspaceId] = hasActiveWorkspace ? workspaceId !== activeWorkspaceId : false;
  }

  return next;
}
