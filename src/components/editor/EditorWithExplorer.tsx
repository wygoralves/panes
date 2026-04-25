import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useUiStore } from "../../stores/uiStore";

const LazyFileExplorer = lazy(() =>
  import("./FileExplorer").then((module) => ({
    default: module.FileExplorer,
  })),
);
const LazyFileEditorPanel = lazy(() =>
  import("./FileEditorPanel").then((module) => ({
    default: module.FileEditorPanel,
  })),
);

const EXPLORER_WIDTH_KEY = "panes:explorerWidth";
const MIN_EXPLORER_WIDTH = 140;
const MAX_EXPLORER_WIDTH = 400;
const DEFAULT_EXPLORER_WIDTH = 220;
const RESIZE_CLICK_THRESHOLD = 4;

function loadExplorerWidth(): number {
  try {
    const stored = localStorage.getItem(EXPLORER_WIDTH_KEY);
    if (stored) {
      const v = parseInt(stored, 10);
      if (v >= MIN_EXPLORER_WIDTH && v <= MAX_EXPLORER_WIDTH) return v;
    }
  } catch { /* ignore */ }
  return DEFAULT_EXPLORER_WIDTH;
}

interface EditorWithExplorerProps {
  embedded?: boolean;
}

export function EditorWithExplorer({ embedded = false }: EditorWithExplorerProps = {}) {
  const showExplorerSetting = useUiStore((s) => s.showExplorer);
  const setExplorerOpen = useUiStore((s) => s.setExplorerOpen);
  const explorerVisible = showExplorerSetting;
  const [explorerWidth, setExplorerWidth] = useState(loadExplorerWidth);
  const handleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(EXPLORER_WIDTH_KEY, String(explorerWidth));
    } catch { /* ignore */ }
  }, [explorerWidth]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth;
    let isDragging = false;
    handleRef.current?.classList.add("dragging");
    panelRef.current?.classList.add("resizing");

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      if (!isDragging && Math.abs(delta) < RESIZE_CLICK_THRESHOLD) {
        return;
      }
      isDragging = true;
      setExplorerWidth(
        Math.min(MAX_EXPLORER_WIDTH, Math.max(MIN_EXPLORER_WIDTH, startWidth + delta)),
      );
    }

    function onUp(ev: MouseEvent) {
      handleRef.current?.classList.remove("dragging");
      panelRef.current?.classList.remove("resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!isDragging && Math.abs(ev.clientX - startX) < RESIZE_CLICK_THRESHOLD) {
        setExplorerOpen(false);
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [explorerWidth, setExplorerOpen]);

  return (
    <div className="editor-layout-wrapper">
      <div
        ref={panelRef}
        className={`editor-explorer-panel${explorerVisible ? "" : " collapsed"}`}
        style={explorerVisible ? { width: explorerWidth } : undefined}
      >
        <Suspense fallback={null}>
          <LazyFileExplorer />
        </Suspense>
      </div>

      {explorerVisible && (
        <div
          ref={handleRef}
          className="editor-explorer-resize-handle"
          onMouseDown={handleResizeStart}
        />
      )}

      <Suspense
        fallback={
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: "var(--text-3)",
            }}
          />
        }
      >
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <LazyFileEditorPanel embedded={embedded} />
        </div>
      </Suspense>
    </div>
  );
}
