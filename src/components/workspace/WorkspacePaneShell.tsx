import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  FilePen,
  MessageSquare,
  SquareTerminal,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTerminalStore, type LayoutMode } from "../../stores/terminalStore";
import { useThreadStore } from "../../stores/threadStore";
import { useGitStore } from "../../stores/gitStore";
import { useUiStore } from "../../stores/uiStore";
import {
  SURFACE_ORDER,
  collectWorkspacePaneLeaves,
  getWorkspacePaneActiveTab,
  useWorkspacePaneStore,
  type WorkspacePaneLeaf,
  type WorkspacePaneNode,
  type WorkspacePaneSplit,
  type WorkspacePaneSplitDirection,
  type WorkspacePaneSurfaceKind,
} from "../../stores/workspacePaneStore";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { isMacDesktop, usesCustomWindowFrame } from "../../lib/windowActions";

const LazyChatPanel = lazy(() =>
  import("../chat/ChatPanel").then((module) => ({
    default: module.ChatPanel,
  })),
);

const LazyTerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel").then((module) => ({
    default: module.TerminalPanel,
  })),
);

const LazyEditorWithExplorer = lazy(() =>
  import("../editor/EditorWithExplorer").then((module) => ({
    default: module.EditorWithExplorer,
  })),
);

function SurfaceIcon({ kind, size = 13 }: { kind: WorkspacePaneSurfaceKind; size?: number }) {
  if (kind === "terminal") {
    return <SquareTerminal size={size} />;
  }
  if (kind === "editor") {
    return <FilePen size={size} />;
  }
  return <MessageSquare size={size} />;
}

function surfaceLabel(t: TFunction<"app">, kind: WorkspacePaneSurfaceKind): string {
  return t(`workspacePanes.surfaces.${kind}`);
}

function countPaneLeaves(node: WorkspacePaneNode): number {
  return collectWorkspacePaneLeaves(node).length;
}

function focusedSurfaceKind(layoutRoot: WorkspacePaneNode, focusedLeafId: string): WorkspacePaneSurfaceKind {
  const leaves = collectWorkspacePaneLeaves(layoutRoot);
  const focusedLeaf = leaves.find((leaf) => leaf.id === focusedLeafId) ?? leaves[0] ?? null;
  return focusedLeaf ? getWorkspacePaneActiveTab(focusedLeaf)?.kind ?? "chat" : "chat";
}

type DropPlacement = "left" | "right" | "top" | "bottom";
const PANE_LEAF_SELECTOR = "[data-workspace-pane-leaf-id]";
const SURFACE_DRAG_THRESHOLD_PX = 5;

function directionForDropPlacement(placement: DropPlacement): WorkspacePaneSplitDirection {
  return placement === "left" || placement === "right" ? "vertical" : "horizontal";
}

function positionForDropPlacement(placement: DropPlacement): "before" | "after" {
  return placement === "left" || placement === "top" ? "before" : "after";
}

function isSurfaceKind(value: string | null | undefined): value is WorkspacePaneSurfaceKind {
  return value === "chat" || value === "terminal" || value === "editor";
}

