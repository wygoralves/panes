import { beforeEach, describe, expect, it, vi } from "vitest";

function createStorageStub() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  };
}

describe("modelFavoritesStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageStub());
  });

  it("toggles favorites per engine and persists them", async () => {
    const { useModelFavoritesStore, MODEL_FAVORITES_STORAGE_KEY } = await import("./modelFavoritesStore");
    const store = useModelFavoritesStore.getState();
    expect(store.isFavorite("codex", "gpt-5")).toBe(false);
    store.toggleFavorite("codex", "gpt-5");
    expect(useModelFavoritesStore.getState().isFavorite("codex", "gpt-5")).toBe(true);
    expect(useModelFavoritesStore.getState().isFavorite("codex_work", "gpt-5")).toBe(false);
    expect(JSON.parse(localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY) ?? "[]")).toEqual(["codex::gpt-5"]);
    useModelFavoritesStore.getState().toggleFavorite("codex", "gpt-5");
    expect(useModelFavoritesStore.getState().favorites).toEqual([]);
  });

  it("restores favorites from storage", async () => {
    localStorage.setItem("panes.modelFavorites", JSON.stringify(["claude::opus", 3]));
    const { useModelFavoritesStore } = await import("./modelFavoritesStore");
    expect(useModelFavoritesStore.getState().favorites).toEqual(["claude::opus"]);
  });
});
