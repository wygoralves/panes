import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Monitor, Shield, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TrustLevel } from "../../types";

type PermissionOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
};

type RailItem = {
  id: string;
  icon: ReactNode;
  title: string;
  currentLabel: string | null;
  options: PermissionOption[];
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  note?: string | null;
};

interface PermissionPickerProps {
  disabled?: boolean;
  trustScopeLabel?: string;
  trustValue?: TrustLevel;
  trustOptions?: PermissionOption<TrustLevel>[];
  onTrustChange?: (value: TrustLevel) => void;
  customPolicyCount?: number;
  approvalTitle?: string;
  approvalValue?: string;
  approvalSelectedLabel?: string | null;
  approvalOptions?: PermissionOption[];
  onApprovalChange?: (value: string) => void;
  sandboxValue?: string;
  sandboxOptions?: PermissionOption[];
  onSandboxChange?: (value: string) => void;
  sandboxNotice?: string | null;
  sandboxSelectedLabel?: string | null;
  networkValue?: string;
  networkOptions?: PermissionOption[];
  onNetworkChange?: (value: string) => void;
  networkDisabled?: boolean;
  networkNotice?: string | null;
}

function findOption<T extends string>(
  options: PermissionOption<T>[] | undefined,
  value: T | string | undefined,
): PermissionOption<T> | null {
  if (!options || !value) {
    return null;
  }
  return options.find((option) => option.value === value) ?? null;
}

