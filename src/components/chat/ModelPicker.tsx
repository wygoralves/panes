import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { EngineHealth, EngineInfo, EngineModel } from "../../types";

/* ── Props ── */

interface ModelPickerProps {
  engines: EngineInfo[];
  health: Record<string, EngineHealth>;
  selectedEngineId: string;
  selectedModelId: string | null;
  selectedEffort: string;
  onEngineModelChange: (engineId: string, modelId: string) => void;
  onEffortChange: (effort: string) => void;
  disabled?: boolean;
}

/* ── Helpers ── */

function formatModelName(name: string): string {
  const tokens: Record<string, string> = {
    gpt: "GPT",
    codex: "Codex",
    claude: "Claude",
    opus: "Opus",
    sonnet: "Sonnet",
    haiku: "Haiku",
    mini: "Mini",
  };
  return name
    .split("-")
    .filter(Boolean)
    .map((s) => {
      const lower = s.toLowerCase();
      if (tokens[lower]) return tokens[lower];
      if (/^\d+(\.\d+)*$/.test(s)) return s;
      if (/^[a-z]?\d+(\.\d+)*$/i.test(s)) return s.toUpperCase();
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .join(" ");
}

function shortEffortLabel(t: TFunction<"chat">, effort: string): string {
  switch (effort) {
    case "none": return t("modelPicker.effort.noneShort");
    case "minimal": return t("modelPicker.effort.minimalShort");
    case "low": return t("modelPicker.effort.lowShort");
    case "medium": return t("modelPicker.effort.mediumShort");
    case "high": return t("modelPicker.effort.highShort");
    case "xhigh": return t("modelPicker.effort.xhighShort");
    default: return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
}

function effortDisplayLabel(t: TFunction<"chat">, effort: string): string {
  switch (effort) {
    case "none": return t("modelPicker.effort.none");
    case "minimal": return t("modelPicker.effort.minimal");
    case "low": return t("modelPicker.effort.low");
    case "medium": return t("modelPicker.effort.medium");
    case "high": return t("modelPicker.effort.high");
    case "xhigh": return t("modelPicker.effort.xhigh");
    default: return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
}

function resolveUpgradeName(
  upgradeId: string | undefined,
  models: EngineModel[],
): string | null {
  if (!upgradeId) return null;
  const target = models.find((m) => m.id === upgradeId);
  return formatModelName(target?.displayName ?? upgradeId);
}

function firstMeaningfulLine(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line && line.length > 0 ? line : null;
}

function resolveModelUpgradeHint(
  t: TFunction<"chat">,
  model: EngineModel,
  models: EngineModel[],
): string | null {
  const explicitHint =
    model.upgradeInfo?.upgradeCopy?.trim() ||
    firstMeaningfulLine(model.upgradeInfo?.migrationMarkdown) ||
    null;
  if (explicitHint) {
    return explicitHint;
  }

  const upgradeTarget = model.upgradeInfo?.model ?? model.upgrade;
  const upgradeName = resolveUpgradeName(upgradeTarget, models);
  if (!upgradeName) {
    return null;
  }
  return t("modelPicker.upgradeAvailable", { model: upgradeName });
}

/* ── Component ── */

export function ModelPicker({
  engines,
  health,
  selectedEngineId,
  selectedModelId,
  selectedEffort,
  onEngineModelChange,
  onEffortChange,
  disabled = false,
}: ModelPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [activeEngineId, setActiveEngineId] = useState(selectedEngineId);
  const [legacyExpanded, setLegacyExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  // Sync active engine when selection changes externally
  useEffect(() => {
    setActiveEngineId(selectedEngineId);
  }, [selectedEngineId]);

  // Reset legacy expanded when engine changes
  useEffect(() => {
    setLegacyExpanded(false);
  }, [activeEngineId]);

  // Position popover above trigger
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 460));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  // Click outside + Escape
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
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

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((prev) => !prev);
  }, [disabled]);

  // Resolve current selection for trigger label
  const currentEngine = engines.find((e) => e.id === selectedEngineId) ?? engines[0];
  const currentModel =
    currentEngine?.models.find((m) => m.id === selectedModelId) ??
    currentEngine?.models.find((m) => !m.hidden) ??
    null;

  // Active engine in popover (for browsing)
  const browsingEngine = engines.find((e) => e.id === activeEngineId) ?? engines[0];
  const browsingModels = browsingEngine?.models ?? [];
  const activeModels = browsingModels.filter((m) => !m.hidden);
  const legacyModels = browsingModels.filter((m) => m.hidden);

  function handleModelSelect(engineId: string, modelId: string) {
    onEngineModelChange(engineId, modelId);
    // Keep popover open so the user can adjust reasoning effort
  }

  // Build trigger label
  const triggerLabel = currentModel
    ? formatModelName(currentModel.displayName)
    : currentEngine?.name ?? t("modelPicker.selectModel");

  /* ── Trigger ── */
  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={`mp-trigger${open ? " mp-trigger-open" : ""}`}
      onClick={toggle}
      disabled={disabled}
      title={t("modelPicker.selectModel")}
    >
      <span className="mp-trigger-icon">
        {getHarnessIcon(selectedEngineId, 12)}
      </span>
      <span className="mp-trigger-label">{triggerLabel}</span>
      {selectedEffort && currentModel?.supportedReasoningEfforts?.length ? (
        <span className="mp-trigger-effort">{shortEffortLabel(t, selectedEffort)}</span>
      ) : null}
      <ChevronDown
        size={10}
        className={`mp-trigger-chevron${open ? " mp-trigger-chevron-open" : ""}`}
      />
    </button>
  );

  /* ── Popover ── */
  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="mp-popover"
          style={{
            position: "fixed",
            bottom: pos.bottom,
            left: pos.left,
          }}
        >
          {/* Engine rail */}
          <div className="mp-rail">
            <div className="mp-rail-label">{t("modelPicker.engine")}</div>
            {engines.map((engine) => {
              const isActive = engine.id === activeEngineId;
              const engineHealth = health[engine.id];
              const available = engineHealth?.available !== false;
              return (
                <button
                  key={engine.id}
                  type="button"
                  className={`mp-rail-engine${isActive ? " mp-rail-engine-active" : ""}`}
                  onClick={() => setActiveEngineId(engine.id)}
                >
                  <span className="mp-rail-engine-icon">
                    {getHarnessIcon(engine.id, 15)}
                  </span>
                  <span className="mp-rail-engine-name">{engine.name}</span>
                  <span
                    className={`mp-rail-dot${available ? " mp-rail-dot-ok" : " mp-rail-dot-err"}`}
                  />
                </button>
              );
            })}
          </div>

          {/* Models panel */}
          <div className="mp-models">
            <div className="mp-models-header">
              <span className="mp-models-title">{t("modelPicker.models")}</span>
              <span className="mp-models-count">{activeModels.length}</span>
            </div>

            <div className="mp-models-list">
              {activeModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  engineId={activeEngineId}
                  allModels={browsingModels}
                  isSelected={
                    selectedEngineId === activeEngineId &&
                    model.id === (selectedModelId ?? currentModel?.id)
                  }
                  selectedEffort={selectedEffort}
                  onSelect={handleModelSelect}
                  onEffortChange={onEffortChange}
                />
              ))}

              {legacyModels.length > 0 && (
                <>
                  <button
                    type="button"
                    className="mp-legacy-toggle"
                    onClick={() => setLegacyExpanded((prev) => !prev)}
                  >
                    <span className="mp-legacy-toggle-label">
                      {t("modelPicker.legacy", { count: legacyModels.length })}
                    </span>
                    <ChevronRight
                      size={11}
                      className={`mp-legacy-chevron${legacyExpanded ? " mp-legacy-chevron-open" : ""}`}
                    />
                  </button>
                  {legacyExpanded &&
                    legacyModels.map((model) => (
                      <ModelRow
                        key={model.id}
                        model={model}
                        engineId={activeEngineId}
                        allModels={browsingModels}
                        isSelected={
                          selectedEngineId === activeEngineId &&
                          model.id === (selectedModelId ?? currentModel?.id)
                        }
                        selectedEffort={selectedEffort}
                        onSelect={handleModelSelect}
                        onEffortChange={onEffortChange}
                      />
                    ))}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="mp-root">
      {trigger}
      {popover}
    </div>
  );
}

