import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFileState = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; fileName: string; isDirty: boolean }>,
  saveAllDirtyTabs: vi.fn(),
}));

vi.mock("../stores/fileStore", () => ({
  useFileStore: {
    getState: () => mockFileState,
  },
}));

import {
  confirmDiscardUnsavedWork,
  registerUnsavedChangesCloseGuard,
  resolveUnsavedChangesPrompt,
  useUnsavedChangesPromptStore,
} from "./unsavedChangesGuard";

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

function makeWindow() {
  let handler: CloseHandler | null = null;
  return {
    target: {
      onCloseRequested: vi.fn(async (next: CloseHandler) => {
        handler = next;
        return () => {};
      }),
    },
    fireClose: async () => {
      const event = { preventDefault: vi.fn() };
      const pending = handler!(event);
      return { event, pending };
    },
  };
}

describe("unsavedChangesGuard", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFileState.tabs = [];
    mockFileState.saveAllDirtyTabs.mockResolvedValue(true);
    await resolveUnsavedChangesPrompt("cancel");
  });

  it("lets the window close when no tab is dirty", async () => {
    const window = makeWindow();
    await registerUnsavedChangesCloseGuard(window.target);

    const { event, pending } = await window.fireClose();
    await pending;

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(useUnsavedChangesPromptStore.getState().fileNames).toBeNull();
  });

  it("keeps the window open when the user cancels with dirty tabs", async () => {
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: true }];
    const window = makeWindow();
    await registerUnsavedChangesCloseGuard(window.target);

    const { event, pending } = await window.fireClose();
    expect(useUnsavedChangesPromptStore.getState().fileNames).toEqual(["app.ts"]);
    await resolveUnsavedChangesPrompt("cancel");
    await pending;

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("closes after discard and shares one prompt between concurrent requests", async () => {
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: true }];

    const first = confirmDiscardUnsavedWork();
    const second = confirmDiscardUnsavedWork();
    expect(second).toBe(first);

    await resolveUnsavedChangesPrompt("discard");
    await expect(first).resolves.toBe(true);
  });

  it("stays open when saving all fails", async () => {
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: true }];
    mockFileState.saveAllDirtyTabs.mockResolvedValue(false);

    const decision = confirmDiscardUnsavedWork();
    await resolveUnsavedChangesPrompt("save-all");

    await expect(decision).resolves.toBe(false);
    expect(mockFileState.saveAllDirtyTabs).toHaveBeenCalledTimes(1);
  });

  it("stays open when a tab is dirty again after saving all", async () => {
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: true }];
    // The user typed while the write ran, so the tab is still dirty.
    mockFileState.saveAllDirtyTabs.mockResolvedValue(true);

    const decision = confirmDiscardUnsavedWork();
    await resolveUnsavedChangesPrompt("save-all");

    await expect(decision).resolves.toBe(false);
  });

  it("does not let a save started by a cancelled prompt answer a later one", async () => {
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: true }];
    let finishSave!: (saved: boolean) => void;
    mockFileState.saveAllDirtyTabs.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishSave = resolve;
      }),
    );

    const first = confirmDiscardUnsavedWork();
    const saving = resolveUnsavedChangesPrompt("save-all");
    await resolveUnsavedChangesPrompt("cancel");
    await expect(first).resolves.toBe(false);

    const second = confirmDiscardUnsavedWork();
    mockFileState.tabs = [{ id: "tab-1", fileName: "app.ts", isDirty: false }];
    finishSave(true);
    await saving;

    expect(useUnsavedChangesPromptStore.getState().fileNames).toEqual(["app.ts"]);
    await resolveUnsavedChangesPrompt("cancel");
    await expect(second).resolves.toBe(false);
  });
});