export function PermissionPicker({
  disabled = false,
  trustScopeLabel,
  trustValue,
  trustOptions,
  onTrustChange,
  customPolicyCount = 0,
  approvalTitle,
  approvalValue,
  approvalSelectedLabel,
  approvalOptions,
  onApprovalChange,
  sandboxValue,
  sandboxOptions,
  onSandboxChange,
  sandboxNotice,
  sandboxSelectedLabel,
  networkValue,
  networkOptions,
  onNetworkChange,
  networkDisabled = false,
  networkNotice,
}: PermissionPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  const resolvedApprovalTitle = approvalTitle ?? t("permissionPicker.approvalPolicy");

  const trustOption = useMemo(
    () => findOption(trustOptions, trustValue),
    [trustOptions, trustValue],
  );

  const railItems = useMemo<RailItem[]>(() => {
    const items: RailItem[] = [];

    if (trustScopeLabel && trustValue && trustOptions && onTrustChange) {
      items.push({
        id: "trust",
        icon: <Shield size={13} />,
        title: trustScopeLabel,
        currentLabel: findOption(trustOptions, trustValue)?.label ?? null,
        options: trustOptions as PermissionOption[],
        value: trustValue,
        onChange: (value) => onTrustChange(value as TrustLevel),
      });
    }

    if (approvalOptions && approvalValue !== undefined) {
      items.push({
        id: "approval",
        icon: <Shield size={13} />,
        title: resolvedApprovalTitle,
        currentLabel:
          approvalSelectedLabel ??
          findOption(approvalOptions, approvalValue)?.label ??
          null,
        options: approvalOptions,
        value: approvalValue,
        onChange: onApprovalChange,
      });
    }

    if (sandboxOptions && sandboxValue !== undefined) {
      items.push({
        id: "sandbox",
        icon: <SquareTerminal size={13} />,
        title: t("permissionPicker.sandboxMode"),
        currentLabel:
          sandboxSelectedLabel ??
          findOption(sandboxOptions, sandboxValue)?.label ??
          null,
        options: sandboxOptions,
        value: sandboxValue,
        onChange: onSandboxChange,
        note: sandboxNotice,
      });
    }

    if (networkOptions && networkValue !== undefined) {
      items.push({
        id: "network",
        icon: <Monitor size={13} />,
        title: t("permissionPicker.networkAccess"),
        currentLabel: findOption(networkOptions, networkValue)?.label ?? null,
        options: networkOptions,
        value: networkValue,
        onChange: onNetworkChange,
        disabled: networkDisabled,
        note: networkNotice,
      });
    }

    return items;
  }, [
    networkDisabled,
    networkNotice,
    networkOptions,
    networkValue,
    onApprovalChange,
    onNetworkChange,
    onSandboxChange,
    onTrustChange,
    approvalOptions,
    approvalValue,
    resolvedApprovalTitle,
    sandboxNotice,
    sandboxOptions,
    sandboxSelectedLabel,
    sandboxValue,
    t,
    trustOptions,
    trustScopeLabel,
    trustValue,
  ]);

  useEffect(() => {
    if (open) {
      if (railItems.length > 0 && !activeSection) {
        setActiveSection(railItems[0].id);
      }
    } else {
      setActiveSection("");
    }
  }, [activeSection, open, railItems]);

  const summaryLines = useMemo(() => {
    const lines: string[] = [];
    if (trustScopeLabel && trustOption) {
      lines.push(`${trustScopeLabel}: ${trustOption.label}`);
    }
    if (approvalValue) {
      const label = findOption(approvalOptions, approvalValue)?.label;
      if (approvalSelectedLabel ?? label) {
        lines.push(`${resolvedApprovalTitle}: ${approvalSelectedLabel ?? label}`);
      }
    }
    if (sandboxValue) {
      lines.push(
        `${t("permissionPicker.sandbox")}: ${
          sandboxSelectedLabel ??
          findOption(sandboxOptions, sandboxValue)?.label ??
          sandboxValue
        }`,
      );
    }
    if (networkValue) {
      lines.push(
        `${t("permissionPicker.network")}: ${
          findOption(networkOptions, networkValue)?.label ?? networkValue
        }`,
      );
    }
    return lines;
  }, [
    approvalOptions,
    approvalSelectedLabel,
    approvalValue,
    networkOptions,
    networkValue,
    resolvedApprovalTitle,
    sandboxOptions,
    sandboxSelectedLabel,
    sandboxValue,
    t,
    trustOption,
    trustScopeLabel,
  ]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 460));

    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const toggle = useCallback(() => {
    if (disabled) {
      return;
    }
    setOpen((prev) => !prev);
  }, [disabled]);

  const title = summaryLines.length > 0 ? summaryLines.join(" | ") : t("permissionPicker.title");
  const activeItem = railItems.find((item) => item.id === activeSection) ?? null;

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="pp-popover"
          style={{
            position: "fixed",
            bottom: pos.bottom,
            left: pos.left,
          }}
        >
          <div className="pp-rail">
            <div className="pp-rail-label">{t("permissionPicker.policy")}</div>
            {railItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pp-rail-item${activeSection === item.id ? " pp-rail-item-active" : ""}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="pp-rail-item-icon">{item.icon}</span>
                <span className="pp-rail-item-name">{item.title}</span>
              </button>
            ))}
          </div>

          {activeItem ? (
            <div className="pp-panel">
              <div className="pp-panel-header">
                <div className="pp-panel-title">
                  <span>{activeItem.title}</span>
                </div>
                {customPolicyCount > 0 ? (
                  <span className="pp-header-badge">{t("permissionPicker.custom")}</span>
                ) : null}
              </div>
              <div className="pp-panel-content">
                <div className="pp-options">
                  {activeItem.options.map((option) => {
                    const selected = option.value === activeItem.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`pp-option${selected ? " pp-option-selected" : ""}`}
                        onClick={() => activeItem.onChange?.(option.value)}
                        disabled={activeItem.disabled}
                      >
                        <div className="pp-option-copy">
                          <span className="pp-option-label">{option.label}</span>
                          {option.description ? (
                            <span className="pp-option-description">{option.description}</span>
                          ) : null}
                        </div>
                        {selected ? <Check size={13} className="pp-option-check" /> : null}
                      </button>
                    );
                  })}
                </div>
                {activeItem.note ? <p className="pp-section-note">{activeItem.note}</p> : null}
              </div>
            </div>
          ) : null}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="pp-root">
      <button
        ref={triggerRef}
        type="button"
        className={`pp-trigger${open ? " pp-trigger-open" : ""}`}
        onClick={toggle}
        disabled={disabled}
        title={title}
      >
        <span className="pp-trigger-icon">
          <Shield size={12} />
        </span>
        <span className="pp-trigger-label">{t("permissionPicker.title")}</span>
        {trustOption ? <span className="pp-trigger-pill">{trustOption.label}</span> : null}
        {customPolicyCount > 0 ? (
          <span className="pp-trigger-pill pp-trigger-pill-accent">{t("permissionPicker.custom")}</span>
        ) : null}
        <ChevronDown
          size={10}
          className={`pp-trigger-chevron${open ? " pp-trigger-chevron-open" : ""}`}
        />
      </button>
      {popover}
    </div>
  );
}
