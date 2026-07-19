export const SIDEBAR_LIST_MODES = ["projects", "fleet"] as const;

export type SidebarListMode = (typeof SIDEBAR_LIST_MODES)[number];

export function isSidebarListMode(value?: string | null): value is SidebarListMode {
  return SIDEBAR_LIST_MODES.includes(value as SidebarListMode);
}

export function normalizeSidebarListMode(value?: string | null): SidebarListMode {
  return isSidebarListMode(value) ? value : "projects";
}
