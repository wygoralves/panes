import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Archive, Check, FolderGit2, FolderPlus, ListFilter, MoreHorizontal } from "lucide-react";
import type { SidebarListMode } from "../../lib/sidebarListMode";

interface Props {
  mode: SidebarListMode;
  showArchived: boolean;
  onNewProject: () => void;
  onChangeMode: (mode: SidebarListMode) => void;
  onToggleArchived: (show: boolean) => void;
}

export function SidebarListMenu({
  mode,
  showArchived,
  onNewProject,
  onChangeMode,
  onToggleArchived,
}: Props) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open, closeMenu]);

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - 192),
      });
    }
    setOpen(true);
  }

  function selectMode(nextMode: SidebarListMode) {
    closeMenu();
    onChangeMode(nextMode);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sb-list-menu-trigger"
        title={t("sidebar.moreOptions")}
        aria-label={t("sidebar.moreOptions")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <MoreHorizontal size={14} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="git-action-menu sb-list-menu"
            role="menu"
            style={{ position: "fixed", top: position.top, left: position.left }}
          >
            <button
              type="button"
              role="menuitem"
              className="git-action-menu-item"
              onClick={() => {
                closeMenu();
                onNewProject();
              }}
            >
              <FolderPlus size={13} />
              {t("sidebar.newProject")}
            </button>
            <div className="git-action-menu-divider" />
            <div className="git-action-menu-section-label">{t("sidebar.groupBy")}</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode === "projects"}
              className="git-action-menu-item"
              onClick={() => selectMode("projects")}
            >
              <FolderGit2 size={13} />
              <span className="sb-list-menu-label">{t("sidebar.sidebarListMode_projects")}</span>
              {mode === "projects" && <Check size={12} />}
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode === "status"}
              className="git-action-menu-item"
              onClick={() => selectMode("status")}
            >
              <ListFilter size={13} />
              <span className="sb-list-menu-label">{t("sidebar.sidebarListMode_status")}</span>
              {mode === "status" && <Check size={12} />}
            </button>
            <div className="git-action-menu-divider" />
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={showArchived}
              className="git-action-menu-item"
              onClick={() => {
                closeMenu();
                onToggleArchived(!showArchived);
              }}
            >
              <Archive size={13} />
              <span className="sb-list-menu-label">{t("sidebar.showArchived")}</span>
              {showArchived && <Check size={12} />}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
