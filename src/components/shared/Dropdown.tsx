import { useEffect, useMemo, useRef, useState, useCallback, useContext, useLayoutEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import {
  closeGitFlyoutIfFocusLeft,
  GitFlyoutContext,
} from "../../lib/gitFlyoutRegion";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
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
  /** Adds a filter field at the top of the menu; matching is by label. */
  searchable?: boolean;
  searchPlaceholder?: string;
  noResultsLabel?: string;
}

/** Case-insensitive label match across flat options and group options. An
 * empty query returns no results so callers fall back to the normal menu. */
export function filterDropdownOptions(
  options: DropdownOption[],
  groups: DropdownGroup[] | undefined,
  query: string,
): DropdownOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return [...options, ...(groups?.flatMap((group) => group.options) ?? [])].filter(
    (option) => option.label.toLocaleLowerCase().includes(needle),
  );
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
  searchable = false,
  searchPlaceholder,
  noResultsLabel,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPosition>({ top: 0, left: 0, direction: "bottom" });
  const [activeGroup, setActiveGroup] = useState<number | null>(null);
  const [submenuPos, setSubmenuPos] = useState<SubmenuPosition>({ top: 0, left: 0 });
  const groupLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitFlyoutContext = useContext(GitFlyoutContext);

  const allOptions = [
    ...options,
    ...(groups?.flatMap((g) => g.options) ?? []),
  ];
  const selectedOption = allOptions.find((o) => o.value === value);
  const selectedLabel = selectedLabelOverride ?? selectedOption?.label ?? value;
  const activeIcon = selectedIcon ?? selectedOption?.icon;

  const totalItems = options.length + (groups?.length ?? 0);
  const hasGroups = groups && groups.length > 0;
  const isSearching = searchable && query.trim().length > 0;
  const searchResults = useMemo(
    () => (isSearching ? filterDropdownOptions(options, groups, query) : []),
    [groups, isSearching, options, query],
  );

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
    setActiveGroup(null);
    setQuery("");
    setHighlightIndex(0);
  }, [disabled]);

  useEffect(() => {
    if (open && searchable) searchInputRef.current?.focus();
  }, [open, searchable]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedMenuHeight =
      totalItems * 32 + 8 + (hasGroups ? 9 : 0) + (searchable ? 38 : 0);
    const spaceBelow = window.innerHeight - rect.bottom;
    const goUp = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;

    setPos({
      top: goUp ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      direction: goUp ? "top" : "bottom",
    });
  }, [open, totalItems, hasGroups, searchable]);

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
    setQuery("");
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const list = isSearching ? searchResults : options;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((index) => (list.length === 0 ? 0 : (index + 1) % list.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((index) =>
        list.length === 0 ? 0 : (index - 1 + list.length) % list.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = list[highlightIndex];
      if (target) handleSelect(target.value);
    }
  }

  function renderOption(option: DropdownOption, index: number) {
    const isSelected = option.value === value;
    const isHighlighted = searchable && index === highlightIndex;
    return (
      <button
        key={option.value}
        type="button"
        className={`dropdown-item ${isSelected ? "dropdown-item-selected" : ""}${isHighlighted ? " dropdown-item-highlighted" : ""}`}
        onClick={() => handleSelect(option.value)}
        onMouseEnter={() => {
          handleItemEnter();
          if (searchable) setHighlightIndex(index);
        }}
      >
        {option.icon && <span className="dropdown-item-icon">{option.icon}</span>}
        <span className="dropdown-item-label">{option.label}</span>
        {option.shortcut && <span className="dropdown-item-shortcut">{option.shortcut}</span>}
        {isSelected && <Check size={12} className="dropdown-item-check" />}
      </button>
    );
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
          data-git-flyout-region={gitFlyoutContext ? "true" : undefined}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.direction === "bottom"
              ? { top: pos.top }
              : { bottom: window.innerHeight - pos.top }),
          }}
          onMouseEnter={() => gitFlyoutContext?.openFlyout()}
          onMouseLeave={() => gitFlyoutContext?.scheduleClose(150)}
          onFocusCapture={() => gitFlyoutContext?.openFlyout()}
          onBlurCapture={(event) =>
            closeGitFlyoutIfFocusLeft(gitFlyoutContext, event.relatedTarget)
          }
        >
          {searchable && (
            <div className="dropdown-search">
              <input
                ref={searchInputRef}
                type="text"
                className="dropdown-search-input"
                value={query}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          )}

          {isSearching
            ? searchResults.length > 0
              ? searchResults.map(renderOption)
              : noResultsLabel && <div className="dropdown-empty">{noResultsLabel}</div>
            : options.map(renderOption)}

          {hasGroups && !isSearching && (
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
            data-git-flyout-region={gitFlyoutContext ? "true" : undefined}
            style={{
              position: "fixed",
              top: submenuPos.top,
              left: submenuPos.left,
            }}
            onMouseEnter={() => {
              gitFlyoutContext?.openFlyout();
              handleSubmenuEnter();
            }}
            onMouseLeave={() => {
              gitFlyoutContext?.scheduleClose(150);
              handleSubmenuLeave();
            }}
            onFocusCapture={() => gitFlyoutContext?.openFlyout()}
            onBlurCapture={(event) =>
              closeGitFlyoutIfFocusLeft(gitFlyoutContext, event.relatedTarget)
            }
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
                  {option.shortcut && (
                    <span className="dropdown-item-shortcut">{option.shortcut}</span>
                  )}
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