function resolveDropPlacementFromRect(rect: DOMRect, clientX: number, clientY: number): DropPlacement {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const distances: Array<[DropPlacement, number]> = [
    ["left", x],
    ["right", rect.width - x],
    ["top", y],
    ["bottom", rect.height - y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0]?.[0] ?? "right";
}

function resolvePointerDropTarget(clientX: number, clientY: number): {
  leafId: string;
  placement: DropPlacement;
} | null {
  const element = document.elementFromPoint(clientX, clientY);
  const leafElement = element instanceof Element
    ? element.closest<HTMLElement>(PANE_LEAF_SELECTOR)
    : null;
  const leafId = leafElement?.dataset.workspacePaneLeafId;
  if (!leafElement || !leafId) {
    return null;
  }
  return {
    leafId,
    placement: resolveDropPlacementFromRect(leafElement.getBoundingClientRect(), clientX, clientY),
  };
}

interface SurfaceDragState {
  kind: WorkspacePaneSurfaceKind;
  pointerX: number;
  pointerY: number;
  targetLeafId: string | null;
  placement: DropPlacement | null;
}

interface WorkspacePaneShellProps {
  workspaceId: string;
}

export function WorkspacePaneShell({ workspaceId }: WorkspacePaneShellProps) {
  const { t } = useTranslation("app");
  const terminalLayoutMode = useTerminalStore((state) =>
    state.workspaces[workspaceId]?.layoutMode ?? "chat",
  );
  const setTerminalLayoutMode = useTerminalStore((state) => state.setLayoutMode);
  const ensureWorkspace = useWorkspacePaneStore((state) => state.ensureWorkspace);
  const activateFocusedSurface = useWorkspacePaneStore((state) => state.activateFocusedSurface);
  const splitFocusedLeaf = useWorkspacePaneStore((state) => state.splitFocusedLeaf);
  const layout = useWorkspacePaneStore((state) => state.workspaces[workspaceId]);
  const suppressSurfaceClickRef = useRef(false);
  const suppressSurfaceClickTimerRef = useRef<number | null>(null);
  const surfaceDragCleanupRef = useRef<(() => void) | null>(null);
  const [surfaceDrag, setSurfaceDrag] = useState<SurfaceDragState | null>(null);
  const [editingThreadTitle, setEditingThreadTitle] = useState(false);
  const [threadTitleDraft, setThreadTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { activeWorkspace, activeThread, renameThread, gitStatus, focusMode, showSidebar } =
    useWorkspacePaneHeaderState(workspaceId);
  const customWindowFrame = usesCustomWindowFrame();
  const useTitlebarSafeInset = isMacDesktop() && focusMode && !showSidebar;

  useEffect(() => {
    ensureWorkspace(workspaceId, terminalLayoutMode);
  }, [ensureWorkspace, terminalLayoutMode, workspaceId]);

  useEffect(() => {
    if (!layout || layout.legacyMode === terminalLayoutMode) {
      return;
    }
    void setTerminalLayoutMode(workspaceId, layout.legacyMode);
  }, [layout, setTerminalLayoutMode, terminalLayoutMode, workspaceId]);

  const activeSurface = useMemo(() => {
    if (!layout) {
      return "chat";
    }
    return focusedSurfaceKind(layout.root, layout.focusedLeafId);
  }, [layout]);

  useEffect(() => {
    if (editingThreadTitle) {
      return;
    }
    setThreadTitleDraft(activeThread?.title ?? "");
  }, [activeThread?.id, activeThread?.title, editingThreadTitle]);

  useEffect(() => {
    if (editingThreadTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingThreadTitle]);

  useEffect(() => (
    () => {
      if (suppressSurfaceClickTimerRef.current !== null) {
        window.clearTimeout(suppressSurfaceClickTimerRef.current);
      }
      surfaceDragCleanupRef.current?.();
    }
  ), []);

  const handlePrimarySurfaceClick = useCallback(
    (kind: WorkspacePaneSurfaceKind) => {
      if (suppressSurfaceClickRef.current) {
        suppressSurfaceClickRef.current = false;
        return;
      }
      activateFocusedSurface(workspaceId, kind);
    },
    [activateFocusedSurface, workspaceId],
  );

  const clearSurfaceDragSuppression = useCallback((delay = 0) => {
    if (suppressSurfaceClickTimerRef.current !== null) {
      window.clearTimeout(suppressSurfaceClickTimerRef.current);
    }
    suppressSurfaceClickTimerRef.current = window.setTimeout(() => {
      suppressSurfaceClickRef.current = false;
      suppressSurfaceClickTimerRef.current = null;
    }, delay);
  }, []);

  const commitSurfaceDrag = useCallback(
    (kind: WorkspacePaneSurfaceKind, target: { leafId: string; placement: DropPlacement } | null) => {
      if (!target) {
        return;
      }
      const currentLayout = useWorkspacePaneStore.getState().workspaces[workspaceId];
      const targetLeaf = currentLayout
        ? collectWorkspacePaneLeaves(currentLayout.root).find((leaf) => leaf.id === target.leafId) ?? null
        : null;
      const activeKind = targetLeaf ? getWorkspacePaneActiveTab(targetLeaf)?.kind ?? null : null;
      if (!targetLeaf || activeKind === kind) {
        return;
      }
      useWorkspacePaneStore.getState().splitLeaf(
        workspaceId,
        target.leafId,
        directionForDropPlacement(target.placement),
        kind,
        positionForDropPlacement(target.placement),
      );
    },
    [workspaceId],
  );

  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, kind: WorkspacePaneSurfaceKind) => {
      if (event.button !== 0 || !isSurfaceKind(kind)) {
        return;
      }

      surfaceDragCleanupRef.current?.();
      const pointerId = event.pointerId;
      const sourceButton = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let latestTarget: { leafId: string; placement: DropPlacement } | null = null;
      try {
        sourceButton.setPointerCapture(pointerId);
      } catch {
        // Pointer capture is best-effort; window-level listeners still drive the drag.
      }

      const publishDrag = (clientX: number, clientY: number) => {
        latestTarget = resolvePointerDropTarget(clientX, clientY);
        setSurfaceDrag({
          kind,
          pointerX: clientX,
          pointerY: clientY,
          targetLeafId: latestTarget?.leafId ?? null,
          placement: latestTarget?.placement ?? null,
        });
      };

      const stopDrag = (commit: boolean) => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("blur", handleWindowBlur);
        sourceButton.removeEventListener("lostpointercapture", handleLostPointerCapture);
        surfaceDragCleanupRef.current = null;
        document.body.classList.remove("workspace-pane-surface-dragging");
        try {
          if (sourceButton.hasPointerCapture(pointerId)) {
            sourceButton.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore stale pointer capture state after cancellation.
        }
        setSurfaceDrag(null);
        if (dragging && commit) {
          commitSurfaceDrag(kind, latestTarget);
          clearSurfaceDragSuppression(250);
          return;
        }
        suppressSurfaceClickRef.current = false;
      };

      const handleWindowBlur = () => {
        stopDrag(false);
      };

      const handleLostPointerCapture = (captureEvent: PointerEvent) => {
        if (captureEvent.pointerId !== pointerId) {
          return;
        }
        stopDrag(false);
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (!dragging && distance < SURFACE_DRAG_THRESHOLD_PX) {
          return;
        }
        if (!dragging) {
          dragging = true;
          suppressSurfaceClickRef.current = true;
          document.body.classList.add("workspace-pane-surface-dragging");
        }
        moveEvent.preventDefault();
        publishDrag(moveEvent.clientX, moveEvent.clientY);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        upEvent.preventDefault();
        if (dragging) {
          latestTarget = resolvePointerDropTarget(upEvent.clientX, upEvent.clientY);
        }
        stopDrag(true);
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return;
        }
        stopDrag(false);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("blur", handleWindowBlur);
      sourceButton.addEventListener("lostpointercapture", handleLostPointerCapture);
      surfaceDragCleanupRef.current = () => stopDrag(false);
    },
    [clearSurfaceDragSuppression, commitSurfaceDrag],
  );

  const handleSurfaceKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, kind: WorkspacePaneSurfaceKind) => {
      if (!event.shiftKey) {
        return;
      }
      const splitByKey: Partial<Record<string, [WorkspacePaneSplitDirection, "before" | "after"]>> = {
        ArrowLeft: ["vertical", "before"],
        ArrowRight: ["vertical", "after"],
        ArrowUp: ["horizontal", "before"],
        ArrowDown: ["horizontal", "after"],
      };
      const split = splitByKey[event.key];
      if (!split) {
        return;
      }
      event.preventDefault();
      splitFocusedLeaf(workspaceId, split[0], kind, split[1]);
    },
    [splitFocusedLeaf, workspaceId],
  );

  const startThreadTitleEdit = useCallback(() => {
    if (!activeThread) {
      return;
    }
    setThreadTitleDraft(activeThread.title ?? "");
    setEditingThreadTitle(true);
  }, [activeThread]);

  const cancelThreadTitleEdit = useCallback(() => {
    setThreadTitleDraft(activeThread?.title ?? "");
    setEditingThreadTitle(false);
  }, [activeThread?.title]);

  const saveThreadTitleEdit = useCallback(async () => {
    if (!activeThread) {
      setEditingThreadTitle(false);
      return;
    }
    const normalized = threadTitleDraft.trim();
    if (!normalized) {
      cancelThreadTitleEdit();
      return;
    }
    if (normalized !== (activeThread.title ?? "")) {
      await renameThread(activeThread.id, normalized);
    }
    setEditingThreadTitle(false);
  }, [activeThread, cancelThreadTitleEdit, renameThread, threadTitleDraft]);

  if (!layout) {
    return (
      <div className="workspace-pane-shell workspace-pane-shell-empty">
        <span>{t("workspacePanes.loading")}</span>
      </div>
    );
  }

  return (
    <div className="workspace-pane-shell">
      <div
        className="workspace-pane-header"
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
        style={{
          paddingLeft: showSidebar ? 16 : customWindowFrame ? 16 : useTitlebarSafeInset ? 80 : 80,
        }}
      >
        <div className="workspace-pane-header-content no-drag">
          <WorkspacePaneBreadcrumb
            activeSurface={activeSurface}
            activeThreadTitle={activeThread?.title ?? null}
            canRenameThread={activeThread !== null}
            changedFileCount={gitStatus?.files.length ?? 0}
            editingThreadTitle={editingThreadTitle}
            titleInputRef={titleInputRef}
            threadTitleDraft={threadTitleDraft}
            workspaceName={activeWorkspace?.name || activeWorkspace?.rootPath?.split("/").pop() || ""}
            workspacePath={activeWorkspace?.rootPath ?? ""}
            onCancelThreadTitleEdit={cancelThreadTitleEdit}
            onSaveThreadTitleEdit={saveThreadTitleEdit}
            onStartThreadTitleEdit={startThreadTitleEdit}
            onThreadTitleDraftChange={setThreadTitleDraft}
          />
        </div>

        <div className="workspace-pane-header-actions no-drag">
          <div
            className="layout-mode-switcher"
            role="tablist"
            aria-label={t("workspacePanes.primarySwitcher")}
          >
            {SURFACE_ORDER.map((kind) => {
              const active = activeSurface === kind;
              const buttonLabel = t("workspacePanes.primarySurfaceTitle", {
                surface: surfaceLabel(t, kind),
              });
              return (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
                  className={`layout-mode-btn${active ? " active" : ""}`}
                  title={buttonLabel}
                  aria-label={buttonLabel}
                  onClick={() => handlePrimarySurfaceClick(kind)}
                  onKeyDown={(event) => handleSurfaceKeyDown(event, kind)}
                  onPointerDown={(event) => handleSurfacePointerDown(event, kind)}
                >
                  <SurfaceIcon kind={kind} size={12} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="workspace-pane-canvas">
        <PaneNodeView
          node={layout.root}
          workspaceId={workspaceId}
          focusedLeafId={layout.focusedLeafId}
          leafCount={countPaneLeaves(layout.root)}
          surfaceDrag={surfaceDrag}
        />
      </div>

      {surfaceDrag && (
        <div
          className="workspace-pane-drag-chip"
          style={{
            transform: `translate3d(${surfaceDrag.pointerX + 12}px, ${surfaceDrag.pointerY + 12}px, 0)`,
          }}
        >
          <SurfaceIcon kind={surfaceDrag.kind} size={13} />
          <span>{surfaceLabel(t, surfaceDrag.kind)}</span>
        </div>
      )}
    </div>
  );
}

function useWorkspacePaneHeaderState(workspaceId: string) {
  const { activeWorkspace } = useWorkspaceStore(
    useShallow((state) => ({
      activeWorkspace:
        state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    })),
  );
  const { activeThread, renameThread } = useThreadStore(
    useShallow((state) => ({
      activeThread:
        state.threads.find(
          (thread) => thread.id === state.activeThreadId && thread.workspaceId === workspaceId,
        ) ?? null,
      renameThread: state.renameThread,
    })),
  );
  const gitStatus = useGitStore((state) => state.status);
  const focusMode = useUiStore((state) => state.focusMode);
  const showSidebar = useUiStore((state) => state.showSidebar);

  return {
    activeWorkspace,
    activeThread,
    renameThread,
    gitStatus,
    focusMode,
    showSidebar,
  };
}

function WorkspacePaneBreadcrumb({
  activeSurface,
  activeThreadTitle,
  canRenameThread,
  changedFileCount,
  editingThreadTitle,
  titleInputRef,
  threadTitleDraft,
  workspaceName,
  workspacePath,
  onCancelThreadTitleEdit,
  onSaveThreadTitleEdit,
  onStartThreadTitleEdit,
  onThreadTitleDraftChange,
}: {
  activeSurface: WorkspacePaneSurfaceKind;
  activeThreadTitle: string | null;
  canRenameThread: boolean;
  changedFileCount: number;
  editingThreadTitle: boolean;
  titleInputRef: RefObject<HTMLInputElement | null>;
  threadTitleDraft: string;
  workspaceName: string;
  workspacePath: string;
  onCancelThreadTitleEdit: () => void;
  onSaveThreadTitleEdit: () => Promise<void>;
  onStartThreadTitleEdit: () => void;
  onThreadTitleDraftChange: (value: string) => void;
}) {
  const { t: tChat } = useTranslation("chat");
  const title =
    activeThreadTitle ||
    (activeSurface === "terminal"
      ? tChat("panel.threadTitle.terminal")
      : activeSurface === "editor"
        ? tChat("panel.threadTitle.fileEditor")
        : tChat("panel.threadTitle.newChat"));

  return (
    <>
      {workspaceName && (
        <>
          <span className="workspace-pane-header-folder" title={workspacePath}>
            {workspaceName}
          </span>
          <span className="workspace-pane-header-separator">/</span>
        </>
      )}
      {editingThreadTitle ? (
        <input
          ref={titleInputRef}
          value={threadTitleDraft}
          onChange={(event) => onThreadTitleDraftChange(event.target.value)}
          onBlur={onCancelThreadTitleEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onSaveThreadTitleEdit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelThreadTitleEdit();
            }
          }}
          className="workspace-pane-title-input"
        />
      ) : (
        <button
          type="button"
          className="workspace-pane-title-btn"
          title={canRenameThread ? tChat("panel.renameThread") : title}
          disabled={!canRenameThread}
          onClick={onStartThreadTitleEdit}
        >
          {title}
        </button>
      )}
      {changedFileCount > 0 && (
        <>
          <span className="workspace-pane-header-separator">/</span>
          <span className="workspace-pane-header-changes">
            {tChat("panel.changedFiles", { count: changedFileCount })}
          </span>
        </>
      )}
    </>
  );
}

export function ActiveWorkspacePaneShell() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const { t } = useTranslation("app");

  if (!activeWorkspaceId) {
    return (
      <div className="workspace-pane-shell workspace-pane-shell-empty">
        <span>{t("workspacePanes.noWorkspace")}</span>
      </div>
    );
  }

  return <WorkspacePaneShell workspaceId={activeWorkspaceId} />;
}

