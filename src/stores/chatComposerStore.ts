import { create } from "zustand";
import type { ComposerRuntimeSnapshot } from "../lib/newThreadRuntime";

interface ChatComposerState {
  runtimeByWorkspace: Record<string, ComposerRuntimeSnapshot>;
  setWorkspaceRuntime: (
    workspaceId: string,
    runtime: ComposerRuntimeSnapshot,
  ) => void;
  clearWorkspaceRuntime: (workspaceId: string) => void;
}

export const useChatComposerStore = create<ChatComposerState>((set) => ({
  runtimeByWorkspace: {},
  setWorkspaceRuntime: (workspaceId, runtime) =>
    set((state) => ({
      runtimeByWorkspace: {
        ...state.runtimeByWorkspace,
        [workspaceId]: runtime,
      },
    })),
  clearWorkspaceRuntime: (workspaceId) =>
    set((state) => {
      const { [workspaceId]: _removed, ...rest } = state.runtimeByWorkspace;
      return {
        runtimeByWorkspace: rest,
      };
    }),
}));
