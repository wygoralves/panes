import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FileX2,
  Image as ImageIcon,
  Paperclip,
  Search,
  Zap,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useEngineStore } from "../../stores/engineStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { EngineHealth, EngineInfo, EngineModel } from "../../types";
import type { CodexServiceTierValue } from "./CodexConfigPicker";

interface ModelPickerProps {
  engines: EngineInfo[];
  health: Record<string, EngineHealth>;
  selectedEngineId: string;
  selectedModelId: string | null;
  selectedEffort: string;
  selectedServiceTier: CodexServiceTierValue;
  onEngineModelChange: (engineId: string, modelId: string) => void;
  onEffortChange: (effort: string) => void;
  onServiceTierChange: (serviceTier: CodexServiceTierValue) => void;
  disabled?: boolean;
}

export interface OpenCodeProviderModelGroup {
  providerId: string;
  providerLabel: string;
  activeModels: EngineModel[];
  legacyModels: EngineModel[];
  totalModelCount: number;
}

export type ModelPickerSectionId =
  | "harness"
  | "provider"
  | "model"
  | "reasoning"
  | "speed";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  azure: "Azure",
  bedrock: "Bedrock",
  github: "GitHub",
  google: "Google",
  groq: "Groq",
  local: "Local",
  lmstudio: "LM Studio",
  mistral: "Mistral",
  ollama: "Ollama",
  openai: "OpenAI",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  vertex: "Vertex",
  vllm: "vLLM",
};

function formatModelName(name: string): string {
  const tokens: Record<string, string> = {
    gpt: "GPT",
    codex: "Codex",
    opencode: "OpenCode",
    claude: "Claude",
    opus: "Opus",
    sonnet: "Sonnet",
    haiku: "Haiku",
    mini: "Mini",
  };
  const slashParts = name
    .split("/")
    .filter(Boolean)
    .map((part) => part.trim())
    .filter(Boolean);
  const displayParts =
    slashParts.length > 2 && slashParts[0]?.toLowerCase() === "openrouter"
      ? slashParts.slice(2)
      : slashParts.length > 1
        ? slashParts.slice(1)
        : slashParts;
  const source = displayParts.length > 0 ? displayParts : [name];
  return source
    .map((part) =>
      part
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((segment) => {
          const lower = segment.toLowerCase();
          if (tokens[lower]) return tokens[lower];
          if (/^\d+(\.\d+)*$/.test(segment)) return segment;
          if (/^[a-z]?\d+(\.\d+)*$/i.test(segment)) return segment.toUpperCase();
          return segment.charAt(0).toUpperCase() + segment.slice(1);
        })
        .join(" "),
    )
    .join(" / ");
}

export function getOpenCodeProviderId(modelId: string): string {
  const parts = modelId
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return "local";
  }
  if (parts[0]?.toLowerCase() === "openrouter" && parts.length > 2) {
    return parts[1].toLowerCase();
  }
  return parts[0].toLowerCase();
}

export function formatOpenCodeProviderName(providerId: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (PROVIDER_LABELS[normalized]) {
    return PROVIDER_LABELS[normalized];
  }
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => PROVIDER_LABELS[part] ?? formatModelName(part))
    .join(" ");
}

export function groupOpenCodeModels(models: EngineModel[]): OpenCodeProviderModelGroup[] {
  const groups = new Map<string, OpenCodeProviderModelGroup>();
  for (const model of models) {
    const providerId = getOpenCodeProviderId(model.id);
    let group = groups.get(providerId);
    if (!group) {
      group = {
        providerId,
        providerLabel: formatOpenCodeProviderName(providerId),
        activeModels: [],
        legacyModels: [],
        totalModelCount: 0,
      };
      groups.set(providerId, group);
    }

    group.totalModelCount += 1;
    if (model.hidden) {
      group.legacyModels.push(model);
    } else {
      group.activeModels.push(model);
    }
  }

  return Array.from(groups.values());
}

export function filterOpenCodeModelsForQuery(
  models: EngineModel[],
  query: string,
): EngineModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return models;
  }

  return models.filter((model) => {
    const searchable = [
      model.id,
      model.displayName,
      model.description,
      formatModelName(model.displayName),
    ]
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalized);
  });
}