interface PaneNodeViewProps {
  node: WorkspacePaneNode;
  workspaceId: string;
  focusedLeafId: string;
  leafCount: number;
  surfaceDrag: SurfaceDragState | null;
}

function PaneNodeView({
  node,
  workspaceId,
  focusedLeafId,
  leafCount,
  surfaceDrag,
}: PaneNodeViewProps) {
  if (node.type === "leaf") {
    return (
      <PaneLeafView
        leaf={node}
        workspaceId={workspaceId}
        focused={node.id === focusedLeafId}
        leafCount={leafCount}
        surfaceDrag={surfaceDrag}
      />
    );
  }

  return (
    <PaneSplitView
      split={node}
      workspaceId={workspaceId}
      focusedLeafId={focusedLeafId}
      leafCount={leafCount}
      surfaceDrag={surfaceDrag}
    />
  );
}

interface PaneSplitViewProps {
  split: WorkspacePaneSplit;
  workspaceId: string;
  focusedLeafId: string;
  leafCount: number;
  surfaceDrag: SurfaceDragState | null;
}

function PaneSplitView({
  split,
  workspaceId,
  focusedLeafId,
  leafCount,
  surfaceDrag,
}: PaneSplitViewProps) {
  const updateRatio = useWorkspacePaneStore((state) => state.updateRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const vertical = split.direction === "vertical";
  const firstSize = `${split.ratio * 100}%`;
  const secondSize = `${(1 - split.ratio) * 100}%`;

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const dimension = vertical ? rect.width : rect.height;
      const start = vertical ? rect.left : rect.top;

      document.body.style.userSelect = "none";

      const onMove = (moveEvent: MouseEvent) => {
        const position = vertical ? moveEvent.clientX : moveEvent.clientY;
        updateRatio(workspaceId, split.id, (position - start) / dimension);
      };
      const cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", cleanup);
        document.body.style.userSelect = "";
        dragCleanupRef.current = null;
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", cleanup);
      dragCleanupRef.current = cleanup;
    },
    [split.id, updateRatio, vertical, workspaceId],
  );

  return (
    <div
      ref={containerRef}
      className="workspace-pane-split"
      style={{ flexDirection: vertical ? "row" : "column" }}
    >
      <div
        className="workspace-pane-split-child"
        style={{ flexBasis: `calc(${firstSize} - 2px)` }}
      >
        <PaneNodeView
          node={split.children[0]}
          workspaceId={workspaceId}
          focusedLeafId={focusedLeafId}
          leafCount={leafCount}
          surfaceDrag={surfaceDrag}
        />
      </div>
      <div
        className={vertical ? "workspace-pane-resize-handle-v" : "workspace-pane-resize-handle-h"}
        onMouseDown={handleMouseDown}
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
      />
      <div
        className="workspace-pane-split-child"
        style={{ flexBasis: `calc(${secondSize} - 2px)` }}
      >
        <PaneNodeView
          node={split.children[1]}
          workspaceId={workspaceId}
          focusedLeafId={focusedLeafId}
          leafCount={leafCount}
          surfaceDrag={surfaceDrag}
        />
      </div>
    </div>
  );
}

