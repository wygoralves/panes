import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

const HANDLE_DIRECTIONS: Array<{ className: string; direction: ResizeDirection }> = [
  { className: "linux-window-resize-handle-north", direction: "North" },
  { className: "linux-window-resize-handle-south", direction: "South" },
  { className: "linux-window-resize-handle-east", direction: "East" },
  { className: "linux-window-resize-handle-west", direction: "West" },
  { className: "linux-window-resize-handle-north-west", direction: "NorthWest" },
  { className: "linux-window-resize-handle-north-east", direction: "NorthEast" },
  { className: "linux-window-resize-handle-south-west", direction: "SouthWest" },
  { className: "linux-window-resize-handle-south-east", direction: "SouthEast" },
];

function handleResizeMouseDown(direction: ResizeDirection, event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return;
  event.preventDefault();
  getCurrentWindow().startResizeDragging(direction).catch((error) => {
    if (import.meta.env.DEV) {
      console.warn(`[LinuxWindowResizeHandles] Failed to start resize dragging (${direction})`, error);
    }
  });
}

interface LinuxWindowResizeHandlesProps {
  canResize: boolean;
}

export function LinuxWindowResizeHandles({ canResize }: LinuxWindowResizeHandlesProps) {
  if (!canResize) {
    return null;
  }

  return (
    <>
      {HANDLE_DIRECTIONS.map(({ className, direction }) => (
        <div
          key={direction}
          className={`linux-window-resize-handle ${className}`}
          onMouseDown={(event) => handleResizeMouseDown(direction, event)}
        />
      ))}
    </>
  );
}
