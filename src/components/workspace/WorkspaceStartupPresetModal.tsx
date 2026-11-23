import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download,
  Play,
  Plus,
  Rows2,
  Save,
  Settings2,
  Trash2,
  Upload,
  X,
  Columns2,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { t as translate } from "../../i18n";
import { useHarnessStore } from "../../stores/harnessStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type {
  Workspace,
  WorkspaceDefaultView,
  WorkspacePathBase,
  WorkspaceStartupGroup,
  WorkspaceStartupPreset,
  WorkspaceStartupPresetFormat,
  WorkspaceStartupSession,
  WorkspaceStartupSplitNode,
  WorkspaceStartupWorktreeConfig,
} from "../../types";
import {
  resolveStartupSessionHarnessSelection,
  shouldShowStartupSplitPanelSize,
} from "../../lib/workspaceStartupUi";

type EditorMode = "builder" | "advanced";

interface WorkspaceStartupPresetModalProps {
  open: boolean;
  workspace: Workspace;
  onClose: () => void;
}

interface StartupSplitNodeEditorProps {
  label: string;
  node: WorkspaceStartupSplitNode;
  sessionIds: string[];
  onChange: (next: WorkspaceStartupSplitNode) => void;
}

const DEFAULT_SPLIT_PANEL_SIZE = 32;
const VIEW_OPTIONS: WorkspaceDefaultView[] = ["chat", "split", "terminal", "editor"];
const PATH_BASE_OPTIONS: WorkspacePathBase[] = ["workspace", "worktree", "absolute"];

function createStartupId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function createDefaultSession(index = 1): WorkspaceStartupSession {
  return {
    id: createStartupId(`session-${index}`),
    title: null,
    cwd: ".",
    cwdBase: "workspace",
    harnessId: null,
    launchHarnessOnCreate: false,
  };
}

function createDefaultGroup(_index = 1): WorkspaceStartupGroup {
  const session = createDefaultSession(1);
  return {
    id: createStartupId("group"),
    name: "",
    broadcastOnStart: false,
    worktree: null,
    sessions: [session],
    root: {
      type: "leaf",
      sessionId: session.id,
    },
  };
}

function createDefaultTerminalPreset() {
  const group = createDefaultGroup(1);
  return {
    applyWhen: "no_live_sessions" as const,
    groups: [group],
    activeGroupId: group.id,
    focusedSessionId: group.sessions[0]?.id ?? null,
  };
}

function createEmptyPreset(): WorkspaceStartupPreset {
  return {
    version: 1,
    defaultView: "chat",
    splitPanelSize: DEFAULT_SPLIT_PANEL_SIZE,
    terminal: null,
  };
}

export function serializeWorkspaceStartupPresetAsJson(preset: WorkspaceStartupPreset): string {
  return JSON.stringify(preset, null, 2);
}

export function canCommitWorkspaceStartupPresetLoad(
  requestId: number,
  activeRequestId: number,
  isOpen: boolean,
): boolean {
  return isOpen && requestId === activeRequestId;
}

function clampSplitPanelSize(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SPLIT_PANEL_SIZE;
  }
  return Math.max(15, Math.min(72, Math.round(value ?? DEFAULT_SPLIT_PANEL_SIZE)));
}

function collectSplitSessionIds(node: WorkspaceStartupSplitNode): string[] {
  if (node.type === "leaf") {
    return [node.sessionId];
  }
  return [...collectSplitSessionIds(node.children[0]), ...collectSplitSessionIds(node.children[1])];
}

function appendSessionToSplitTree(
  node: WorkspaceStartupSplitNode,
  sessionId: string,
): WorkspaceStartupSplitNode {
  return {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    children: [
      node,
      {
        type: "leaf",
        sessionId,
      },
    ],
  };
}

function removeSessionFromSplitTree(
  node: WorkspaceStartupSplitNode,
  sessionId: string,
): WorkspaceStartupSplitNode | null {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? null : node;
  }
  const [left, right] = node.children;
  if (left.type === "leaf" && left.sessionId === sessionId) {
    return right;
  }
  if (right.type === "leaf" && right.sessionId === sessionId) {
    return left;
  }
  const nextLeft = removeSessionFromSplitTree(left, sessionId);
  const nextRight = removeSessionFromSplitTree(right, sessionId);
  if (nextLeft === null) {
    return nextRight;
  }
  if (nextRight === null) {
    return nextLeft;
  }
  return {
    ...node,
    children: [nextLeft, nextRight],
  };
}

function normalizeTerminalPreset(
  terminal: WorkspaceStartupPreset["terminal"],
): WorkspaceStartupPreset["terminal"] {
  if (!terminal) {
    return null;
  }

  if (terminal.groups.length === 0) {
    return {
      ...terminal,
      activeGroupId: null,
      focusedSessionId: null,
    };
  }

  const groups = terminal.groups.map((group) => ({
    ...group,
    name: group.name.trim(),
    broadcastOnStart: Boolean(group.broadcastOnStart),
  }));
  const activeGroupId = groups.some((group) => group.id === terminal.activeGroupId)
    ? terminal.activeGroupId
    : groups[0]?.id ?? null;
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0];
  const allSessionIds = groups.flatMap((group) => group.sessions.map((session) => session.id));
  const focusedSessionId =
    terminal.focusedSessionId && allSessionIds.includes(terminal.focusedSessionId)
      ? terminal.focusedSessionId
      : activeGroup?.sessions[0]?.id ?? groups[0]?.sessions[0]?.id ?? null;

  return {
    ...terminal,
    groups,
    activeGroupId,
    focusedSessionId,
  };
}

function normalizePresetDraft(preset: WorkspaceStartupPreset): WorkspaceStartupPreset {
  return {
    ...preset,
    splitPanelSize: clampSplitPanelSize(preset.splitPanelSize),
    terminal: normalizeTerminalPreset(preset.terminal),
  };
}

function defaultGroupNameFromHarness(
  group: WorkspaceStartupGroup,
  harnessNamesById: ReadonlyMap<string, string>,
): string | null {
  if (group.sessions.length !== 1) {
    return null;
  }
  const harnessId = group.sessions[0]?.harnessId?.trim();
  if (!harnessId) {
    return null;
  }
  const harnessName = harnessNamesById.get(harnessId)?.trim();
  return harnessName || null;
}

