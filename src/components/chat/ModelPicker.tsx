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
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useEngineStore } from "../../stores/engineStore";
import { modelFavoriteKey, useModelFavoritesStore } from "../../stores/modelFavoritesStore";
import { useComposerSettingsStore } from "../../stores/composerSettingsStore";
import { useModelPickerStore } from "../../stores/modelPickerStore";
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

type PickerRow = { key: string; engineId: string; model: EngineModel; legacy: boolean };

interface PickerGroup {
  key: string;
  engineId: string;
  label: string;
  /** Secondary label, e.g. the upstream provider for OpenCode groups. */
  detail: string | null;
  available: boolean;
  rows: PickerRow[];
  totalCount: number;
}

const SLIDER_RESOLUTION = 1000;
const SLIDER_THUMB_HALF = 13;

function rowKey(engineId: string, modelId: string): string {
  return `model:${engineId}:${modelId}`;
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
  const [query, setQuery] = useState("");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });
  const ensureEngineHealth = useEngineStore((state) => state.ensureHealth);
  const favoriteKeys = useModelFavoritesStore((state) => state.favorites);
  const toggleFavorite = useModelFavoritesStore((state) => state.toggleFavorite);
  const legacyModelsVisible = useComposerSettingsStore((state) => state.legacyModelsVisible);
  const collapsedGroups = useModelPickerStore((state) => state.collapsedGroups);
  const toggleGroup = useModelPickerStore((state) => state.toggleGroup);

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
    const popoverWidth = Math.min(340, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
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
  const currentEfforts = currentModel?.supportedReasoningEfforts ?? [];
  const isCodex = engineKind(selectedEngineId) === "codex";
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const isFavorite = useCallback(
    (engineId: string, model: EngineModel) =>
      favoriteKeys.includes(modelFavoriteKey(engineId, model.id)),
    [favoriteKeys],
  );

  // Favorites across every account come first; then one group per account,
  // with OpenCode split further by upstream provider.
  const { favoriteRows, groups } = useMemo(() => {
    const favoriteRows: PickerRow[] = [];
    const groups: PickerGroup[] = [];
    for (const engine of engines) {
      const available = health[engine.id]?.available !== false;
      // Legacy models stay out of the list unless the setting is on, but a
      // search can always reach them.
      const visibleModels = engine.models.filter(
        (model) => !model.hidden || legacyModelsVisible || searching,
      );
      for (const model of visibleModels) {
        if (isFavorite(engine.id, model)) {
          favoriteRows.push({ key: rowKey(engine.id, model.id), engineId: engine.id, model, legacy: model.hidden });
        }
      }
      const rest = visibleModels.filter((model) => !isFavorite(engine.id, model));
      const toRows = (models: EngineModel[]) =>
        filterOpenCodeModelsForQuery(models, trimmedQuery).map((model) => ({
          key: rowKey(engine.id, model.id),
          engineId: engine.id,
          model,
          legacy: model.hidden,
        }));
      if (engineKind(engine.id) === "opencode") {
        for (const group of groupOpenCodeModels(rest)) {
          const models = [...group.activeModels, ...group.legacyModels];
          groups.push({
            key: `${engine.id}:${group.providerId}`,
            engineId: engine.id,
            label: engine.name,
            detail: group.providerLabel,
            available,
            rows: toRows(models),
            totalCount: models.length,
          });
        }
        continue;
      }
      const ordered = [...rest.filter((model) => !model.hidden), ...rest.filter((model) => model.hidden)];
      groups.push({
        key: engine.id,
        engineId: engine.id,
        label: engine.name,
        detail: null,
        available,
        rows: toRows(ordered),
        totalCount: ordered.length,
      });
    }
    return {
      favoriteRows: favoriteRows.filter((row) =>
        filterOpenCodeModelsForQuery([row.model], trimmedQuery).length > 0,
      ),
      groups: searching ? groups.filter((group) => group.rows.length > 0) : groups,
    };
  }, [engines, health, isFavorite, legacyModelsVisible, searching, trimmedQuery]);

  const isGroupCollapsed = (group: PickerGroup) =>
    !searching && (collapsedGroups[group.key] ?? !group.available);

  const rows = useMemo<PickerRow[]>(
    () => [
      ...favoriteRows,
      ...groups.flatMap((group) => (isGroupCollapsed(group) ? [] : group.rows)),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favoriteRows, groups, collapsedGroups, searching],
  );

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

  // Picking a model keeps the popover open so the reasoning level can be
  // adjusted for it right away; Escape, the trigger, or a click outside close.
  function handleModelSelect(engineId: string, modelId: string) {
    onEngineModelChange(engineId, modelId);
    setHighlightedKey(rowKey(engineId, modelId));
    searchRef.current?.focus();
  }

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
    const row = rows.find((candidate) => candidate.key === highlightedKey) ?? rows[0];
    if (row) handleModelSelect(row.engineId, row.model.id);
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
    }
  }

  const triggerModelLabel = currentModel
    ? formatModelName(currentModel.displayName)
    : currentEngine?.name ?? t("modelPicker.selectModel");
  const triggerEffortLabel =
    selectedEffort && currentEfforts.length > 0 ? effortDisplayLabel(t, selectedEffort) : null;
  const fastMode = isCodex && selectedServiceTier === "fast";
  const effortIndex = Math.max(
    0,
    currentEfforts.findIndex((option) => option.reasoningEffort === selectedEffort),
  );
  // Positions are percentages of the native range input's travel, which
  // runs from half a thumb width in to half a thumb width from the end; the
  // CSS maps that onto pixels so the visible thumb, fill, and stops all sit
  // where the native thumb is.
  const stopPercent = (index: number) =>
    currentEfforts.length < 2 ? 50 : (index / (currentEfforts.length - 1)) * 100;
  const trackPosition = (percent: number) =>
    `calc(${SLIDER_THUMB_HALF}px + (100% - ${SLIDER_THUMB_HALF * 2}px) * ${(percent / 100).toFixed(4)})`;
  // While dragging, the thumb follows the pointer freely and magnetizes to
  // the nearest stop when close; releasing commits that stop.
  const nearestStopIndex = (pct: number) => {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    currentEfforts.forEach((_, index) => {
      const distance = Math.abs(stopPercent(index) - pct);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return { index: best, distance: bestDistance };
  };
  const dragging = dragPercent !== null;
  const previewIndex = dragging ? nearestStopIndex(dragPercent).index : effortIndex;
  const effortPercent = dragging ? dragPercent : stopPercent(effortIndex);
  // The top level turns the fill holographic.
  const holo = currentEfforts.length > 1 && previewIndex === currentEfforts.length - 1;

  function updateDrag(rawPercent: number) {
    if (currentEfforts.length < 2) return;
    const min = stopPercent(0);
    const max = stopPercent(currentEfforts.length - 1);
    // The thumb tracks the pointer 1:1; the magnet acts on release.
    setDragPercent(Math.min(max, Math.max(min, rawPercent)));
  }

  function commitDrag() {
    if (dragPercent === null) return;
    const option = currentEfforts[nearestStopIndex(dragPercent).index];
    setDragPercent(null);
    if (option && option.reasoningEffort !== selectedEffort) onEffortChange(option.reasoningEffort);
  }

  function stepEffort(direction: 1 | -1) {
    const option = currentEfforts[Math.min(currentEfforts.length - 1, Math.max(0, effortIndex + direction))];
    if (option && option.reasoningEffort !== selectedEffort) onEffortChange(option.reasoningEffort);
  }
  const selectedRowKey = currentModel ? rowKey(selectedEngineId, currentModel.id) : null;
  // When two accounts share a provider kind, the model name alone is
  // ambiguous, so favorites and the trigger carry the account name.
  const accountLabelFor = (engineId: string): string | null => {
    const kind = engineKind(engineId);
    if (engines.filter((engine) => engineKind(engine.id) === kind).length < 2) return null;
    return engines.find((engine) => engine.id === engineId)?.name ?? null;
  };
  const triggerAccountLabel = accountLabelFor(selectedEngineId);
  const showTriggerAccount = engines.some((engine) => !isBuiltinKindName(engine));

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={`mp-trigger${open ? " mp-trigger-open" : ""}`}
      onClick={toggle}
      disabled={disabled}
      title={
        showTriggerAccount && currentEngine
          ? `${currentEngine.name}: ${triggerModelLabel}`
          : t("modelPicker.selectModel")
      }
      aria-expanded={open}
      aria-haspopup="dialog"
    >
      <span className="mp-trigger-icon">
        {getHarnessIcon(engineKind(selectedEngineId), 12)}
      </span>
      {triggerAccountLabel ? (
        <span className="mp-trigger-account">{triggerAccountLabel}</span>
      ) : null}
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

  const renderRow = (row: PickerRow, favorite: boolean, groupAvailable = true) => (
    <ModelRow
      key={row.key}
      row={row}
      isSelected={row.key === selectedRowKey}
      isHighlighted={highlightedKey === row.key}
      isFavorite={favorite}
      showIcon={favorite}
      accountLabel={favorite ? accountLabelFor(row.engineId) : null}
      unavailable={!groupAvailable}
      onSelect={() => handleModelSelect(row.engineId, row.model.id)}
      onToggleFavorite={() => toggleFavorite(row.engineId, row.model.id)}
      onHover={() => setHighlightedKey(row.key)}
    />
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
            {favoriteRows.length === 0 && groups.length === 0 ? (
              <div className="mp-empty">{t("modelPicker.noModels")}</div>
            ) : null}

            {favoriteRows.length > 0 ? (
              <div className="mp-section">
                <div className="mp-section-title">{t("modelPicker.favorites")}</div>
                {favoriteRows.map((row) => renderRow(row, true))}
              </div>
            ) : null}

            {groups.map((group) => {
              const collapsed = isGroupCollapsed(group);
              return (
                <div className="mp-section" key={group.key}>
                  <button
                    type="button"
                    className={`mp-group${collapsed ? " mp-group-collapsed" : ""}`}
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!collapsed}
                    disabled={searching}
                  >
                    <span className="mp-group-icon">{getHarnessIcon(engineKind(group.engineId), 13)}</span>
                    <span className="mp-group-label">
                      {group.label}
                      {group.detail ? <span className="mp-group-detail">{group.detail}</span> : null}
                    </span>
                    {!group.available ? (
                      <span className="mp-group-status">{t("modelPicker.unavailable")}</span>
                    ) : collapsed ? (
                      <span className="mp-group-count">{group.totalCount}</span>
                    ) : null}
                    <ChevronRight
                      size={11}
                      className={`mp-group-chevron${collapsed ? "" : " mp-group-chevron-open"}`}
                    />
                  </button>
                  {collapsed ? null : group.rows.map((row) => renderRow(row, false, group.available))}
                </div>
              );
            })}
          </div>

          {currentEfforts.length > 0 || isCodex ? (
            <div className="mp-footer">
              {currentEfforts.length > 0 ? (
                <div className="mp-effort">
                  <div className="mp-effort-head">
                    <span className="mp-effort-title">{t("modelPicker.reasoning")}</span>
                    <span className={`mp-effort-value${holo ? " mp-effort-value-holo" : ""}`} key={previewIndex}>
                      {effortDisplayLabel(t, currentEfforts[previewIndex]?.reasoningEffort ?? selectedEffort)}
                    </span>
                  </div>
                  {currentEfforts.length > 1 ? (
                    <>
                      <div
                        className={`mp-slider${holo ? " mp-slider-holo" : ""}${dragging ? " mp-slider-dragging" : ""}`}
                        style={{ "--mp-slider-pos": trackPosition(effortPercent) } as CSSProperties}
                      >
                        <div className="mp-slider-track">
                          <div className="mp-slider-fill" />
                          {currentEfforts.map((option, index) => (
                            <span
                              key={option.reasoningEffort}
                              className={`mp-slider-stop${stopPercent(index) <= effortPercent + 0.5 ? " mp-slider-stop-filled" : ""}${dragging && index === previewIndex ? " mp-slider-stop-active" : ""}`}
                              style={{ left: trackPosition(stopPercent(index)) }}
                            />
                          ))}
                        </div>
                        <span className="mp-slider-thumb" aria-hidden="true" />
                        <input
                          type="range"
                          className="mp-slider-input"
                          min={0}
                          max={SLIDER_RESOLUTION}
                          step={1}
                          value={Math.round((effortPercent / 100) * SLIDER_RESOLUTION)}
                          aria-label={t("modelPicker.reasoning")}
                          aria-valuemin={0}
                          aria-valuemax={currentEfforts.length - 1}
                          aria-valuenow={previewIndex}
                          aria-valuetext={effortDisplayLabel(t, currentEfforts[previewIndex]?.reasoningEffort ?? "")}
                          onChange={(event) => updateDrag((Number(event.target.value) / SLIDER_RESOLUTION) * 100)}
                          onPointerUp={commitDrag}
                          onPointerCancel={commitDrag}
                          onBlur={commitDrag}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                              event.preventDefault();
                              stepEffort(1);
                            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                              event.preventDefault();
                              stepEffort(-1);
                            } else if (event.key === "Home" || event.key === "End") {
                              event.preventDefault();
                              const option = currentEfforts[event.key === "Home" ? 0 : currentEfforts.length - 1];
                              if (option) onEffortChange(option.reasoningEffort);
                            }
                          }}
                        />
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              {isCodex ? (
                <label className="mp-footer-row">
                  <Zap size={13} className="mp-footer-icon" aria-hidden="true" />
                  <span className="mp-footer-label mp-footer-label-grow">{t("modelPicker.fastMode")}</span>
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
            </div>
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
  row,
  isSelected,
  isHighlighted,
  isFavorite,
  showIcon,
  accountLabel,
  unavailable,
  onSelect,
  onToggleFavorite,
  onHover,
}: {
  row: PickerRow;
  isSelected: boolean;
  isHighlighted: boolean;
  isFavorite: boolean;
  showIcon: boolean;
  accountLabel: string | null;
  unavailable: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onHover: () => void;
}) {
  const { t } = useTranslation("chat");
  const { model } = row;

  return (
    <div
      role="button"
      tabIndex={-1}
      data-row-key={row.key}
      className={`mp-row${isSelected ? " mp-row-selected" : ""}${isHighlighted ? " mp-row-highlighted" : ""}${row.legacy ? " mp-row-legacy" : ""}${unavailable ? " mp-row-unavailable" : ""}`}
      onClick={onSelect}
      onPointerMove={onHover}
      aria-pressed={isSelected}
      title={model.description || undefined}
    >
      {showIcon ? (
        <span className="mp-row-icon">{getHarnessIcon(engineKind(row.engineId), 13)}</span>
      ) : null}
      <span className="mp-row-label">
        {formatModelName(model.displayName)}
        {accountLabel ? <span className="mp-row-account">{accountLabel}</span> : null}
        {model.isDefault && !isFavorite ? (
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
