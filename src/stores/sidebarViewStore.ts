import { create } from "zustand";

const SETTLED_COLLAPSED_KEY = "panes:sidebarSettledCollapsed";
const SHOW_ARCHIVED_KEY = "panes:sidebarShowArchived";

interface SidebarViewState {
  /** Status-mode project filter. Lives in the store so the new-thread
   * shortcut can target the filtered project from outside the sidebar. */
  projectFilterId: string | null;
  settledCollapsed: boolean;
  /** Whether the archived projects and threads section is listed at all. */
  showArchived: boolean;
  /** Project-mode collapse map, in the store so a keyboard jump can open the
   * group holding the row it selects. */
  collapsedProjects: Record<string, boolean>;
  setProjectFilterId: (workspaceId: string | null) => void;
  setSettledCollapsed: (collapsed: boolean) => void;
  toggleSettledCollapsed: () => void;
  setShowArchived: (show: boolean) => void;
  setCollapsedProjects: (
    update: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void;
  expandProject: (workspaceId: string) => void;
}

function readPersistedSettledCollapsed(): boolean {
  try {
    return localStorage.getItem(SETTLED_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistSettledCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(SETTLED_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Local UI state only: a blocked store must not break the sidebar.
  }
}

function readPersistedShowArchived(): boolean {
  try {
    return localStorage.getItem(SHOW_ARCHIVED_KEY) === "true";
  } catch {
    return false;
  }
}

function persistShowArchived(show: boolean) {
  try {
    localStorage.setItem(SHOW_ARCHIVED_KEY, String(show));
  } catch {
    // Local UI state only: a blocked store must not break the sidebar.
  }
}

export const useSidebarViewStore = create<SidebarViewState>((set, get) => ({
  projectFilterId: null,
  settledCollapsed: readPersistedSettledCollapsed(),
  showArchived: readPersistedShowArchived(),
  collapsedProjects: {},

  setProjectFilterId: (workspaceId) => set({ projectFilterId: workspaceId }),

  setSettledCollapsed: (collapsed) => {
    persistSettledCollapsed(collapsed);
    set({ settledCollapsed: collapsed });
  },

  toggleSettledCollapsed: () => {
    const next = !get().settledCollapsed;
    persistSettledCollapsed(next);
    set({ settledCollapsed: next });
  },

  setShowArchived: (show) => {
    persistShowArchived(show);
    set({ showArchived: show });
  },

  setCollapsedProjects: (update) =>
    set((state) => ({ collapsedProjects: update(state.collapsedProjects) })),

  expandProject: (workspaceId) => {
    if (!get().collapsedProjects[workspaceId]) return;
    set((state) => ({
      collapsedProjects: { ...state.collapsedProjects, [workspaceId]: false },
    }));
  },
}));
