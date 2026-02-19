import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface DropdownProps {
  options: DropdownOption[];
  groups?: DropdownGroup[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  triggerStyle?: CSSProperties;
  selectedLabel?: string;
  selectedIcon?: ReactNode;
}

interface MenuPosition {
  top: number;
  left: number;
  direction: "bottom" | "top";
}

interface SubmenuPosition {
  top: number;
  left: number;
}

export function Dropdown({
  options,
  groups,
  value,
  onChange,
  disabled = false,
  title,
  triggerStyle,
  selectedLabel: selectedLabelOverride,
  selectedIcon,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition>({ top: 0, left: 0, direction: "bottom" });
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<SubmenuPosition>({ top: 0, left: 0 });
  const groupLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allOptions = [
    ...options,
    ...(groups?.flatMap((g) => g.options) ?? []),
  ];
  const selectedOption = allOptions.find((o) => o.value === value);
  const selectedLabel = selectedLabelOverride ?? selectedOption?.label ?? value;
  const activeIcon = selectedIcon ?? selectedOption?.icon;

  const totalItems = options.length + (groups?.length ?? 0);
  const hasGroups = groups && groups.length > 0;

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
    setActiveGroup(null);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedMenuHeight = totalItems * 32 + 8 + (hasGroups ? 9 : 0);
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;

    setPos({
      top: goUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      direction: goUp ? "top" : "bottom",
    });
  }, [open, totalItems, hasGroups]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        submenuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
      setActiveGroup(null);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setActiveGroup(null);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (groupLeaveTimer.current) clearTimeout(groupLeaveTimer.current);
    };
  }, []);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
    setActiveGroup(null);
  }

  function handleGroupEnter(groupIndex: number, e: React.MouseEvent<HTMLButtonElement>) {
    if (groupLeaveTimer.current) {
      clearTimeout(groupLeaveTimer.current);
      groupLeaveTimer.current = null;
    }
    setActiveGroup(groupIndex);

    const menuRect = menuRef.current?.getBoundingClientRect();
    const itemRect = e.currentTarget.getBoundingClientRect();
    if (menuRect) {
      const group = groups?.[groupIndex];
      const submenuHeight = (group?.options.length ?? 0) * 32 + 8;
      let top = itemRect.top;
      if (top + submenuHeight > window.innerHeight - 8) {
        top = window.innerHeight - submenuHeight - 8;
      }
      let left = menuRect.right + 4;
      if (left + 180 > window.innerWidth) {
        left = menuRect.left - 184;
      }
      setSubmenuPos({ top, left });
    }
  }

  function handleGroupLeave() {
    groupLeaveTimer.current = setTimeout(() => {
      setActiveGroup(null);
    }, 150);
  }

  function handleSubmenuEnter() {
    if (groupLeaveTimer.current) {
      clearTimeout(groupLeaveTimer.current);
      groupLeaveTimer.current = null;
    }
  }

  function handleSubmenuLeave() {
    groupLeaveTimer.current = setTimeout(() => {
      setActiveGroup(null);
    }, 150);
  }

  function handleItemEnter() {
    if (groupLeaveTimer.current) {
      clearTimeout(groupLeaveTimer.current);
      groupLeaveTimer.current = null;
    }
    setActiveGroup(null);
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu"
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.direction === "bottom"
              ? { top: pos.top }
              : { bottom: window.innerHeight - pos.top }),
          }}
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                className={`dropdown-item ${isSelected ? "dropdown-item-selected" : ""}`}
                onClick={() => handleSelect(option.value)}
                onMouseEnter={handleItemEnter}
              >
                {option.icon && (
                  <span className="dropdown-item-icon">{option.icon}</span>
                )}
                <span className="dropdown-item-label">{option.label}</span>
                {isSelected && (
                  <Check size={12} className="dropdown-item-check" />
                )}
              </button>
            );
          })}

          {hasGroups && (
            <>
              <div className="dropdown-divider" />
              {groups.map((group, i) => (
                <button
                  key={group.label}
                  type="button"
                  className={`dropdown-item ${activeGroup === i ? "dropdown-item-active" : ""}`}
                  onMouseEnter={(e) => handleGroupEnter(i, e)}
                  onMouseLeave={handleGroupLeave}
                >
                  <span className="dropdown-item-label">{group.label}</span>
                  <ChevronRight size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                </button>
              ))}
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  const submenu =
    open && activeGroup !== null && groups?.[activeGroup]
      ? createPortal(
          <div
            ref={submenuRef}
            className="dropdown-menu"
            style={{
              position: "fixed",
              top: submenuPos.top,
              left: submenuPos.left,
            }}
            onMouseEnter={handleSubmenuEnter}
            onMouseLeave={handleSubmenuLeave}
          >
            {groups[activeGroup].options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`dropdown-item ${isSelected ? "dropdown-item-selected" : ""}`}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.icon && (
                    <span className="dropdown-item-icon">{option.icon}</span>
                  )}
                  <span className="dropdown-item-label">{option.label}</span>
                  {isSelected && (
                    <Check size={12} className="dropdown-item-check" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="dropdown-root" title={title}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        onClick={toggle}
        disabled={disabled}
        style={triggerStyle}
      >
        {activeIcon && (
          <span className="dropdown-trigger-icon">
            {activeIcon}
          </span>
        )}
        <span className="dropdown-trigger-label">{selectedLabel}</span>
        <ChevronDown
          size={10}
          className={`dropdown-chevron ${open ? "dropdown-chevron-open" : ""}`}
        />
      </button>
      {menu}
      {submenu}
    </div>
  );
}
