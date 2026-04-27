import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OpenCodeAgent } from "../../types";

interface OpenCodeAgentPickerProps {
  agents: OpenCodeAgent[];
  selectedAgent: string;
  onAgentChange: (agent: string) => void;
  disabled?: boolean;
}

function isSelectableAgent(agent: OpenCodeAgent): boolean {
  return !agent.hidden && (agent.mode === "primary" || agent.mode === "all");
}

function buildAgentOptions(agents: OpenCodeAgent[]): OpenCodeAgent[] {
  const visible = agents.filter(isSelectableAgent);
  if (visible.some((agent) => agent.name === "build")) {
    return visible;
  }
  return [
    {
      name: "build",
      description: null,
      mode: "primary",
      native: true,
      hidden: false,
      modelProviderId: null,
      modelId: null,
      variant: null,
      steps: null,
    },
    ...visible,
  ];
}

function formatAgentLabel(name: string): string {
  if (name === "build") {
    return "Build";
  }
  if (name === "plan") {
    return "Plan";
  }
  return name;
}

export function OpenCodeAgentPicker({
  agents,
  selectedAgent,
  onAgentChange,
  disabled = false,
}: OpenCodeAgentPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const options = useMemo(() => buildAgentOptions(agents), [agents]);
  const selected =
    options.find((agent) => agent.name === selectedAgent) ?? options[0] ?? null;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
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

  const label = selected
    ? formatAgentLabel(selected.name)
    : t("openCodeAgentPicker.selectAgent");

  return (
    <div className="oc-agent-root">
      <button
        ref={triggerRef}
        type="button"
        className={`oc-agent-trigger${open ? " oc-agent-trigger-open" : ""}`}
        onClick={() => !disabled && setOpen((value) => !value)}
        disabled={disabled}
        title={t("openCodeAgentPicker.title")}
      >
        <Bot size={12} />
        <span className="oc-agent-trigger-label">{label}</span>
        <ChevronDown size={11} className="oc-agent-trigger-chevron" />
      </button>
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="oc-agent-popover"
              style={{
                position: "fixed",
                bottom: pos.bottom,
                left: pos.left,
              }}
            >
              <div className="oc-agent-header">{t("openCodeAgentPicker.title")}</div>
              <div className="oc-agent-list">
                {options.map((agent) => {
                  const active = agent.name === selectedAgent;
                  const modelLabel =
                    agent.modelProviderId && agent.modelId
                      ? `${agent.modelProviderId}/${agent.modelId}`
                      : null;
                  return (
                    <button
                      key={agent.name}
                      type="button"
                      className={`oc-agent-option${active ? " oc-agent-option-active" : ""}`}
                      onClick={() => {
                        onAgentChange(agent.name);
                        setOpen(false);
                      }}
                    >
                      <span className="oc-agent-option-copy">
                        <span className="oc-agent-option-name">
                          {formatAgentLabel(agent.name)}
                        </span>
                        {agent.description ? (
                          <span className="oc-agent-option-detail">{agent.description}</span>
                        ) : null}
                        {modelLabel ? (
                          <span className="oc-agent-option-meta">{modelLabel}</span>
                        ) : null}
                      </span>
                      {active ? <Check size={13} className="oc-agent-option-check" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
