import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  triggerStyle?: React.CSSProperties;
}

interface MenuPosition {
  top: number;
  left: number;
  direction: "bottom" | "top";
}

export function Dropdown({
  options,
  value,
  onChange,
  disabled = false,
  title,
  triggerStyle,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition>({ top: 0, left: 0, direction: "bottom" });

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? value;

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  // Position the portal menu relative to the trigger
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedMenuHeight = options.length * 32 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;

    setPos({
      top: goUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      direction: goUp ? "top" : "bottom",
    });
  }, [open, options.length]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function handleSelect(optionValue: string) {
    onChange(optionValue);
    setOpen(false);
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
              >
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
        <span className="dropdown-trigger-label">{selectedLabel}</span>
        <ChevronDown
          size={10}
          className={`dropdown-chevron ${open ? "dropdown-chevron-open" : ""}`}
        />
      </button>
      {menu}
    </div>
  );
}
