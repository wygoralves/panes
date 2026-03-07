import type { WorkspaceDefaultView } from "../types";

export function resolveStartupSessionHarnessSelection(selectedHarnessId: string | null | undefined) {
  const harnessId = selectedHarnessId?.trim() || null;
  return {
    harnessId,
    launchHarnessOnCreate: Boolean(harnessId),
  };
}

export function shouldShowStartupSplitPanelSize(defaultView: WorkspaceDefaultView): boolean {
  return defaultView === "split";
}
