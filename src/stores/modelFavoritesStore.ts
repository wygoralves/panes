import { create } from "zustand";

export const MODEL_FAVORITES_STORAGE_KEY = "panes.modelFavorites";

export function modelFavoriteKey(engineId: string, modelId: string): string {
  return `${engineId}::${modelId}`;
}

function readStoredFavorites(): string[] {
  try {
    const raw = localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredFavorites(favorites: string[]) {
  try {
    localStorage.setItem(MODEL_FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Storage unavailable: favorites stay in memory for this session.
  }
}

interface ModelFavoritesState {
  favorites: string[];
  isFavorite: (engineId: string, modelId: string) => boolean;
  toggleFavorite: (engineId: string, modelId: string) => void;
}

export const useModelFavoritesStore = create<ModelFavoritesState>((set, get) => ({
  favorites: readStoredFavorites(),
  isFavorite: (engineId, modelId) => get().favorites.includes(modelFavoriteKey(engineId, modelId)),
  toggleFavorite: (engineId, modelId) => {
    const key = modelFavoriteKey(engineId, modelId);
    const current = get().favorites;
    const next = current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key];
    writeStoredFavorites(next);
    set({ favorites: next });
  },
}));