function resolveBlankGroupNames(
  groups: WorkspaceStartupGroup[],
  harnessNamesById: ReadonlyMap<string, string>,
): WorkspaceStartupGroup[] {
  const usedNames = new Set<string>();

  return groups.map((group) => {
    const explicitName = group.name.trim();
    if (explicitName) {
      usedNames.add(explicitName);
      return { ...group, name: explicitName };
    }

    const harnessName = defaultGroupNameFromHarness(group, harnessNamesById);
    if (harnessName) {
      let candidate = harnessName;
      let suffix = 2;
      while (usedNames.has(candidate)) {
        candidate = `${harnessName} ${suffix}`;
        suffix += 1;
      }
      usedNames.add(candidate);
      return { ...group, name: candidate };
    }

    let terminalNumber = 1;
    let candidate = translate("workspace:startup.fallbackTerminal", { index: terminalNumber });
    while (usedNames.has(candidate)) {
      terminalNumber += 1;
      candidate = translate("workspace:startup.fallbackTerminal", { index: terminalNumber });
    }
    usedNames.add(candidate);
    return { ...group, name: candidate };
  });
}

function materializePresetDraft(
  preset: WorkspaceStartupPreset,
  harnessNamesById: ReadonlyMap<string, string>,
): WorkspaceStartupPreset {
  const normalized = normalizePresetDraft(preset);
  if (!normalized.terminal) {
    return normalized;
  }
  return {
    ...normalized,
    terminal: {
      ...normalized.terminal,
      groups: resolveBlankGroupNames(normalized.terminal.groups, harnessNamesById),
    },
  };
}

function groupNamePlaceholder(
  group: WorkspaceStartupGroup,
  index: number,
  harnessNamesById: ReadonlyMap<string, string>,
): string {
  return defaultGroupNameFromHarness(group, harnessNamesById)
    ?? translate("workspace:startup.fallbackTerminal", { index: index + 1 });
}

