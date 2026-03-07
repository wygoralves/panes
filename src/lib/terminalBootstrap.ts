interface TerminalBootstrapDecisionInput {
  listenersReady: boolean;
  isOpen: boolean;
  layoutMode: "chat" | "terminal" | "split" | "editor";
  sessionCount: number;
  workspaceId: string;
  createInFlightWorkspaceId: string | null;
  hasPendingStartupPreset: boolean;
}

export type TerminalBootstrapAction = "none" | "preset" | "single_session";

export function resolveTerminalBootstrapAction({
  listenersReady,
  isOpen,
  layoutMode,
  sessionCount,
  workspaceId,
  createInFlightWorkspaceId,
  hasPendingStartupPreset,
}: TerminalBootstrapDecisionInput): TerminalBootstrapAction {
  if (!listenersReady) {
    return "none";
  }
  if (!workspaceId) {
    return "none";
  }
  if (!isOpen) {
    return "none";
  }
  if (sessionCount > 0) {
    return "none";
  }
  if (createInFlightWorkspaceId === workspaceId) {
    return "none";
  }
  if (hasPendingStartupPreset) {
    return "preset";
  }
  if (layoutMode !== "terminal" && layoutMode !== "split") {
    return "none";
  }
  return "single_session";
}
