import { useEffect, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLinuxDesktop } from "./windowActions";

export const LINUX_WINDOW_FOREHEAD_HEIGHT = 36;

export interface LinuxWindowFrameState {
  isFullscreen: boolean;
  isMaximized: boolean;
}

const DEFAULT_LINUX_WINDOW_FRAME_STATE: LinuxWindowFrameState = {
  isFullscreen: false,
  isMaximized: false,
};

export function canLinuxWindowResize(frameState: LinuxWindowFrameState): boolean {
  return !(frameState.isFullscreen || frameState.isMaximized);
}

export function shouldShowLinuxWindowChrome(frameState: LinuxWindowFrameState): boolean {
  return !frameState.isFullscreen;
}

export function useLinuxWindowFrameState(): LinuxWindowFrameState {
  const [frameState, setFrameState] = useState<LinuxWindowFrameState>(DEFAULT_LINUX_WINDOW_FRAME_STATE);

  useEffect(() => {
    if (!isLinuxDesktop()) {
      setFrameState(DEFAULT_LINUX_WINDOW_FRAME_STATE);
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
          setFrameState(DEFAULT_LINUX_WINDOW_FRAME_STATE);
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