/* ── Model Row ── */

function ModelRow({
  model,
  engineId,
  allModels,
  isSelected,
  selectedEffort,
  onSelect,
  onEffortChange,
}: {
  model: EngineModel;
  engineId: string;
  allModels: EngineModel[];
  isSelected: boolean;
  selectedEffort: string;
  onSelect: (engineId: string, modelId: string) => void;
  onEffortChange: (effort: string) => void;
}) {
  const { t } = useTranslation("chat");
  const upgradeName = resolveUpgradeName(model.upgrade, allModels);
  const upgradeHint = resolveModelUpgradeHint(t, model, allModels);
  const availabilityHint = model.availabilityNux?.message?.trim() || null;
  const efforts = model.supportedReasoningEfforts ?? [];
  const supportsImages = model.inputModalities?.includes("image") ?? false;
  const supportsPersonality = model.supportsPersonality === true;

  return (
    <div className={`mp-model${isSelected ? " mp-model-selected" : ""}`}>
      <button
        type="button"
        className="mp-model-btn"
        onClick={() => onSelect(engineId, model.id)}
      >
        <div className="mp-model-info">
          <div className="mp-model-name-row">
            <span className="mp-model-name">
              {formatModelName(model.displayName)}
            </span>
            {model.isDefault && (
              <span className="mp-model-default">{t("modelPicker.default")}</span>
            )}
          </div>
          {model.description && (
            <span className="mp-model-desc">{model.description}</span>
          )}
          <div className="mp-model-badges">
            {supportsImages ? (
              <span className="mp-model-badge">{t("modelPicker.modalities.image")}</span>
            ) : (
              <span className="mp-model-badge">{t("modelPicker.modalities.textOnly")}</span>
            )}
            {supportsPersonality && (
              <span className="mp-model-badge">{t("modelPicker.supportsPersonality")}</span>
            )}
            {upgradeName && !upgradeHint && (
              <span className="mp-model-badge">
                {t("modelPicker.upgradeAvailable", { model: upgradeName })}
              </span>
            )}
          </div>
          {upgradeHint && (
            <span className="mp-model-upgrade">{upgradeHint}</span>
          )}
          {availabilityHint && (
            <span className="mp-model-upgrade">{availabilityHint}</span>
          )}
        </div>
        {isSelected && (
          <Check size={13} className="mp-model-check" />
        )}
      </button>

      {/* Inline effort selector — only on selected model */}
      {isSelected && efforts.length > 0 && (
        <div className="mp-effort">
          <span className="mp-effort-label">{t("modelPicker.thinking")}</span>
          <div className="mp-effort-pills">
            {efforts.map((opt) => {
              const active = opt.reasoningEffort === selectedEffort;
              return (
                <button
                  key={opt.reasoningEffort}
                  type="button"
                  className={`mp-effort-pill${active ? " mp-effort-pill-active" : ""}`}
                  onClick={() => onEffortChange(opt.reasoningEffort)}
                  title={opt.description}
                >
                  {effortDisplayLabel(t, opt.reasoningEffort)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
