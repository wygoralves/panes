import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Monitor, Shield, SquareTerminal } from "lucide-react";
import type { TrustLevel } from "../../types";

type PermissionOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
};

interface PermissionPickerProps {
  disabled?: boolean;
  trustScopeLabel?: string;
  trustValue?: TrustLevel;
  trustOptions?: PermissionOption<TrustLevel>[];
  onTrustChange?: (value: TrustLevel) => void;
  customPolicyCount?: number;
  approvalValue?: string;
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
  approvalValue,
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  const trustOption = useMemo(
    () => findOption(trustOptions, trustValue),
    [trustOptions, trustValue],
  );
  const approvalOption = useMemo(
    () => findOption(approvalOptions, approvalValue),
    [approvalOptions, approvalValue],
  );
  const sandboxOption = useMemo(
    () => findOption(sandboxOptions, sandboxValue),
    [sandboxOptions, sandboxValue],
  );
  const networkOption = useMemo(
    () => findOption(networkOptions, networkValue),
    [networkOptions, networkValue],
  );

  const summaryLines = useMemo(() => {
    const lines: string[] = [];
    if (trustScopeLabel && trustOption) {
      lines.push(`${trustScopeLabel}: ${trustOption.label}`);
    }
    if (approvalOption) {
      lines.push(`Approvals: ${approvalOption.label}`);
    }
    if (sandboxValue) {
      lines.push(`Sandbox: ${sandboxSelectedLabel ?? sandboxOption?.label ?? sandboxValue}`);
    }
    if (networkValue) {
      lines.push(`Network: ${networkOption?.label ?? networkValue}`);
    }
    return lines;
  }, [
    approvalOption,
    networkOption,
    networkValue,
    sandboxOption,
    sandboxSelectedLabel,
    sandboxValue,
    trustOption,
    trustScopeLabel,
  ]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));

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

  const title = summaryLines.length > 0 ? summaryLines.join(" | ") : "Permissions";
  const hasThreadControls = Boolean(approvalOptions && sandboxOptions && networkOptions);

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
          <div className="pp-header">
            <div className="pp-header-title">
              <Shield size={13} />
              <span>Permissions</span>
            </div>
            {customPolicyCount > 0 ? (
              <span className="pp-header-badge">Custom thread policy</span>
            ) : null}
          </div>

          <div className="pp-sections">
            {trustScopeLabel && trustValue && trustOptions && onTrustChange ? (
              <PolicySection
                icon={<Shield size={13} />}
                title={trustScopeLabel}
                value={trustValue}
                options={trustOptions}
                onChange={(value) => onTrustChange(value as TrustLevel)}
              />
            ) : null}

            {hasThreadControls ? (
              <>
                <PolicySection
                  icon={<Shield size={13} />}
                  title="Approval policy"
                  value={approvalValue ?? ""}
                  options={approvalOptions ?? []}
                  onChange={onApprovalChange}
                />
                <PolicySection
                  icon={<SquareTerminal size={13} />}
                  title="Sandbox mode"
                  value={sandboxValue ?? ""}
                  valueLabel={sandboxSelectedLabel ?? undefined}
                  options={sandboxOptions ?? []}
                  onChange={onSandboxChange}
                  note={sandboxNotice}
                />
                <PolicySection
                  icon={<Monitor size={13} />}
                  title="Network access"
                  value={networkValue ?? ""}
                  options={networkOptions ?? []}
                  onChange={onNetworkChange}
                  disabled={networkDisabled}
                  note={networkNotice}
                />
              </>
            ) : null}
          </div>
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
        <span className="pp-trigger-label">Permissions</span>
        {trustOption ? (
          <span className="pp-trigger-pill">{trustOption.label}</span>
        ) : null}
        {customPolicyCount > 0 ? (
          <span className="pp-trigger-pill pp-trigger-pill-accent">Custom</span>
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

function PolicySection({
  icon,
  title,
  value,
  valueLabel,
  options,
  onChange,
  disabled = false,
  note,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  valueLabel?: string;
  options: PermissionOption[];
  onChange?: (value: string) => void;
  disabled?: boolean;
  note?: string | null;
}) {
  const selectedOption = findOption(options, value);
  const currentLabel = valueLabel ?? selectedOption?.label ?? value;
  const currentDescription = selectedOption?.description;

  return (
    <section className="pp-section">
      <div className="pp-section-header">
        <div className="pp-section-title">
          <span className="pp-section-icon">{icon}</span>
          <span>{title}</span>
        </div>
        {currentLabel ? (
          <span className="pp-section-value">{currentLabel}</span>
        ) : null}
      </div>

      {currentDescription ? (
        <p className="pp-section-description">{currentDescription}</p>
      ) : null}

      <div className="pp-options">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`pp-option${selected ? " pp-option-selected" : ""}`}
              onClick={() => onChange?.(option.value)}
              disabled={disabled}
              title={option.description}
            >
              <div className="pp-option-copy">
                <span className="pp-option-label">{option.label}</span>
                {option.description ? (
                  <span className="pp-option-description">{option.description}</span>
                ) : null}
              </div>
              {selected ? (
                <Check size={13} className="pp-option-check" />
              ) : null}
            </button>
          );
        })}
      </div>

      {note ? <p className="pp-section-note">{note}</p> : null}
    </section>
  );
}
