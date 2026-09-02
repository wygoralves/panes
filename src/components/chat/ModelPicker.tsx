import { engineKind } from "../../lib/engineKind";
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
  Star,
  Zap,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useEngineStore } from "../../stores/engineStore";
import { modelFavoriteKey, useModelFavoritesStore } from "../../stores/modelFavoritesStore";
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

function ModelDetail({ model, chips }: { model: EngineModel; chips: ModelMetadataChip[] }) {
  return (
    <div className="mp-detail" aria-live="polite">
      <span className="mp-detail-name">{formatModelName(model.displayName)}</span>
      {chips.some((chip) => chip.icon) ? (
        <span className="mp-detail-icons">
          {chips
            .filter((chip) => chip.icon)
            .map((chip) => (
              <span
                key={chip.label}
                className="mp-detail-icon"
                role="img"
                aria-label={chip.label}
                title={chip.title ?? chip.label}
              >
                {modelMetadataIcon(chip.icon)}
              </span>
            ))}
        </span>
      ) : null}
      {chips
        .filter((chip) => !chip.icon)
        .map((chip) => (
          <span key={chip.label} className="mp-detail-chip" title={chip.title ?? chip.label}>
            {chip.label}
          </span>
        ))}
    </div>
  );
}

function shouldShowModelDescription(engineId: string, model: EngineModel): boolean {
  if (!model.description) {
    return false;
  }
  return !(engineKind(engineId) === "opencode" && model.description.trim() === "OpenCode model");
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

export function formatModelDisplayName(name: string): string {
  return formatModelName(name);
}

export function getModelPickerSectionIds(
  engineId: string,
  model: EngineModel | null,
): ModelPickerSectionId[] {
  const sections: ModelPickerSectionId[] = ["harness"];
  if (engineKind(engineId) === "opencode") {
    sections.push("provider");
  }
  sections.push("model");
  if ((model?.supportedReasoningEfforts?.length ?? 0) > 0) {
    sections.push("reasoning");
  }
  if (engineKind(engineId) === "codex") {
    sections.push("speed");
  }
  return sections;
}

type PickerRow =
  | { key: string; type: "model"; engineId: string; model: EngineModel }
  | { key: string; type: "effort"; effort: string };

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
  const [query, setQuery] = useState("");
  const [legacyExpanded, setLegacyExpanded] = useState(false);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const ensureEngineHealth = useEngineStore((state) => state.ensureHealth);
  const favoriteKeys = useModelFavoritesStore((state) => state.favorites);
  const toggleFavorite = useModelFavoritesStore((state) => state.toggleFavorite);

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
    const popoverWidth = Math.min(320, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLegacyExpanded(false);
    setHighlightedKey(null);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 20);

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
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
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
  const isOpenCode = engineKind(selectedEngineId) === "opencode";
  const isCodex = engineKind(selectedEngineId) === "codex";
  const openCodeProviderGroups = useMemo(
    () => groupOpenCodeModels(currentModels),
    [currentModels],
  );
  const currentOpenCodeProviderId =
    isOpenCode && currentModel ? getOpenCodeProviderId(currentModel.id) : null;

  function defaultModelForEngine(engine: EngineInfo): EngineModel | null {
    return (
      engine.models.find((model) => !model.hidden && model.isDefault) ??
      engine.models.find((model) => !model.hidden) ??
      engine.models[0] ??
      null
    );
  }

  function handleEngineSelect(engine: EngineInfo) {
    if (engine.id === selectedEngineId) return;
    const nextModel = defaultModelForEngine(engine);
    if (!nextModel) return;
    onEngineModelChange(engine.id, nextModel.id);
    setQuery("");
    setLegacyExpanded(false);
    setHighlightedKey(null);
    searchRef.current?.focus();
  }

  function handleModelSelect(modelId: string) {
    onEngineModelChange(selectedEngineId, modelId);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleEffortSelect(effort: string) {
    onEffortChange(effort);
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Sections of models. Favorites for the current engine come first; OpenCode
  // then groups by upstream provider with the current provider first, and
  // other engines have a single group.
  const { favoriteModels, modelSections } = useMemo(() => {
    const trimmedQuery = query.trim();
    const isFavorite = (model: EngineModel) =>
      favoriteKeys.includes(modelFavoriteKey(selectedEngineId, model.id));
    const favoriteModels = filterOpenCodeModelsForQuery(currentModels.filter(isFavorite), trimmedQuery);
    const rest = (models: EngineModel[]) => models.filter((model) => !isFavorite(model));
    if (isOpenCode) {
      const ordered = [...openCodeProviderGroups].sort((left, right) => {
        if (left.providerId === currentOpenCodeProviderId) return -1;
        if (right.providerId === currentOpenCodeProviderId) return 1;
        return 0;
      });
      const modelSections = ordered
        .map((group) => ({
          key: group.providerId,
          label: group.providerLabel,
          active: filterOpenCodeModelsForQuery(rest(group.activeModels), trimmedQuery),
          legacy: filterOpenCodeModelsForQuery(rest(group.legacyModels), trimmedQuery),
        }))
        .filter((group) => group.active.length > 0 || group.legacy.length > 0);
      return { favoriteModels, modelSections };
    }
    const active = filterOpenCodeModelsForQuery(
      rest(currentModels.filter((model) => !model.hidden)),
      trimmedQuery,
    );
    const legacy = filterOpenCodeModelsForQuery(
      rest(currentModels.filter((model) => model.hidden)),
      trimmedQuery,
    );
    return {
      favoriteModels,
      modelSections:
        active.length > 0 || legacy.length > 0
          ? [{ key: "all", label: null as string | null, active, legacy }]
          : [],
    };
  }, [currentModels, currentOpenCodeProviderId, favoriteKeys, isOpenCode, openCodeProviderGroups, query, selectedEngineId]);

  const legacyCount = modelSections.reduce((total, section) => total + section.legacy.length, 0);
  const showLegacy = legacyExpanded || query.trim().length > 0;

  const filteredEfforts = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return currentEfforts;
    return currentEfforts.filter((option) =>
      effortDisplayLabel(t, option.reasoningEffort).toLowerCase().includes(trimmed),
    );
  }, [currentEfforts, query, t]);

  const rows = useMemo<PickerRow[]>(() => {
    const result: PickerRow[] = [];
    for (const model of favoriteModels) {
      result.push({ key: `model:${model.id}`, type: "model", engineId: selectedEngineId, model });
    }
    for (const section of modelSections) {
      const models = showLegacy ? [...section.active, ...section.legacy] : section.active;
      for (const model of models) {
        result.push({ key: `model:${model.id}`, type: "model", engineId: selectedEngineId, model });
      }
    }
    for (const option of filteredEfforts) {
      result.push({ key: `effort:${option.reasoningEffort}`, type: "effort", effort: option.reasoningEffort });
    }
    return result;
  }, [favoriteModels, filteredEfforts, modelSections, selectedEngineId, showLegacy]);

  useEffect(() => {
    if (highlightedKey && !rows.some((row) => row.key === highlightedKey)) {
      setHighlightedKey(null);
    }
  }, [highlightedKey, rows]);

  useEffect(() => {
    if (!highlightedKey || !listRef.current) return;
    const element = listRef.current.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(highlightedKey)}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [highlightedKey]);

  function moveHighlight(direction: 1 | -1) {
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((row) => row.key === highlightedKey);
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : rows.length - 1
        : (currentIndex + direction + rows.length) % rows.length;
    setHighlightedKey(rows[nextIndex].key);
  }

  function activateHighlighted() {
    const row = rows.find((candidate) => candidate.key === highlightedKey);
    if (!row) {
      const first = rows[0];
      if (first?.type === "model") handleModelSelect(first.model.id);
      else if (first?.type === "effort") handleEffortSelect(first.effort);
      return;
    }
    if (row.type === "model") handleModelSelect(row.model.id);
    else handleEffortSelect(row.effort);
  }

  function switchEngine(direction: 1 | -1) {
    if (engines.length < 2) return;
    const index = engines.findIndex((engine) => engine.id === selectedEngineId);
    const next = engines[(index + direction + engines.length) % engines.length];
    if (next) handleEngineSelect(next);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activateHighlighted();
    } else if (event.key === "Tab" && !event.shiftKey && query.length === 0) {
      event.preventDefault();
      switchEngine(1);
    } else if (event.key === "Tab" && event.shiftKey && query.length === 0) {
      event.preventDefault();
      switchEngine(-1);
    }
  }

  const triggerModelLabel = currentModel
    ? formatModelName(currentModel.displayName)
    : currentEngine?.name ?? t("modelPicker.selectModel");
  const triggerEffortLabel =
    selectedEffort && currentEfforts.length > 0 ? effortDisplayLabel(t, selectedEffort) : null;
  const fastMode = isCodex && selectedServiceTier === "fast";
  const highlightedRow = rows.find((row) => row.key === highlightedKey);
  const detailModel = highlightedRow?.type === "model" ? highlightedRow.model : currentModel;
  const detailChips = detailModel ? modelMetadataChips(t, detailModel) : [];
  const showEngineNames = engines.length <= 3 || engines.some((engine) => !isBuiltinKindName(engine));

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
        {getHarnessIcon(engineKind(selectedEngineId), 12)}
      </span>
      <span className="mp-trigger-label">{triggerModelLabel}</span>
      {triggerEffortLabel ? (
        <span className="mp-trigger-effort">{triggerEffortLabel}</span>
      ) : null}
      {fastMode ? (
        <span className="mp-trigger-speed" title={t("modelPicker.fastMode")}>
          <Zap size={9} />
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
          <div className="mp-tabs" role="tablist" aria-label={t("modelPicker.providers")}>
            {engines.map((engine) => {
              const selected = engine.id === selectedEngineId;
              const available = health[engine.id]?.available !== false;
              return (
                <button
                  key={engine.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`mp-tab${selected ? " mp-tab-active" : ""}${available ? "" : " mp-tab-unavailable"}`}
                  title={
                    available
                      ? engine.name
                      : `${engine.name}: ${t("modelPicker.unavailable")}`
                  }
                  onClick={() => handleEngineSelect(engine)}
                >
                  <span className="mp-tab-icon">{getHarnessIcon(engineKind(engine.id), 14)}</span>
                  {showEngineNames ? <span className="mp-tab-label">{engine.name}</span> : null}
                  {!available ? <span className="mp-tab-dot" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>

          <div className="mp-search">
            <Search size={13} className="mp-search-icon" aria-hidden="true" />
            <input
              ref={searchRef}
              className="mp-search-input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedKey(null);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t("modelPicker.searchModels")}
              aria-label={t("modelPicker.searchModels")}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <div className="mp-scroll" ref={listRef}>
            {favoriteModels.length === 0 && modelSections.length === 0 && filteredEfforts.length === 0 ? (
              <div className="mp-empty">{t("modelPicker.noModels")}</div>
            ) : null}

            {favoriteModels.length > 0 ? (
              <div className="mp-section" key="favorites">
                <div className="mp-section-title">{t("modelPicker.favorites")}</div>
                {favoriteModels.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    isSelected={model.id === (selectedModelId ?? currentModel?.id)}
                    isHighlighted={highlightedKey === `model:${model.id}`}
                    isFavorite
                    onSelect={handleModelSelect}
                    onToggleFavorite={() => toggleFavorite(selectedEngineId, model.id)}
                    onHover={() => setHighlightedKey(`model:${model.id}`)}
                  />
                ))}
              </div>
            ) : null}

            {modelSections.map((section, sectionIndex) => (
              <div className="mp-section" key={section.key}>
                <div className="mp-section-title">
                  {section.label
                    ? section.label
                    : sectionIndex === 0
                      ? favoriteModels.length > 0
                        ? t("modelPicker.models")
                        : t("modelPicker.model")
                      : null}
                </div>
                {section.active.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    isSelected={model.id === (selectedModelId ?? currentModel?.id)}
                    isHighlighted={highlightedKey === `model:${model.id}`}
                    isFavorite={false}
                    onSelect={handleModelSelect}
                    onToggleFavorite={() => toggleFavorite(selectedEngineId, model.id)}
                    onHover={() => setHighlightedKey(`model:${model.id}`)}
                  />
                ))}
                {showLegacy
                  ? section.legacy.map((model) => (
                      <ModelRow
                        key={model.id}
                        model={model}
                        isSelected={model.id === (selectedModelId ?? currentModel?.id)}
                        isHighlighted={highlightedKey === `model:${model.id}`}
                        isFavorite={false}
                        onSelect={handleModelSelect}
                        onToggleFavorite={() => toggleFavorite(selectedEngineId, model.id)}
                        onHover={() => setHighlightedKey(`model:${model.id}`)}
                        legacy
                      />
                    ))
                  : null}
              </div>
            ))}

            {legacyCount > 0 && query.trim().length === 0 ? (
              <button
                type="button"
                className="mp-legacy-toggle"
                onClick={() => setLegacyExpanded((previous) => !previous)}
                aria-expanded={legacyExpanded}
              >
                <span className="mp-legacy-toggle-label">
                  {t("modelPicker.legacy", { count: legacyCount })}
                </span>
                <ChevronRight
                  size={11}
                  className={`mp-legacy-chevron${legacyExpanded ? " mp-legacy-chevron-open" : ""}`}
                />
              </button>
            ) : null}

            {filteredEfforts.length > 0 ? (
              <div className="mp-section mp-section-divided">
                <div className="mp-section-title">{t("modelPicker.reasoning")}</div>
                {filteredEfforts.map((option) => {
                  const selected = option.reasoningEffort === selectedEffort;
                  const key = `effort:${option.reasoningEffort}`;
                  return (
                    <button
                      key={option.reasoningEffort}
                      type="button"
                      data-row-key={key}
                      className={`mp-row${selected ? " mp-row-selected" : ""}${highlightedKey === key ? " mp-row-highlighted" : ""}`}
                      onClick={() => handleEffortSelect(option.reasoningEffort)}
                      onPointerMove={() => setHighlightedKey(key)}
                      title={option.description || undefined}
                      aria-pressed={selected}
                    >
                      <span className="mp-row-label">{effortDisplayLabel(t, option.reasoningEffort)}</span>
                      {selected ? <Check size={13} className="mp-row-check" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {detailModel && detailChips.length > 0 ? (
            <ModelDetail model={detailModel} chips={detailChips} />
          ) : null}

          {isCodex ? (
            <label className="mp-footer">
              <Zap size={13} className="mp-footer-icon" aria-hidden="true" />
              <span className="mp-footer-label">{t("modelPicker.fastMode")}</span>
              <span className="ws-toggle">
                <input
                  type="checkbox"
                  checked={fastMode}
                  aria-label={t("modelPicker.fastMode")}
                  onChange={(event) => onServiceTierChange(event.target.checked ? "fast" : "inherit")}
                />
                <span className="ws-toggle-track" />
                <span className="ws-toggle-thumb" />
              </span>
            </label>
          ) : null}
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

function isBuiltinKindName(engine: EngineInfo): boolean {
  return engine.id === engineKind(engine.id);
}

function ModelRow({
  model,
  isSelected,
  isHighlighted,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onHover,
  legacy = false,
}: {
  model: EngineModel;
  isSelected: boolean;
  isHighlighted: boolean;
  isFavorite: boolean;
  onSelect: (modelId: string) => void;
  onToggleFavorite: () => void;
  onHover: () => void;
  legacy?: boolean;
}) {
  const { t } = useTranslation("chat");

  return (
    <div
      role="button"
      tabIndex={-1}
      data-row-key={`model:${model.id}`}
      className={`mp-row${isSelected ? " mp-row-selected" : ""}${isHighlighted ? " mp-row-highlighted" : ""}${legacy ? " mp-row-legacy" : ""}`}
      onClick={() => onSelect(model.id)}
      onPointerMove={onHover}
      aria-pressed={isSelected}
    >
      <span className="mp-row-label">
        {formatModelName(model.displayName)}
        {model.isDefault ? (
          <span className="mp-row-default">{t("modelPicker.default")}</span>
        ) : null}
      </span>
      <button
        type="button"
        className={`mp-row-star${isFavorite ? " mp-row-star-active" : ""}`}
        aria-label={isFavorite ? t("modelPicker.removeFavorite") : t("modelPicker.addFavorite")}
        aria-pressed={isFavorite}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite();
        }}
      >
        <Star size={12} />
      </button>
      {isSelected ? <Check size={13} className="mp-row-check" /> : <span className="mp-row-check-slot" />}
    </div>
  );
}
