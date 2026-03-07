import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  FolderOpen,
  MoreHorizontal,
  Settings2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import type { Workspace } from "../../types";

interface WorkspaceMoreMenuProps {
  workspace: Workspace;
  onOpenSettings: () => void;
  onArchive: () => void;
}

export function WorkspaceMoreMenu({
  workspace,
  onOpenSettings,
  onArchive,
}: WorkspaceMoreMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      closeMenu();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen, closeMenu]);

  function handleTriggerClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (menuOpen) {
      closeMenu();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 180),
      });
    }
    setMenuOpen(true);
  }

  function handleItem(action: () => void) {
    closeMenu();
    action();
  }

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        title="Workspace options"
        className="sb-project-archive"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleTriggerClick}
      >
        <MoreHorizontal size={12} />
      </span>

      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="git-action-menu"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              minWidth: 180,
            }}
          >
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() => handleItem(onOpenSettings)}
            >
              <Settings2 size={13} />
              Workspace settings
            </button>
            <button
              type="button"
              className="git-action-menu-item"
              onClick={() =>
                handleItem(() => {
                  void open(workspace.rootPath);
                })
              }
            >
              <FolderOpen size={13} />
              Reveal in Finder
            </button>
            <div style={{ height: 1, margin: "4px 0", background: "var(--border)" }} />
            <button
              type="button"
              className="git-action-menu-item git-action-menu-item-danger"
              onClick={() => handleItem(onArchive)}
            >
              <Archive size={13} />
              Archive workspace
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
