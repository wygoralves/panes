export const SIDEBAR_LIST_MODES = ["projects", "status"] as const;

export type SidebarListMode = (typeof SIDEBAR_LIST_MODES)[number];

export function isSidebarListMode(value?: string | null): value is SidebarListMode {
  return SIDEBAR_LIST_MODES.includes(value as SidebarListMode);
}

export function normalizeSidebarListMode(value?: string | null): SidebarListMode {
  if (value === "fleet") return "status";
  return isSidebarListMode(value) ? value : "projects";
}
