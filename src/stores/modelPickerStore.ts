import { create } from "zustand";

export const MODEL_PICKER_COLLAPSED_STORAGE_KEY = "panes.modelPickerCollapsedGroups";

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(MODEL_PICKER_COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => value === true),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeCollapsed(collapsed: Record<string, boolean>) {
  try {
    localStorage.setItem(MODEL_PICKER_COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
  } catch {
    // Local UI state only.
  }
}

interface ModelPickerState {
  /** Group keys the user collapsed in the picker list. */
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (groupKey: string) => void;
  expandGroup: (groupKey: string) => void;
}

export const useModelPickerStore = create<ModelPickerState>((set, get) => ({
  collapsedGroups: readCollapsed(),
  toggleGroup: (groupKey) => {
    const next = { ...get().collapsedGroups };
    if (next[groupKey]) delete next[groupKey];
    else next[groupKey] = true;
    writeCollapsed(next);
    set({ collapsedGroups: next });
  },
  expandGroup: (groupKey) => {
    if (!get().collapsedGroups[groupKey]) return;
    const next = { ...get().collapsedGroups };
    delete next[groupKey];
    writeCollapsed(next);
    set({ collapsedGroups: next });
  },
}));
