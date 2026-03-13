import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";

export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  codexOnly?: boolean;
  disabled?: boolean;
}

interface ChatSlashMenuProps {
  visible: boolean;
  query: string;
  commands: SlashCommand[];
  anchorRef: React.RefObject<HTMLElement | null>;
  activeIndex: number;
  onSelect: (commandId: string) => void;
  onDismiss: () => void;
  onActiveChange: (index: number) => void;
}

export function ChatSlashMenu({
  visible,
  query,
  commands,
  anchorRef,
  activeIndex,
  onSelect,
  onDismiss,
  onActiveChange,
}: ChatSlashMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0, width: 0 });

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
      width: Math.min(340, rect.width),
    });
  }, [visible, anchorRef, query]);

  // Close on outside click
  useEffect(() => {
    if (!visible) return;

    function onPointerDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      onDismiss();
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [visible, onDismiss]);

  // Scroll active item into view
  useEffect(() => {
    if (!visible) return;
    const activeEl = menuRef.current?.querySelector(
      `[data-slash-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, visible]);

  if (!visible || commands.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="slash-menu"
      style={{
        position: "fixed",
        zIndex: 1400,
        bottom: pos.bottom,
        left: pos.left,
        width: pos.width,
      }}
    >
      {commands.map((cmd, i) => {
        const Icon = cmd.icon;
        const isActive = i === activeIndex;
        return (
          <button
            key={cmd.id}
            type="button"
            data-slash-index={i}
            className={`slash-menu-item${isActive ? " slash-menu-item-active" : ""}${cmd.disabled ? " slash-menu-item-disabled" : ""}`}
            onPointerEnter={() => onActiveChange(i)}
            onClick={() => {
              if (!cmd.disabled) onSelect(cmd.id);
            }}
            disabled={cmd.disabled}
          >
            <span className="slash-menu-item-icon">
              <Icon size={14} />
            </span>
            <span className="slash-menu-item-text">
              <span className="slash-menu-item-name">{cmd.name[0].toUpperCase() + cmd.name.slice(1)}</span>
              <span className="slash-menu-item-desc">{cmd.description}</span>
            </span>
            {cmd.codexOnly && (
              <span className="slash-menu-item-badge">Codex</span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
