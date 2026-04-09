import type { LayoutMode } from "../stores/terminalStore";

export function resolveNewThreadTargetLayoutMode(
  currentLayoutMode: LayoutMode | null | undefined,
): LayoutMode {
  if (currentLayoutMode === "terminal" || currentLayoutMode === "split") {
    return "split";
  }
  return "chat";
}