export function formatCompactTokenLimit(tokens?: number | null): string | null {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${value.toFixed(0)}K`;
  }
  return tokens.toString();
}

interface ModelMetadataChip {
  label: string;
  title?: string;
  icon?: "vision" | "pdf" | "files" | "no-files";
}

export function modelMetadataChips(
  t: TFunction<"chat">,
  model: EngineModel,
): ModelMetadataChip[] {
  const chips: ModelMetadataChip[] = [];
  const attachmentModalities = new Set(
    (model.attachmentModalities ?? []).map((modality) => modality.toLowerCase()),
  );

  if (attachmentModalities.has("image")) {
    chips.push({ label: t("modelPicker.metadata.vision"), icon: "vision" });
  }
  if (attachmentModalities.has("pdf")) {
    chips.push({ label: t("modelPicker.metadata.pdf"), icon: "pdf" });
  }
  if (attachmentModalities.has("text")) {
    chips.push({ label: t("modelPicker.metadata.files"), icon: "files" });
  } else if ((model.attachmentModalities ?? []).length === 0) {
    chips.push({ label: t("modelPicker.metadata.noFiles"), icon: "no-files" });
  }

  const contextLimit = formatCompactTokenLimit(model.limits?.contextTokens);
  const inputLimit = formatCompactTokenLimit(model.limits?.inputTokens);
  const outputLimit = formatCompactTokenLimit(model.limits?.outputTokens);
  if (contextLimit) {
    chips.push({
      label: t("modelPicker.metadata.contextLimit", { tokens: contextLimit }),
    });
  } else if (inputLimit) {
    chips.push({
      label: t("modelPicker.metadata.inputLimit", { tokens: inputLimit }),
    });
  }
  if (outputLimit) {
    chips.push({
      label: t("modelPicker.metadata.outputLimit", { tokens: outputLimit }),
    });
  }

  return chips;
}

function modelMetadataIcon(icon: ModelMetadataChip["icon"]) {
  switch (icon) {
    case "vision":
      return <ImageIcon size={11} aria-hidden="true" />;
    case "pdf":
      return <FileText size={11} aria-hidden="true" />;
    case "files":
      return <Paperclip size={11} aria-hidden="true" />;
    case "no-files":
      return <FileX2 size={11} aria-hidden="true" />;
    default:
      return null;
  }
}

function ModelMetadata({ chips }: { chips: ModelMetadataChip[] }) {
  return (
    <span className="mp-model-meta">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`mp-model-meta-chip${chip.icon ? " mp-model-meta-icon" : ""}`}
          title={chip.title ?? chip.label}
          role={chip.icon ? "img" : undefined}
          aria-label={chip.icon ? chip.label : undefined}
        >
          {chip.icon ? modelMetadataIcon(chip.icon) : chip.label}
        </span>
      ))}
    </span>
  );
}

function shouldShowModelDescription(engineId: string, model: EngineModel): boolean {
  if (!model.description) {
    return false;
  }
  return !(engineId === "opencode" && model.description.trim() === "OpenCode model");
}

function shortEffortLabel(t: TFunction<"chat">, effort: string): string {
  switch (effort) {
    case "none": return t("modelPicker.effort.noneShort");
    case "minimal": return t("modelPicker.effort.minimalShort");
    case "low": return t("modelPicker.effort.lowShort");
    case "medium": return t("modelPicker.effort.mediumShort");
    case "high": return t("modelPicker.effort.highShort");
    case "xhigh": return t("modelPicker.effort.xhighShort");
    case "max": return t("modelPicker.effort.maxShort");
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
    case "max": return t("modelPicker.effort.max");
    default: return effort.charAt(0).toUpperCase() + effort.slice(1);
  }
}

export function shouldUseCompactEffortLabels(effortCount: number): boolean {
  return effortCount >= 5;
}

export function getModelPickerSectionIds(
  engineId: string,
  model: EngineModel | null,
): ModelPickerSectionId[] {
  const sections: ModelPickerSectionId[] = ["harness"];
  if (engineId === "opencode") {
    sections.push("provider");
  }
  sections.push("model");
  if ((model?.supportedReasoningEfforts?.length ?? 0) > 0) {
    sections.push("reasoning");
  }
  if (engineId === "codex") {
    sections.push("speed");
  }
  return sections;
}

export function ModelPicker({
  engines,
  health,
  selectedEngineId,
  selectedModelId,
  selectedEffort,
  selectedServiceTier,
  onEngineModelChange,
  onEffortChange,
  onServiceTierChange,
  disabled = false,
}: ModelPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<ModelPickerSectionId>("model");
  const [openCodeModelQuery, setOpenCodeModelQuery] = useState("");
  const [legacyExpanded, setLegacyExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const ensureEngineHealth = useEngineStore((state) => state.ensureHealth);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = true;

    for (const engine of engines) {
      const engineHealth = health[engine.id];
      if (!engineHealth) {
        void ensureEngineHealth(engine.id);
        continue;
      }
      if (engineHealth.available === false) {
        void ensureEngineHealth(engine.id, { force: true });
      }
    }
  }, [engines, ensureEngineHealth, health, open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popoverWidth = Math.min(620, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

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
    if (disabled) return;
    setOpen((previous) => !previous);
  }, [disabled]);

  const currentEngine = engines.find((engine) => engine.id === selectedEngineId) ?? engines[0];
  const currentModel =
    currentEngine?.models.find((model) => model.id === selectedModelId) ??
    currentEngine?.models.find((model) => model.isDefault && !model.hidden) ??
    currentEngine?.models.find((model) => !model.hidden) ??
    null;
  const currentModels = currentEngine?.models ?? [];
  const currentEfforts = currentModel?.supportedReasoningEfforts ?? [];
  const openCodeProviderGroups = useMemo(
    () => groupOpenCodeModels(currentModels),
    [currentModels],
  );
  const currentOpenCodeProviderId =
    selectedEngineId === "opencode" && currentModel
      ? getOpenCodeProviderId(currentModel.id)
      : null;
  const currentOpenCodeProvider =
    openCodeProviderGroups.find((group) => group.providerId === currentOpenCodeProviderId) ??
    openCodeProviderGroups[0] ??
    null;
  const sectionIds = getModelPickerSectionIds(selectedEngineId, currentModel);

  useEffect(() => {
    if (!sectionIds.includes(activeSection)) {
      setActiveSection("model");
    }
  }, [activeSection, sectionIds]);

  useEffect(() => {
    setLegacyExpanded(false);
    if (selectedEngineId !== "opencode") {
      setOpenCodeModelQuery("");
    }
  }, [selectedEngineId, selectedModelId]);

  function defaultModelForEngine(engine: EngineInfo): EngineModel | null {
    return (
      engine.models.find((model) => !model.hidden && model.isDefault) ??
      engine.models.find((model) => !model.hidden) ??
      engine.models[0] ??
      null
    );
  }

  function handleHarnessSelect(engine: EngineInfo) {
    if (engine.id === selectedEngineId) {
      return;
    }
    const nextModel = defaultModelForEngine(engine);
    if (!nextModel) {
      return;
    }
    onEngineModelChange(engine.id, nextModel.id);
    setActiveSection(engine.id === "opencode" ? "provider" : "model");
  }

  function handleProviderSelect(group: OpenCodeProviderModelGroup) {
    const nextModel =
      group.activeModels.find((model) => model.isDefault) ??
      group.activeModels[0] ??
      group.legacyModels[0] ??
      null;
    if (!nextModel) {
      return;
    }
    onEngineModelChange("opencode", nextModel.id);
    setOpenCodeModelQuery("");
  }

  function handleModelSelect(engineId: string, modelId: string) {
    onEngineModelChange(engineId, modelId);
  }

  function renderModelOptions() {
    const activeModels = selectedEngineId === "opencode"
      ? currentOpenCodeProvider?.activeModels ?? []
      : currentModels.filter((model) => !model.hidden);
    const legacyModels = selectedEngineId === "opencode"
      ? currentOpenCodeProvider?.legacyModels ?? []
      : currentModels.filter((model) => model.hidden);
    const filteredActiveModels = filterOpenCodeModelsForQuery(activeModels, openCodeModelQuery);
    const filteredLegacyModels = filterOpenCodeModelsForQuery(legacyModels, openCodeModelQuery);
    const visibleCount = filteredActiveModels.length + filteredLegacyModels.length;
    const totalCount = activeModels.length + legacyModels.length;

    return (
      <>
        {selectedEngineId === "opencode" ? (
          <div className="mp-model-search">
            <Search size={12} className="mp-model-search-icon" />
            <input
              className="mp-model-search-input"
              value={openCodeModelQuery}
              onChange={(event) => setOpenCodeModelQuery(event.target.value)}
              placeholder={t("modelPicker.searchModels")}
              aria-label={t("modelPicker.searchModels")}
            />
            <span className="mp-model-search-count">
              {openCodeModelQuery.trim() ? `${visibleCount}/${totalCount}` : totalCount}
            </span>
          </div>
        ) : null}

        <div className="mp-models-list">
          {filteredActiveModels.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              engineId={selectedEngineId}
              isSelected={model.id === (selectedModelId ?? currentModel?.id)}
              onSelect={handleModelSelect}
            />
          ))}

          {filteredLegacyModels.length > 0 ? (
            <>
              <button
                type="button"
                className="mp-legacy-toggle"
                onClick={() => setLegacyExpanded((previous) => !previous)}
                aria-expanded={legacyExpanded}
              >
                <span className="mp-legacy-toggle-label">
                  {t("modelPicker.legacy", { count: filteredLegacyModels.length })}
                </span>
                <ChevronRight
                  size={11}
                  className={`mp-legacy-chevron${legacyExpanded ? " mp-legacy-chevron-open" : ""}`}
                />
              </button>
              {legacyExpanded
                ? filteredLegacyModels.map((model) => (
                    <ModelRow
                      key={model.id}
                      model={model}
                      engineId={selectedEngineId}
                      isSelected={model.id === (selectedModelId ?? currentModel?.id)}
                      onSelect={handleModelSelect}
                    />
                  ))
                : null}
            </>
          ) : null}

          {visibleCount === 0 ? (
            <div className="mp-empty">{t("modelPicker.noModels")}</div>
          ) : null}
        </div>
      </>
    );
  }

  function renderPanelContent() {
    switch (activeSection) {
      case "harness":
        return (
          <div className="mp-options">
            {engines.map((engine) => {
              const selected = engine.id === selectedEngineId;
              const available = health[engine.id]?.available !== false;
              return (
                <button
                  key={engine.id}
                  type="button"
                  className={`mp-option${selected ? " mp-option-selected" : ""}`}
                  onClick={() => handleHarnessSelect(engine)}
                  aria-pressed={selected}
                >
                  <span className="mp-option-icon">{getHarnessIcon(engine.id, 16)}</span>
                  <span className="mp-option-label">{engine.name}</span>
                  <span
                    className={`mp-health-dot${available ? " mp-health-dot-ok" : " mp-health-dot-error"}`}
                    title={available ? t("modelPicker.available") : t("modelPicker.unavailable")}
                  />
                  {selected ? <Check size={13} className="mp-option-check" /> : null}
                </button>
              );
            })}
          </div>
        );
      case "provider":
        return (
          <div className="mp-options">
            {openCodeProviderGroups.map((group) => {
              const selected = group.providerId === currentOpenCodeProvider?.providerId;
              return (
                <button
                  key={group.providerId}
                  type="button"
                  className={`mp-option${selected ? " mp-option-selected" : ""}`}
                  onClick={() => handleProviderSelect(group)}
                  aria-pressed={selected}
                >
                  <span className="mp-option-label">{group.providerLabel}</span>
                  <span className="mp-option-count">{group.totalModelCount}</span>
                  {selected ? <Check size={13} className="mp-option-check" /> : null}
                </button>
              );
            })}
          </div>
        );
      case "model":
        return renderModelOptions();
      case "reasoning":
        return (
          <div className="mp-options">
            {currentEfforts.map((option) => {
              const selected = option.reasoningEffort === selectedEffort;
              return (
                <button
                  key={option.reasoningEffort}
                  type="button"
                  className={`mp-option mp-option-with-description${selected ? " mp-option-selected" : ""}`}
                  onClick={() => onEffortChange(option.reasoningEffort)}
                  aria-pressed={selected}
                >
                  <span className="mp-option-copy">
                    <span className="mp-option-label">
                      {effortDisplayLabel(t, option.reasoningEffort)}
                    </span>
                    {option.description ? (
                      <span className="mp-option-description">{option.description}</span>
                    ) : null}
                  </span>
                  {selected ? <Check size={13} className="mp-option-check" /> : null}
                </button>
              );
            })}
          </div>
        );
      case "speed": {
        const options: Array<{
          value: CodexServiceTierValue;
          label: string;
          description: string;
        }> = [
          {
            value: "inherit",
            label: t("modelPicker.speedOptions.standard.label"),
            description: t("modelPicker.speedOptions.standard.description"),
          },
          {
            value: "fast",
            label: t("modelPicker.speedOptions.fast.label"),
            description: t("modelPicker.speedOptions.fast.description"),
          },
          {
            value: "flex",
            label: t("modelPicker.speedOptions.flex.label"),
            description: t("modelPicker.speedOptions.flex.description"),
          },
        ];
        return (
          <div className="mp-options">
            {options.map((option) => {
              const selected = option.value === selectedServiceTier;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`mp-option mp-option-with-description${selected ? " mp-option-selected" : ""}`}
                  onClick={() => onServiceTierChange(option.value)}
                  aria-pressed={selected}
                >
                  <span className="mp-option-copy">
                    <span className="mp-option-label">{option.label}</span>
                    <span className="mp-option-description">{option.description}</span>
                  </span>
                  {selected ? <Check size={13} className="mp-option-check" /> : null}
                </button>
              );
            })}
          </div>
        );
      }
    }
  }

  const sectionLabels: Record<ModelPickerSectionId, string> = {
    harness: t("modelPicker.harness"),
    provider: t("modelPicker.provider"),
    model: t("modelPicker.model"),
    reasoning: t("modelPicker.reasoning"),
    speed: t("modelPicker.speed"),
  };
  const speedLabel = selectedServiceTier === "inherit"
    ? t("modelPicker.speedOptions.standard.label")
    : t(`modelPicker.speedOptions.${selectedServiceTier}.label`);
  const sectionValues: Record<ModelPickerSectionId, string> = {
    harness: currentEngine?.name ?? "",
    provider: currentOpenCodeProvider?.providerLabel ?? "",
    model: currentModel ? formatModelName(currentModel.displayName) : "",
    reasoning: selectedEffort ? effortDisplayLabel(t, selectedEffort) : "",
    speed: speedLabel,
  };
  const triggerLabel = currentModel
    ? formatModelName(currentModel.displayName)
    : currentEngine?.name ?? t("modelPicker.selectModel");

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={`mp-trigger${open ? " mp-trigger-open" : ""}`}
      onClick={toggle}
      disabled={disabled}
      title={t("modelPicker.selectModel")}
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <span className="mp-trigger-icon">
        {getHarnessIcon(selectedEngineId, 12)}
      </span>
      <span className="mp-trigger-label">{triggerLabel}</span>
      {selectedEffort && currentEfforts.length > 0 ? (
        <span className="mp-trigger-effort">{shortEffortLabel(t, selectedEffort)}</span>
      ) : null}
      {selectedEngineId === "codex" && selectedServiceTier !== "inherit" ? (
        <span className="mp-trigger-speed">
          <Zap size={9} />
          {speedLabel}
        </span>
      ) : null}
      <ChevronDown
        size={10}
        className={`mp-trigger-chevron${open ? " mp-trigger-chevron-open" : ""}`}
      />
    </button>
  );

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
          role="dialog"
          aria-label={t("modelPicker.runtimeConfiguration")}
        >
          <div className="mp-runtime-menu">
            {sectionIds.map((sectionId) => (
              <button
                key={sectionId}
                type="button"
                className={`mp-runtime-row${activeSection === sectionId ? " mp-runtime-row-active" : ""}`}
                onClick={() => setActiveSection(sectionId)}
                onPointerEnter={() => setActiveSection(sectionId)}
                aria-pressed={activeSection === sectionId}
              >
                <span className="mp-runtime-row-label">{sectionLabels[sectionId]}</span>
                <span className="mp-runtime-row-value">
                  {sectionId === "harness" ? (
                    <span className="mp-runtime-row-harness-icon">
                      {getHarnessIcon(selectedEngineId, 12)}
                    </span>
                  ) : null}
                  <span>{sectionValues[sectionId]}</span>
                </span>
                <ChevronRight size={12} className="mp-runtime-row-chevron" />
              </button>
            ))}
          </div>

          <div className="mp-runtime-panel">
            <div className="mp-runtime-panel-content">{renderPanelContent()}</div>
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

function ModelRow({
  model,
  engineId,
  isSelected,
  onSelect,
}: {
  model: EngineModel;
  engineId: string;
  isSelected: boolean;
  onSelect: (engineId: string, modelId: string) => void;
}) {
  const { t } = useTranslation("chat");
  const metadataChips = modelMetadataChips(t, model);
  const showDescription = shouldShowModelDescription(engineId, model);

  return (
    <button
      type="button"
      className={`mp-model${isSelected ? " mp-model-selected" : ""}`}
      onClick={() => onSelect(engineId, model.id)}
      aria-pressed={isSelected}
    >
      <span className="mp-model-info">
        <span className="mp-model-name-row">
          <span className="mp-model-name">{formatModelName(model.displayName)}</span>
          {model.isDefault ? (
            <span className="mp-model-default">{t("modelPicker.default")}</span>
          ) : null}
        </span>
        {showDescription ? <span className="mp-model-desc">{model.description}</span> : null}
        {isSelected && metadataChips.length > 0 ? (
          <ModelMetadata chips={metadataChips} />
        ) : null}
      </span>
      {isSelected ? <Check size={13} className="mp-model-check" /> : null}
    </button>
  );
}
