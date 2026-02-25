interface TerminalBootstrapDecisionInput {
  listenersReady: boolean;
  isOpen: boolean;
  layoutMode: "chat" | "terminal" | "split" | "editor";
  sessionCount: number;
  workspaceId: string;
  createInFlightWorkspaceId: string | null;
}

export function shouldCreateInitialTerminalSession({
  listenersReady,
  isOpen,
  layoutMode,
  sessionCount,
  workspaceId,
  createInFlightWorkspaceId,
}: TerminalBootstrapDecisionInput): boolean {
  if (!listenersReady) {
    return false;
  }
  if (!workspaceId) {
    return false;
  }
  if (!isOpen) {
    return false;
  }
  if (layoutMode !== "terminal" && layoutMode !== "split") {
    return false;
  }
  if (sessionCount > 0) {
    return false;
  }
  if (createInFlightWorkspaceId === workspaceId) {
    return false;
  }
  return true;
}
