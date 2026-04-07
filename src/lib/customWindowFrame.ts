import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usesCustomWindowFrame } from "./windowActions";

export interface CustomWindowFrameState {
  isFullscreen: boolean;
  isMaximized: boolean;
}

const DEFAULT_CUSTOM_WINDOW_FRAME_STATE: CustomWindowFrameState = {
  isFullscreen: false,
  isMaximized: false,
};

export function canCustomWindowResize(frameState: CustomWindowFrameState): boolean {
  return !(frameState.isFullscreen || frameState.isMaximized);
}

export function shouldShowCustomWindowChrome(frameState: CustomWindowFrameState): boolean {
  return !frameState.isFullscreen;
}

export function useCustomWindowFrameState(): CustomWindowFrameState {
  const [frameState, setFrameState] = useState<CustomWindowFrameState>(DEFAULT_CUSTOM_WINDOW_FRAME_STATE);

  useEffect(() => {
    if (!usesCustomWindowFrame()) {
      setFrameState(DEFAULT_CUSTOM_WINDOW_FRAME_STATE);
      return;
    }

    let disposed = false;
    let unlistenResize: UnlistenFn | null = null;
    const currentWindow = getCurrentWindow();

    const syncFrameState = async () => {
      try {
        const [isMaximized, isFullscreen] = await Promise.all([
          currentWindow.isMaximized(),
          currentWindow.isFullscreen(),
        ]);
        if (!disposed) {
          setFrameState({ isFullscreen, isMaximized });
        }
      } catch {
        if (!disposed) {
          setFrameState(DEFAULT_CUSTOM_WINDOW_FRAME_STATE);
        }
      }
    };

    void syncFrameState();
    void currentWindow.onResized(() => {
      void syncFrameState();
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenResize = unlisten;
    });

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, []);

  return frameState;
}