function updateGroupById(
  preset: WorkspaceStartupPreset,
  groupId: string,
  updater: (group: WorkspaceStartupGroup) => WorkspaceStartupGroup,
): WorkspaceStartupPreset {
  const terminal = preset.terminal;
  if (!terminal) {
    return preset;
  }
  return normalizePresetDraft({
    ...preset,
    terminal: {
      ...terminal,
      groups: terminal.groups.map((group) => (group.id === groupId ? updater(group) : group)),
    },
  });
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function fileFormatFromPath(path: string): WorkspaceStartupPresetFormat {
  return path.toLowerCase().endsWith(".toml") ? "toml" : "json";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultExportFilename(
  workspace: Workspace,
  format: WorkspaceStartupPresetFormat,
): string {
  const base = (workspace.name || basename(workspace.rootPath) || "workspace")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  return `${base}-startup-preset.${format}`;
}

function StartupSplitNodeEditor({
  label,
  node,
  sessionIds,
  onChange,
}: StartupSplitNodeEditorProps) {
  const { t } = useTranslation("workspace");
  const leafFallback = sessionIds[0] ?? "session-1";
  const nextLeafId = node.type === "leaf"
    ? node.sessionId
    : collectSplitSessionIds(node)[0] ?? leafFallback;
  const secondSessionId = sessionIds.find((sessionId) => sessionId !== nextLeafId) ?? sessionIds[1] ?? null;

  return (
    <div className="workspace-preset-tree-node">
      <div className="workspace-preset-inline-row">
        <span className="workspace-preset-tree-label">{label}</span>
        <Dropdown
          value={node.type}
          options={[
            { value: "leaf", label: t("startup.modal.leaf") },
            { value: "split", label: t("startup.modal.split") },
          ]}
          triggerStyle={{ borderRadius: "var(--radius-sm)", minWidth: 120 }}
          onChange={(nextType) => {
            if (nextType === node.type) {
              return;
            }
            if (nextType === "leaf") {
              onChange({
                type: "leaf",
                sessionId: nextLeafId,
              });
              return;
            }
            if (!secondSessionId) {
              toast.error(t("startup.modal.addAnotherPaneBeforeSplit"));
              return;
            }
            onChange({
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                {
                  type: "leaf",
                  sessionId: nextLeafId,
                },
                {
                  type: "leaf",
                  sessionId: secondSessionId,
                },
              ],
            });
          }}
        />
      </div>

      {node.type === "leaf" ? (
        <Dropdown
          value={node.sessionId}
          options={sessionIds.map((sid) => ({ value: sid, label: sid }))}
          triggerStyle={{ borderRadius: "var(--radius-sm)" }}
          onChange={(sid) =>
            onChange({
              type: "leaf",
              sessionId: sid,
            })
          }
        />
      ) : (
        <>
          <div className="workspace-preset-inline-row">
            <Dropdown
              value={node.direction}
              options={[
                { value: "vertical", label: t("startup.modal.verticalSplit") },
                { value: "horizontal", label: t("startup.modal.horizontalSplit") },
              ]}
              triggerStyle={{ borderRadius: "var(--radius-sm)", minWidth: 140 }}
              onChange={(dir) =>
                onChange({
                  ...node,
                  direction: dir as "horizontal" | "vertical",
                })
              }
            />
            <input
              className="git-inline-input"
              style={{ width: 96 }}
              type="number"
              min={0.1}
              max={0.9}
              step={0.05}
              value={node.ratio}
              onChange={(event) =>
                onChange({
                  ...node,
                  ratio: Number(event.target.value),
                })
              }
            />
          </div>
          <div className="workspace-preset-tree-children">
            <StartupSplitNodeEditor
              label={t("startup.modal.childLabel", { label, suffix: "A" })}
              node={node.children[0]}
              sessionIds={sessionIds}
              onChange={(nextChild) =>
                onChange({
                  ...node,
                  children: [nextChild, node.children[1]],
                })
              }
            />
            <StartupSplitNodeEditor
              label={t("startup.modal.childLabel", { label, suffix: "B" })}
              node={node.children[1]}
              sessionIds={sessionIds}
              onChange={(nextChild) =>
                onChange({
                  ...node,
                  children: [node.children[0], nextChild],
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

export function WorkspaceStartupPresetModal({
  open,
  workspace,
  onClose,
}: WorkspaceStartupPresetModalProps) {
  const { t } = useTranslation("workspace");
  const harnesses = useHarnessStore((state) => state.harnesses);
  const harnessesLoadedOnce = useHarnessStore((state) => state.loadedOnce);
  const ensureHarnessesScanned = useHarnessStore((state) => state.ensureScanned);
  const isActiveWorkspace = useWorkspaceStore((state) => state.activeWorkspaceId === workspace.id);
  const runtimeWorkspace = useTerminalStore((state) => state.workspaces[workspace.id]);

  const installedHarnesses = useMemo(
    () => harnesses.filter((harness) => harness.found),
    [harnesses],
  );
  const harnessNamesById = useMemo(
    () => new Map(installedHarnesses.map((harness) => [harness.id, harness.name])),
    [installedHarnesses],
  );

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("builder");
  const [advancedFormat, setAdvancedFormat] = useState<WorkspaceStartupPresetFormat>("json");
  const [advancedDraft, setAdvancedDraft] = useState("");
  const [builderDraft, setBuilderDraft] = useState<WorkspaceStartupPreset>(createEmptyPreset());
  const [savedPreset, setSavedPreset] = useState<WorkspaceStartupPreset | null>(null);
  const [pendingApplyPreset, setPendingApplyPreset] = useState<WorkspaceStartupPreset | null>(null);
  const [liveSessionCount, setLiveSessionCount] = useState(0);
  const applyInFlightRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const openRef = useRef(open);

  const terminalDraft = builderDraft.terminal;
  const hasWorktrees = isActiveWorkspace && (runtimeWorkspace?.groups ?? []).some(
    (group) => (group.sessionMeta ? Object.values(group.sessionMeta) : []).some((meta) => meta.worktree),
  );
  const controlsDisabled = loading || saving;

  useEffect(() => {
    if (!open || harnessesLoadedOnce) {
      return;
    }
    void ensureHarnessesScanned();
  }, [ensureHarnessesScanned, harnessesLoadedOnce, open]);

  const viewOptions = useMemo(
    () =>
      VIEW_OPTIONS.map((value) => ({
        value,
        label: t(`startup.views.${value}`),
      })),
    [t],
  );
  const pathBaseOptions = useMemo(
    () =>
      PATH_BASE_OPTIONS.map((value) => ({
        value,
        label: t(`startup.pathBase.${value}`),
      })),
    [t],
  );
  const advancedFormatOptions = useMemo(
    () => [
      { value: "json", label: "JSON" },
      { value: "toml", label: "TOML" },
    ],
    [],
  );

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      loadRequestIdRef.current += 1;
    }
  }, [open]);

  const serializePresetForEditor = useCallback(
    async (format: WorkspaceStartupPresetFormat, preset: WorkspaceStartupPreset) => {
      const materialized = materializePresetDraft(preset, harnessNamesById);
      if (format === "json") {
        return serializeWorkspaceStartupPresetAsJson(materialized);
      }
      return await ipc.serializeWorkspaceStartupPreset(workspace.id, materialized, format);
    },
    [harnessNamesById, workspace.id],
  );

  const serializeCurrentBuilder = useCallback(
    async (format: WorkspaceStartupPresetFormat, preset = builderDraft) => {
      return await serializePresetForEditor(format, preset);
    },
    [builderDraft, serializePresetForEditor],
  );

  const refreshLiveSessionCount = useCallback(async () => {
    const sessions = await ipc.terminalListSessions(workspace.id);
    setLiveSessionCount(sessions.length);
    return sessions.length;
  }, [workspace.id]);

  const loadPreset = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    try {
      const [preset, sessions] = await Promise.all([
        ipc.getWorkspaceStartupPreset(workspace.id),
        ipc.terminalListSessions(workspace.id),
      ]);
      if (!canCommitWorkspaceStartupPresetLoad(requestId, loadRequestIdRef.current, openRef.current)) {
        return;
      }
      const nextPreset = normalizePresetDraft(preset ?? createEmptyPreset());
      const advancedJson = await serializePresetForEditor("json", nextPreset);
      if (!canCommitWorkspaceStartupPresetLoad(requestId, loadRequestIdRef.current, openRef.current)) {
        return;
      }
      setSavedPreset(preset);
      setBuilderDraft(nextPreset);
      setAdvancedFormat("json");
      setAdvancedDraft(advancedJson);
      setEditorMode("builder");
      setPendingApplyPreset(null);
      setLiveSessionCount(sessions.length);
    } catch (error) {
      if (!canCommitWorkspaceStartupPresetLoad(requestId, loadRequestIdRef.current, openRef.current)) {
        return;
      }
      toast.error(t("startup.toasts.loadFailed", { error: getErrorMessage(error) }));
    } finally {
      if (canCommitWorkspaceStartupPresetLoad(requestId, loadRequestIdRef.current, openRef.current)) {
        setLoading(false);
      }
    }
  }, [serializePresetForEditor, t, workspace.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadPreset();
  }, [loadPreset, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (pendingApplyPreset) {
          setPendingApplyPreset(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open, pendingApplyPreset]);

  const resolveCurrentPreset = useCallback(async (): Promise<WorkspaceStartupPreset> => {
    if (editorMode === "advanced") {
      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
        workspace.id,
        advancedFormat,
        advancedDraft,
      );
      setBuilderDraft(normalizePresetDraft(normalized));
      return normalized;
    }

    const materialized = materializePresetDraft(builderDraft, harnessNamesById);
    const normalized = await ipc.normalizeWorkspaceStartupPreset(workspace.id, materialized);
    setBuilderDraft(normalizePresetDraft(normalized));
    return normalized;
  }, [advancedDraft, advancedFormat, builderDraft, editorMode, harnessNamesById, workspace.id]);

  const syncAdvancedFromBuilder = useCallback(
    async (format: WorkspaceStartupPresetFormat) => {
      const serialized = await serializeCurrentBuilder(format);
      setAdvancedFormat(format);
      setAdvancedDraft(serialized);
    },
    [serializeCurrentBuilder],
  );

  const switchEditorMode = useCallback(async (nextMode: EditorMode) => {
    if (loading || nextMode === editorMode) {
      return;
    }

    try {
      if (nextMode === "advanced") {
        await syncAdvancedFromBuilder(advancedFormat);
        setEditorMode("advanced");
        return;
      }

      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
        workspace.id,
        advancedFormat,
        advancedDraft,
      );
      setBuilderDraft(normalizePresetDraft(normalized));
      setEditorMode("builder");
    } catch (error) {
      toast.error(t("startup.toasts.fixBeforeClosing", { error: getErrorMessage(error) }));
    }
  }, [advancedDraft, advancedFormat, editorMode, loading, syncAdvancedFromBuilder, t, workspace.id]);

  const handleAdvancedFormatChange = useCallback(async (
    nextFormat: WorkspaceStartupPresetFormat,
  ) => {
    if (loading || nextFormat === advancedFormat) {
      return;
    }

    try {
      if (editorMode === "advanced") {
        const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
          workspace.id,
          advancedFormat,
          advancedDraft,
        );
        setBuilderDraft(normalizePresetDraft(normalized));
        setAdvancedDraft(await serializePresetForEditor(nextFormat, normalized));
        setAdvancedFormat(nextFormat);
        return;
      }

      await syncAdvancedFromBuilder(nextFormat);
    } catch (error) {
      toast.error(t("startup.toasts.switchFormatFailed", { error: getErrorMessage(error) }));
    }
  }, [advancedDraft, advancedFormat, editorMode, loading, serializePresetForEditor, syncAdvancedFromBuilder, t, workspace.id]);

  const updateDraft = useCallback((updater: (current: WorkspaceStartupPreset) => WorkspaceStartupPreset) => {
    setBuilderDraft((current) => normalizePresetDraft(updater(current)));
  }, []);

  const ensureTerminal = useCallback(() => {
    updateDraft((current) => ({
      ...current,
      terminal: current.terminal ?? createDefaultTerminalPreset(),
    }));
  }, [updateDraft]);

  const handleDefaultViewChange = useCallback((value: WorkspaceDefaultView) => {
    updateDraft((current) => ({
      ...current,
      defaultView: value,
      terminal:
        (value === "terminal" || value === "split") && !current.terminal
          ? createDefaultTerminalPreset()
          : current.terminal,
    }));
  }, [updateDraft]);

  const addGroup = useCallback(() => {
    updateDraft((current) => {
      const terminal = current.terminal ?? createDefaultTerminalPreset();
      const group = createDefaultGroup(terminal.groups.length + 1);
      return {
        ...current,
        terminal: {
          ...terminal,
          groups: [...terminal.groups, group],
          activeGroupId: group.id,
          focusedSessionId: group.sessions[0]?.id ?? terminal.focusedSessionId,
        },
      };
    });
  }, [updateDraft]);

  const removeGroup = useCallback((groupId: string) => {
    updateDraft((current) => {
      if (!current.terminal) {
        return current;
      }
      const groups = current.terminal.groups.filter((group) => group.id !== groupId);
      return {
        ...current,
        terminal: groups.length > 0
          ? {
              ...current.terminal,
              groups,
            }
          : null,
      };
    });
  }, [updateDraft]);

  const updateGroup = useCallback((
    groupId: string,
    updater: (group: WorkspaceStartupGroup) => WorkspaceStartupGroup,
  ) => {
    updateDraft((current) => updateGroupById(current, groupId, updater));
  }, [updateDraft]);

  const addSession = useCallback((groupId: string) => {
    updateDraft((current) => updateGroupById(current, groupId, (group) => {
      const nextSessionIndex = group.sessions.length + 1;
      const nextSession = {
        ...createDefaultSession(nextSessionIndex),
        id: createStartupId("session"),
      };
      return {
        ...group,
        sessions: [...group.sessions, nextSession],
        root: appendSessionToSplitTree(group.root, nextSession.id),
      };
    }));
  }, [updateDraft]);

  const removeSession = useCallback((groupId: string, sessionId: string) => {
    updateDraft((current) => {
      const terminal = current.terminal;
      if (!terminal) {
        return current;
      }
      return normalizePresetDraft({
        ...current,
        terminal: {
          ...terminal,
          groups: terminal.groups.flatMap((group) => {
            if (group.id !== groupId) {
              return [group];
            }

            const nextSessions = group.sessions.filter((session) => session.id !== sessionId);
            if (nextSessions.length === 0) {
              return [];
            }

            const nextRoot = removeSessionFromSplitTree(group.root, sessionId)
              ?? {
                type: "leaf" as const,
                sessionId: nextSessions[0].id,
              };
            return [{
              ...group,
              sessions: nextSessions,
              root: nextRoot,
            }];
          }),
        },
      });
    });
  }, [updateDraft]);

  const updateSession = useCallback((
    groupId: string,
    sessionId: string,
    updater: (session: WorkspaceStartupSession) => WorkspaceStartupSession,
  ) => {
    updateDraft((current) => updateGroupById(current, groupId, (group) => ({
      ...group,
      sessions: group.sessions.map((session) =>
        session.id === sessionId ? updater(session) : session,
      ),
    })));
  }, [updateDraft]);

  const setActiveGroupId = useCallback((groupId: string) => {
    updateDraft((current) => {
      if (!current.terminal) {
        return current;
      }
      const group = current.terminal.groups.find((item) => item.id === groupId);
      return {
        ...current,
        terminal: {
          ...current.terminal,
          activeGroupId: groupId,
          focusedSessionId: group?.sessions[0]?.id ?? current.terminal.focusedSessionId ?? null,
        },
      };
    });
  }, [updateDraft]);

  const setFocusedSessionId = useCallback((sessionId: string) => {
    updateDraft((current) => {
      if (!current.terminal) {
        return current;
      }
      return {
        ...current,
        terminal: {
          ...current.terminal,
          focusedSessionId: sessionId,
        },
      };
    });
  }, [updateDraft]);

  const handleValidate = useCallback(async () => {
    if (loading) {
      return;
    }
    try {
      await resolveCurrentPreset();
      toast.success(t("startup.toasts.validationPassed"));
    } catch (error) {
      toast.error(t("startup.toasts.validationFailed", { error: getErrorMessage(error) }));
    }
  }, [loading, resolveCurrentPreset, t]);

  const handleSave = useCallback(async () => {
    if (loading) {
      return;
    }
    setSaving(true);
    try {
      const normalized = editorMode === "advanced"
        ? await ipc.setWorkspaceStartupPresetRaw(workspace.id, advancedFormat, advancedDraft)
        : await ipc.setWorkspaceStartupPreset(
          workspace.id,
          materializePresetDraft(builderDraft, harnessNamesById),
        );
      const canonical = normalizePresetDraft(normalized);
      setSavedPreset(canonical);
      setBuilderDraft(canonical);
      setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, canonical);
      toast.success(t("startup.toasts.saved"));
    } catch (error) {
      toast.error(t("startup.toasts.saveFailed", { error: getErrorMessage(error) }));
    } finally {
      setSaving(false);
    }
  }, [advancedDraft, advancedFormat, builderDraft, editorMode, harnessNamesById, loading, serializeCurrentBuilder, t, workspace.id]);

  const handleClear = useCallback(async () => {
    if (loading) {
      return;
    }
    setSaving(true);
    try {
      await ipc.clearWorkspaceStartupPreset(workspace.id);
      const emptyPreset = createEmptyPreset();
      setSavedPreset(null);
      setBuilderDraft(emptyPreset);
      setAdvancedFormat("json");
      setAdvancedDraft(await serializeCurrentBuilder("json", emptyPreset));
      setEditorMode("builder");
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, null);
      toast.success(t("startup.toasts.cleared"));
    } catch (error) {
      toast.error(t("startup.toasts.clearFailed", { error: getErrorMessage(error) }));
    } finally {
      setSaving(false);
    }
  }, [loading, serializeCurrentBuilder, t, workspace.id]);

  const handleSaveCurrentLayout = useCallback(async () => {
    if (loading) {
      return;
    }
    setSaving(true);
    try {
      if (!isActiveWorkspace) {
        throw new Error(t("startup.errors.switchWorkspaceFirst"));
      }
      const serialized = useTerminalStore.getState().serializeWorkspaceRuntimeAsStartupPreset(workspace.id);
      if (!serialized) {
        throw new Error(t("startup.errors.runtimeLayoutUnavailable"));
      }
      const normalized = await ipc.setWorkspaceStartupPreset(workspace.id, serialized);
      const canonical = normalizePresetDraft(normalized);
      setSavedPreset(canonical);
      setBuilderDraft(canonical);
      setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, canonical);
      toast.success(t("startup.toasts.currentLayoutSaved"));
    } catch (error) {
      toast.error(t("startup.toasts.saveLayoutFailed", { error: getErrorMessage(error) }));
    } finally {
      setSaving(false);
    }
  }, [advancedFormat, isActiveWorkspace, loading, serializeCurrentBuilder, t, workspace.id]);

  const performApply = useCallback(async (removeWorktrees: boolean) => {
    if (!pendingApplyPreset || applyInFlightRef.current || loading) {
      return;
    }

    applyInFlightRef.current = true;
    setSaving(true);
    try {
      const normalized = await resolveCurrentPreset();
      const applied = await useTerminalStore
        .getState()
        .applyWorkspaceStartupPresetNow(workspace.id, normalized, { removeWorktrees });
      if (!applied) {
        throw new Error(t("startup.errors.presetCouldNotBeApplied"));
      }
      setPendingApplyPreset(null);
      const canonical = normalizePresetDraft(normalized);
      setBuilderDraft(canonical);
      setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
      await refreshLiveSessionCount();
      toast.success(t("startup.toasts.applied"));
    } catch (error) {
      toast.error(t("startup.toasts.applyFailed", { error: getErrorMessage(error) }));
    } finally {
      applyInFlightRef.current = false;
      setSaving(false);
    }
  }, [advancedFormat, loading, pendingApplyPreset, refreshLiveSessionCount, resolveCurrentPreset, serializeCurrentBuilder, t, workspace.id]);

  const handleApplyNow = useCallback(async () => {
    if (applyInFlightRef.current || loading) {
      return;
    }

    applyInFlightRef.current = true;
    setSaving(true);
    try {
      if (!isActiveWorkspace) {
        throw new Error(t("startup.errors.switchWorkspaceFirst"));
      }
      const normalized = await resolveCurrentPreset();
      const currentLiveSessionCount = await refreshLiveSessionCount();
      if (currentLiveSessionCount > 0) {
        setPendingApplyPreset(normalizePresetDraft(normalized));
        return;
      }
      const applied = await useTerminalStore.getState().applyWorkspaceStartupPresetNow(workspace.id, normalized);
      if (!applied) {
        throw new Error(t("startup.errors.presetCouldNotBeApplied"));
      }
      await refreshLiveSessionCount();
      toast.success(t("startup.toasts.applied"));
    } catch (error) {
      toast.error(t("startup.toasts.applyFailed", { error: getErrorMessage(error) }));
    } finally {
      applyInFlightRef.current = false;
      setSaving(false);
    }
  }, [isActiveWorkspace, loading, refreshLiveSessionCount, resolveCurrentPreset, t, workspace.id]);

  const handleImport = useCallback(async () => {
    if (loading) {
      return;
    }
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const selected = await openDialog({
        multiple: false,
        title: t("startup.dialog.importTitle"),
        filters: [
          { name: t("startup.dialog.presetFiles"), extensions: ["json", "toml"] },
          { name: "JSON", extensions: ["json"] },
          { name: "TOML", extensions: ["toml"] },
        ],
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const format = fileFormatFromPath(selected);
      const raw = await readTextFile(selected);
      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(workspace.id, format, raw);
      setBuilderDraft(normalizePresetDraft(normalized));
      setAdvancedFormat(format);
      setAdvancedDraft(raw);
      toast.success(t("startup.toasts.imported"));
    } catch (error) {
      toast.error(t("startup.toasts.importFailed", { error: getErrorMessage(error) }));
    }
  }, [loading, t, workspace.id]);

  const handleExport = useCallback(async () => {
    if (loading) {
      return;
    }
    try {
      const format = advancedFormat;
      const normalized = await resolveCurrentPreset();
      const raw = await serializeCurrentBuilder(format, normalized);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const target = await save({
        title: t("startup.dialog.exportTitle"),
        defaultPath: defaultExportFilename(workspace, format),
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format],
          },
        ],
      });
      if (!target) {
        return;
      }
      await writeTextFile(target, raw);
      toast.success(t("startup.toasts.exported"));
    } catch (error) {
      toast.error(t("startup.toasts.exportFailed", { error: getErrorMessage(error) }));
    }
  }, [advancedFormat, loading, resolveCurrentPreset, serializeCurrentBuilder, t, workspace, workspace.id]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="workspace-preset-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workspace-preset-header">
          <div className="workspace-preset-header-copy">
            <div className="workspace-preset-header-icon">
              <Settings2 size={16} />
            </div>
            <div>
              <h3 className="workspace-preset-title">{t("startup.modal.title")}</h3>
              <p className="workspace-preset-subtitle">{workspace.name || workspace.rootPath}</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} title={t("common:actions.close")}>
            <X size={14} />
          </button>
        </div>

        <div className="workspace-preset-toolbar">
          <div className="workspace-preset-mode-tabs">
            <button
              type="button"
              className={`workspace-preset-mode-tab${editorMode === "builder" ? " workspace-preset-mode-tab-active" : ""}`}
              onClick={() => void switchEditorMode("builder")}
              disabled={controlsDisabled}
            >
              {t("startup.modal.builder")}
            </button>
            <button
              type="button"
              className={`workspace-preset-mode-tab${editorMode === "advanced" ? " workspace-preset-mode-tab-active" : ""}`}
              onClick={() => void switchEditorMode("advanced")}
              disabled={controlsDisabled}
            >
              {t("startup.modal.advanced")}
            </button>
          </div>

          <div className="workspace-preset-toolbar-actions">
            {editorMode === "advanced" && (
              <Dropdown
                value={advancedFormat}
                options={advancedFormatOptions}
                disabled={controlsDisabled}
                triggerStyle={{ borderRadius: "var(--radius-sm)", minWidth: 80 }}
                onChange={(v) =>
                  void handleAdvancedFormatChange(v as WorkspaceStartupPresetFormat)
                }
              />
            )}
            <button type="button" className="btn btn-ghost" onClick={() => void handleImport()} disabled={controlsDisabled}>
              <Upload size={12} />
              {t("startup.import")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void handleExport()} disabled={controlsDisabled}>
              <Download size={12} />
              {t("startup.export")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void handleValidate()} disabled={controlsDisabled}>
              {t("startup.modal.validate")}
            </button>
          </div>
        </div>

        <div className="workspace-preset-body">
          {loading ? (
            <div className="workspace-preset-empty-state">{t("startup.loading")}</div>
          ) : editorMode === "advanced" ? (
            <textarea
              className="workspace-preset-advanced-editor"
              value={advancedDraft}
              disabled={saving}
              onChange={(event) => setAdvancedDraft(event.target.value)}
              spellCheck={false}
            />
          ) : (
            <>
              <section className="workspace-preset-section">
                <div className="workspace-preset-section-header">
                  <h4>{t("startup.modal.general")}</h4>
                </div>
                <div className="workspace-preset-grid">
                  <label className="workspace-preset-field">
                    <span>{t("startup.modal.defaultView")}</span>
                    <Dropdown
                      value={builderDraft.defaultView}
                      options={viewOptions}
                      triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                      onChange={(v) =>
                        handleDefaultViewChange(v as WorkspaceDefaultView)
                      }
                    />
                  </label>
                  {shouldShowStartupSplitPanelSize(builderDraft.defaultView) && (
                    <label className="workspace-preset-field">
                      <span>{t("startup.splitPanelSize")}</span>
                      <input
                        className="git-inline-input"
                        type="number"
                        min={15}
                        max={72}
                        value={builderDraft.splitPanelSize ?? DEFAULT_SPLIT_PANEL_SIZE}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            splitPanelSize: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  )}
                </div>
              </section>

              <section className="workspace-preset-section">
                <div className="workspace-preset-section-header">
                  <div>
                    <h4>{t("startup.modal.startupLayout")}</h4>
                    <p>{t("startup.modal.appliedOnlyWhen")}</p>
                  </div>
                  <button type="button" className="btn btn-ghost" onClick={addGroup}>
                    <Plus size={12} />
                    {t("startup.addTab")}
                  </button>
                </div>

                {!terminalDraft || terminalDraft.groups.length === 0 ? (
                  <div className="workspace-preset-empty-state">
                    <p>{t("startup.modal.noStartupTabsConfigured")}</p>
                    <button type="button" className="btn btn-outline" onClick={ensureTerminal}>
                      {t("startup.modal.createStartupLayout")}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="workspace-preset-grid">
                      <label className="workspace-preset-field">
                        <span>{t("startup.modal.activeTabOnStart")}</span>
                        <Dropdown
                          value={terminalDraft.activeGroupId ?? ""}
                          options={terminalDraft.groups.map((group) => ({
                            value: group.id,
                            label: group.name,
                          }))}
                          triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                          onChange={(v) => setActiveGroupId(v)}
                        />
                      </label>
                      <label className="workspace-preset-field">
                        <span>{t("startup.modal.focusedPaneOnStart")}</span>
                        <Dropdown
                          value={terminalDraft.focusedSessionId ?? ""}
                          options={terminalDraft.groups.flatMap((group) =>
                            group.sessions.map((session) => ({
                              value: session.id,
                              label: `${group.name} / ${session.title ?? session.id}`,
                            })),
                          )}
                          triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                          onChange={(v) => setFocusedSessionId(v)}
                        />
                      </label>
                    </div>

                    {terminalDraft.groups.map((group, groupIndex) => {
                      const groupSessionIds = group.sessions.map((session) => session.id);
                      const worktree = group.worktree ?? {
                        enabled: false,
                        repoMode: "active_repo",
                        repoPath: null,
                        baseBranch: null,
                        baseDir: null,
                        branchPrefix: null,
                      } satisfies WorkspaceStartupWorktreeConfig;

                      return (
                        <div key={group.id} className="workspace-preset-group-card">
                          <div className="workspace-preset-group-header">
                            <div className="workspace-preset-group-title-row">
                              <label className="workspace-preset-field" style={{ flex: 1 }}>
                                <span>{t("startup.modal.tabName")}</span>
                                <input
                                  className="git-inline-input"
                                  value={group.name}
                                  onChange={(event) =>
                                    updateGroup(group.id, (currentGroup) => ({
                                      ...currentGroup,
                                      name: event.target.value,
                                    }))
                                  }
                                  placeholder={groupNamePlaceholder(group, groupIndex, harnessNamesById)}
                                />
                              </label>
                              <label className="workspace-preset-field" style={{ width: 180 }}>
                                <span>{t("startup.modal.groupId")}</span>
                                <input
                                  className="git-inline-input"
                                  value={group.id}
                                  readOnly
                                />
                              </label>
                            </div>
                            <div className="workspace-preset-inline-row">
                              <label className="workspace-preset-checkbox">
                                <input
                                  type="checkbox"
                                  checked={Boolean(group.broadcastOnStart)}
                                  onChange={(event) =>
                                    updateDraft((current) => {
                                      if (!current.terminal) {
                                        return current;
                                      }
                                      return {
                                        ...current,
                                        terminal: {
                                          ...current.terminal,
                                          groups: current.terminal.groups.map((currentGroup) => ({
                                            ...currentGroup,
                                            broadcastOnStart:
                                              currentGroup.id === group.id
                                                ? event.target.checked
                                                : false,
                                          })),
                                        },
                                      };
                                    })
                                  }
                                />
                                {t("startup.modal.broadcastOnStart")}
                              </label>
                              <button type="button" className="btn btn-ghost" onClick={() => addSession(group.id)}>
                                <Plus size={12} />
                                {t("startup.addPane")}
                              </button>
                              <button type="button" className="btn btn-ghost" onClick={() => removeGroup(group.id)}>
                                <Trash2 size={12} />
                                {t("startup.removeTab")}
                              </button>
                            </div>
                          </div>

                          <div className="workspace-preset-subsection">
                            <div className="workspace-preset-subsection-header">
                              <h5>{t("startup.modal.worktree")}</h5>
                            </div>
                            <div className="workspace-preset-grid">
                              <label className="workspace-preset-checkbox">
                                <input
                                  type="checkbox"
                                  checked={worktree.enabled}
                                  onChange={(event) =>
                                    updateGroup(group.id, (currentGroup) => ({
                                      ...currentGroup,
                                      worktree: event.target.checked
                                        ? {
                                            enabled: true,
                                            repoMode: currentGroup.worktree?.repoMode ?? "active_repo",
                                            repoPath: currentGroup.worktree?.repoPath ?? null,
                                            baseBranch: currentGroup.worktree?.baseBranch ?? null,
                                            baseDir: currentGroup.worktree?.baseDir ?? ".panes/worktrees",
                                            branchPrefix: currentGroup.worktree?.branchPrefix ?? "panes/preset",
                                          }
                                        : null,
                                    }))
                                  }
                                />
                                {t("startup.modal.enablePerPaneWorktrees")}
                              </label>
                              {worktree.enabled && (
                                <>
                                  <label className="workspace-preset-field">
                                    <span>{t("startup.worktree.repo")}</span>
                                    <Dropdown
                                      value={worktree.repoMode}
                                      options={[
                                        { value: "active_repo", label: t("startup.worktree.activeRepo") },
                                        { value: "fixed_repo", label: t("startup.worktree.fixedRepo") },
                                      ]}
                                      triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                                      onChange={(v) =>
                                        updateGroup(group.id, (currentGroup) => ({
                                          ...currentGroup,
                                          worktree: {
                                            ...(currentGroup.worktree ?? worktree),
                                            enabled: true,
                                            repoMode: v as "active_repo" | "fixed_repo",
                                          },
                                        }))
                                      }
                                    />
                                  </label>
                                  {worktree.repoMode === "fixed_repo" && (
                                    <label className="workspace-preset-field">
                                      <span>{t("startup.worktree.path")}</span>
                                      <input
                                        className="git-inline-input"
                                        value={worktree.repoPath ?? ""}
                                        onChange={(event) =>
                                          updateGroup(group.id, (currentGroup) => ({
                                            ...currentGroup,
                                            worktree: {
                                              ...(currentGroup.worktree ?? worktree),
                                              enabled: true,
                                              repoMode: "fixed_repo",
                                              repoPath: event.target.value,
                                            },
                                          }))
                                        }
                                        placeholder="."
                                      />
                                    </label>
                                  )}
                                  <label className="workspace-preset-field">
                                    <span>{t("startup.worktree.branch")}</span>
                                    <input
                                      className="git-inline-input"
                                      value={worktree.baseBranch ?? ""}
                                      onChange={(event) =>
                                        updateGroup(group.id, (currentGroup) => ({
                                          ...currentGroup,
                                          worktree: {
                                            ...(currentGroup.worktree ?? worktree),
                                            enabled: true,
                                            baseBranch: event.target.value || null,
                                          },
                                        }))
                                      }
                                      placeholder="main"
                                    />
                                  </label>
                                  <label className="workspace-preset-field">
                                    <span>{t("startup.worktree.directory")}</span>
                                    <input
                                      className="git-inline-input"
                                      value={worktree.baseDir ?? ""}
                                      onChange={(event) =>
                                        updateGroup(group.id, (currentGroup) => ({
                                          ...currentGroup,
                                          worktree: {
                                            ...(currentGroup.worktree ?? worktree),
                                            enabled: true,
                                            baseDir: event.target.value || null,
                                          },
                                        }))
                                      }
                                      placeholder=".panes/worktrees"
                                    />
                                  </label>
                                  <label className="workspace-preset-field">
                                    <span>{t("startup.worktree.prefix")}</span>
                                    <input
                                      className="git-inline-input"
                                      value={worktree.branchPrefix ?? ""}
                                      onChange={(event) =>
                                        updateGroup(group.id, (currentGroup) => ({
                                          ...currentGroup,
                                          worktree: {
                                            ...(currentGroup.worktree ?? worktree),
                                            enabled: true,
                                            branchPrefix: event.target.value || null,
                                          },
                                        }))
                                      }
                                      placeholder="panes/preset"
                                    />
                                  </label>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="workspace-preset-subsection">
                            <div className="workspace-preset-subsection-header">
                              <h5>{t("startup.modal.panes")}</h5>
                            </div>
                            <div className="workspace-preset-sessions">
                              {group.sessions.map((session, index) => (
                                <div key={session.id} className="workspace-preset-session-card">
                                  <div className="workspace-preset-inline-row">
                                    <label className="workspace-preset-field" style={{ flex: 1 }}>
                                      <span>{t("startup.modal.paneId")}</span>
                                      <input
                                        className="git-inline-input"
                                        value={session.id}
                                        readOnly
                                      />
                                    </label>
                                    <label className="workspace-preset-field" style={{ flex: 1 }}>
                                      <span>{t("startup.pane.title")}</span>
                                      <input
                                        className="git-inline-input"
                                        value={session.title ?? ""}
                                        onChange={(event) =>
                                          updateSession(group.id, session.id, (currentSession) => ({
                                            ...currentSession,
                                            title: event.target.value || null,
                                          }))
                                        }
                                        placeholder={t("startup.modal.panePlaceholder", { index: index + 1 })}
                                      />
                                    </label>
                                  </div>

                                  <div className="workspace-preset-grid">
                                    <label className="workspace-preset-field">
                                      <span>{t("startup.modal.cwd")}</span>
                                      <input
                                        className="git-inline-input"
                                        value={session.cwd}
                                        onChange={(event) =>
                                          updateSession(group.id, session.id, (currentSession) => ({
                                            ...currentSession,
                                            cwd: event.target.value,
                                          }))
                                        }
                                        placeholder="."
                                      />
                                    </label>
                                    <label className="workspace-preset-field">
                                      <span>{t("startup.modal.pathBase")}</span>
                                      <Dropdown
                                        value={session.cwdBase ?? "workspace"}
                                        options={pathBaseOptions}
                                        triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                                        onChange={(v) =>
                                          updateSession(group.id, session.id, (currentSession) => ({
                                            ...currentSession,
                                            cwdBase: v as WorkspacePathBase,
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="workspace-preset-field">
                                      <span>{t("startup.modal.harness")}</span>
                                      <Dropdown
                                        value={session.harnessId ?? ""}
                                        options={[
                                          { value: "", label: t("startup.modal.plainTerminal") },
                                          ...installedHarnesses.map((h) => ({
                                            value: h.id,
                                            label: h.name,
                                          })),
                                        ]}
                                        triggerStyle={{ borderRadius: "var(--radius-sm)" }}
                                        onChange={(v) =>
                                          updateSession(group.id, session.id, (currentSession) => ({
                                            ...currentSession,
                                            ...resolveStartupSessionHarnessSelection(v),
                                          }))
                                        }
                                      />
                                    </label>
                                    <label className="workspace-preset-checkbox">
                                      <input
                                        type="checkbox"
                                        checked={session.launchHarnessOnCreate ?? Boolean(session.harnessId)}
                                        onChange={(event) =>
                                          updateSession(group.id, session.id, (currentSession) => ({
                                            ...currentSession,
                                            launchHarnessOnCreate: event.target.checked,
                                          }))
                                        }
                                        disabled={!session.harnessId}
                                      />
                                      {t("startup.modal.launchHarnessOnCreate")}
                                    </label>
                                  </div>

                                  <div className="workspace-preset-inline-row">
                                    <button
                                      type="button"
                                      className="btn btn-ghost"
                                      onClick={() => removeSession(group.id, session.id)}
                                      disabled={group.sessions.length === 1}
                                    >
                                      <Trash2 size={12} />
                                      {t("startup.removePane")}
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="workspace-preset-subsection">
                            <div className="workspace-preset-subsection-header">
                              <h5>{t("startup.modal.splitTree")}</h5>
                              <span className="workspace-preset-hint">
                                <Columns2 size={12} />
                                {t("startup.modal.usePaneIdsFromTab")}
                              </span>
                            </div>
                            <StartupSplitNodeEditor
                              label={t("startup.modal.root")}
                              node={group.root}
                              sessionIds={groupSessionIds}
                              onChange={(nextRoot) =>
                                updateGroup(group.id, (currentGroup) => ({
                                  ...currentGroup,
                                  root: nextRoot,
                                }))
                              }
                            />
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <div className="workspace-preset-footer">
          <div className="workspace-preset-footer-meta">
            <span>{savedPreset ? t("startup.modal.footer.presetSavedInDb") : t("startup.modal.footer.defaultBehavior")}</span>
            {liveSessionCount > 0 && <span>{t("startup.modal.footer.liveSessions", { count: liveSessionCount })}</span>}
            {!isActiveWorkspace && <span>{t("startup.modal.footer.switchWorkspaceToSaveLayout")}</span>}
          </div>
          <div className="workspace-preset-footer-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleSaveCurrentLayout()}
              disabled={controlsDisabled || !isActiveWorkspace}
              title={isActiveWorkspace ? t("startup.modal.footer.saveCurrentLayoutTitleActive") : t("startup.modal.footer.saveCurrentLayoutTitleInactive")}
            >
              <Rows2 size={12} />
              {t("startup.modal.footer.saveCurrentLayout")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleApplyNow()}
              disabled={controlsDisabled || !isActiveWorkspace}
              title={isActiveWorkspace ? t("startup.modal.footer.applyNowTitleActive") : t("startup.modal.footer.applyNowTitleInactive")}
            >
              <Play size={12} />
              {t("startup.applyNow")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void handleClear()} disabled={controlsDisabled}>
              <Trash2 size={12} />
              {t("startup.modal.footer.resetBehavior")}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={controlsDisabled}>
              <Save size={12} />
              {t("startup.modal.footer.savePreset")}
            </button>
          </div>
        </div>

        {pendingApplyPreset && (
          <div className="workspace-preset-apply-confirm">
            <div>
              <strong>{t("startup.confirm.replaceCurrentSessions")}</strong>
              <p>
                {t("startup.modal.confirm.applyingPresetWillClose")}
                {hasWorktrees ? ` ${t("startup.confirm.keepOrRemoveWorktrees")}` : ""}
              </p>
            </div>
            <div className="workspace-preset-apply-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPendingApplyPreset(null)} disabled={saving}>
                {t("startup.confirm.cancel")}
              </button>
              {hasWorktrees ? (
                <>
                  <button type="button" className="btn btn-ghost" onClick={() => void performApply(false)} disabled={saving}>
                    {t("startup.confirm.keepWorktrees")}
                  </button>
                  <button type="button" className="confirm-dialog-btn-danger" onClick={() => void performApply(true)} disabled={saving}>
                    {t("startup.confirm.removeWorktrees")}
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => void performApply(false)} disabled={saving}>
                  {t("startup.modal.applyPreset")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