interface PaneLeafViewProps {
  leaf: WorkspacePaneLeaf;
  workspaceId: string;
  focused: boolean;
  leafCount: number;
  surfaceDrag: SurfaceDragState | null;
}

function PaneLeafView({
  leaf,
  workspaceId,
  focused,
  leafCount,
  surfaceDrag,
}: PaneLeafViewProps) {
  const { t } = useTranslation("app");
  const focusLeaf = useWorkspacePaneStore((state) => state.focusLeaf);
  const closeLeaf = useWorkspacePaneStore((state) => state.closeLeaf);
  const activeTab = getWorkspacePaneActiveTab(leaf);
  const activeSurfaceKind = activeTab?.kind ?? null;
  const showSnapPreview =
    surfaceDrag !== null &&
    surfaceDrag.targetLeafId === leaf.id &&
    surfaceDrag.placement !== null &&
    surfaceDrag.kind !== activeSurfaceKind;

  return (
    <section
      className={`workspace-pane-leaf${focused ? " workspace-pane-leaf-focused" : ""}${
        leafCount > 1 ? " workspace-pane-leaf-has-close" : ""
      }`}
      data-workspace-pane-leaf-id={leaf.id}
      onMouseDownCapture={() => focusLeaf(workspaceId, leaf.id)}
    >
      {leafCount > 1 && (
        <button
          type="button"
          className="workspace-pane-close-btn"
          title={t("workspacePanes.closePane")}
          aria-label={t("workspacePanes.closePane")}
          onClick={() => closeLeaf(workspaceId, leaf.id)}
        >
          <X size={12} />
        </button>
      )}

      {showSnapPreview && (
        <div className="workspace-pane-snap-overlay" aria-hidden="true">
          <div
            className={`workspace-pane-snap-preview workspace-pane-snap-preview-${surfaceDrag.placement}`}
          >
            <div className="workspace-pane-snap-label">
              <SurfaceIcon kind={surfaceDrag.kind} size={14} />
              <span>
                {t(`workspacePanes.dropZones.${surfaceDrag.placement}`, {
                  surface: surfaceLabel(t, surfaceDrag.kind),
                })}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="workspace-pane-body">
        {activeTab ? (
          <SurfaceView kind={activeTab.kind} workspaceId={workspaceId} />
        ) : (
          <EmptyPane />
        )}
      </div>
    </section>
  );
}

function EmptyPane() {
  const { t } = useTranslation("app");

  return (
    <div className="workspace-pane-empty">
      {t("workspacePanes.emptyPane")}
    </div>
  );
}

function SurfaceView({
  kind,
  workspaceId,
}: {
  kind: WorkspacePaneSurfaceKind;
  workspaceId: string;
}) {
  const { t } = useTranslation("app");

  return (
    <Suspense
      fallback={
        <div className="workspace-pane-loading">
          {t("workspacePanes.loading")}
        </div>
      }
    >
      {kind === "chat" && <LazyChatPanel embedded />}
      {kind === "terminal" && <LazyTerminalPanel workspaceId={workspaceId} embedded />}
      {kind === "editor" && <LazyEditorWithExplorer embedded />}
    </Suspense>
  );
}
