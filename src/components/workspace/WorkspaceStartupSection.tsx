import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Download,
  Play,
  Plus,
  Save,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
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

/* ── Helpers ───────────────────────────────────────── */

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

function createDefaultGroup(index = 1): WorkspaceStartupGroup {
  const session = createDefaultSession(1);
  return {
    id: createStartupId("group"),
    name: `Tab ${index}`,
    broadcastOnStart: false,
    worktree: null,
    sessions: [session],
    root: { type: "leaf", sessionId: session.id },
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

function clampSplitPanelSize(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_PANEL_SIZE;
  return Math.max(15, Math.min(72, Math.round(value ?? DEFAULT_SPLIT_PANEL_SIZE)));
}

function appendSessionToSplitTree(
  node: WorkspaceStartupSplitNode,
  sessionId: string,
): WorkspaceStartupSplitNode {
  return {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    children: [node, { type: "leaf", sessionId }],
  };
}

function removeSessionFromSplitTree(
  node: WorkspaceStartupSplitNode,
  sessionId: string,
): WorkspaceStartupSplitNode | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? null : node;
  const [left, right] = node.children;
  if (left.type === "leaf" && left.sessionId === sessionId) return right;
  if (right.type === "leaf" && right.sessionId === sessionId) return left;
  const nextLeft = removeSessionFromSplitTree(left, sessionId);
  const nextRight = removeSessionFromSplitTree(right, sessionId);
  if (nextLeft === null) return nextRight;
  if (nextRight === null) return nextLeft;
  return { ...node, children: [nextLeft, nextRight] };
}

function normalizeTerminalPreset(
  terminal: WorkspaceStartupPreset["terminal"],
): WorkspaceStartupPreset["terminal"] {
  if (!terminal) return null;
  if (terminal.groups.length === 0) {
    return { ...terminal, activeGroupId: null, focusedSessionId: null };
  }
  const groups = terminal.groups.map((g, i) => ({
    ...g,
    name: g.name.trim() || `Tab ${i + 1}`,
    broadcastOnStart: Boolean(g.broadcastOnStart),
  }));
  const activeGroupId = groups.some((g) => g.id === terminal.activeGroupId)
    ? terminal.activeGroupId
    : groups[0]?.id ?? null;
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];
  const allSessionIds = groups.flatMap((g) => g.sessions.map((s) => s.id));
  const focusedSessionId =
    terminal.focusedSessionId && allSessionIds.includes(terminal.focusedSessionId)
      ? terminal.focusedSessionId
      : activeGroup?.sessions[0]?.id ?? groups[0]?.sessions[0]?.id ?? null;
  return { ...terminal, groups, activeGroupId, focusedSessionId };
}

function normalizePresetDraft(preset: WorkspaceStartupPreset): WorkspaceStartupPreset {
  return {
    ...preset,
    splitPanelSize: clampSplitPanelSize(preset.splitPanelSize),
    terminal: normalizeTerminalPreset(preset.terminal),
  };
}

function updateGroupById(
  preset: WorkspaceStartupPreset,
  groupId: string,
  updater: (group: WorkspaceStartupGroup) => WorkspaceStartupGroup,
): WorkspaceStartupPreset {
  const terminal = preset.terminal;
  if (!terminal) return preset;
  return normalizePresetDraft({
    ...preset,
    terminal: {
      ...terminal,
      groups: terminal.groups.map((g) => (g.id === groupId ? updater(g) : g)),
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

function defaultExportFilename(
  workspace: Workspace,
  format: WorkspaceStartupPresetFormat,
): string {
  const base =
    (workspace.name || basename(workspace.rootPath) || "workspace")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace";
  return `${base}-startup-preset.${format}`;
}

function serializeAsJson(preset: WorkspaceStartupPreset): string {
  return JSON.stringify(preset, null, 2);
}

/* ── Component ─────────────────────────────────────── */

interface WorkspaceStartupSectionProps {
  workspace: Workspace;
}

export function WorkspaceStartupSection({ workspace }: WorkspaceStartupSectionProps) {
  const harnesses = useHarnessStore((s) => s.harnesses);
  const isActiveWorkspace = useWorkspaceStore((s) => s.activeWorkspaceId === workspace.id);
  const runtimeWorkspace = useTerminalStore((s) => s.workspaces[workspace.id]);

  const installedHarnesses = useMemo(() => harnesses.filter((h) => h.found), [harnesses]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [builderDraft, setBuilderDraft] = useState<WorkspaceStartupPreset>(createEmptyPreset());
  const [savedPreset, setSavedPreset] = useState<WorkspaceStartupPreset | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedFormat, setAdvancedFormat] = useState<WorkspaceStartupPresetFormat>("json");
  const [advancedDraft, setAdvancedDraft] = useState("");
  const [pendingApplyPreset, setPendingApplyPreset] = useState<WorkspaceStartupPreset | null>(null);
  const [liveSessionCount, setLiveSessionCount] = useState(0);
  const [expandedTabs, setExpandedTabs] = useState<Record<string, boolean>>({});
  const [expandedPanes, setExpandedPanes] = useState<Record<string, boolean>>({});
  const loadRequestIdRef = useRef(0);
  const applyInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const terminalDraft = builderDraft.terminal;
  const hasWorktrees =
    isActiveWorkspace &&
    (runtimeWorkspace?.groups ?? []).some((g) =>
      (g.sessionMeta ? Object.values(g.sessionMeta) : []).some((m) => m.worktree),
    );
  const controlsDisabled = loading || saving;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ── Serialization ── */

  const serializeForEditor = useCallback(
    async (format: WorkspaceStartupPresetFormat, preset: WorkspaceStartupPreset) => {
      if (format === "json") return serializeAsJson(preset);
      return await ipc.serializeWorkspaceStartupPreset(workspace.id, preset, format);
    },
    [workspace.id],
  );

  const serializeCurrentBuilder = useCallback(
    async (format: WorkspaceStartupPresetFormat, preset = builderDraft) => {
      return await serializeForEditor(format, preset);
    },
    [builderDraft, serializeForEditor],
  );

  const refreshLiveSessionCount = useCallback(async () => {
    const sessions = await ipc.terminalListSessions(workspace.id);
    setLiveSessionCount(sessions.length);
    return sessions.length;
  }, [workspace.id]);

  /* ── Load ── */

  const loadPreset = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const [preset, sessions] = await Promise.all([
        ipc.getWorkspaceStartupPreset(workspace.id),
        ipc.terminalListSessions(workspace.id),
      ]);
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      const nextPreset = normalizePresetDraft(preset ?? createEmptyPreset());
      const json = await serializeForEditor("json", nextPreset);
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      setSavedPreset(preset);
      setBuilderDraft(nextPreset);
      setAdvancedFormat("json");
      setAdvancedDraft(json);
      setPendingApplyPreset(null);
      setLiveSessionCount(sessions.length);
    } catch (error) {
      if (requestId !== loadRequestIdRef.current || !mountedRef.current) return;
      toast.error(`Failed to load preset: ${String(error)}`);
    } finally {
      if (requestId === loadRequestIdRef.current && mountedRef.current) setLoading(false);
    }
  }, [serializeForEditor, workspace.id]);

  useEffect(() => {
    void loadPreset();
  }, [loadPreset]);

  /* ── Draft updates ── */

  const updateDraft = useCallback(
    (updater: (c: WorkspaceStartupPreset) => WorkspaceStartupPreset) => {
      setBuilderDraft((c) => normalizePresetDraft(updater(c)));
    },
    [],
  );

  const ensureTerminal = useCallback(() => {
    updateDraft((c) => ({ ...c, terminal: c.terminal ?? createDefaultTerminalPreset() }));
  }, [updateDraft]);

  const handleDefaultViewChange = useCallback(
    (value: WorkspaceDefaultView) => {
      updateDraft((c) => ({
        ...c,
        defaultView: value,
        terminal:
          (value === "terminal" || value === "split") && !c.terminal
            ? createDefaultTerminalPreset()
            : c.terminal,
      }));
    },
    [updateDraft],
  );

  const addGroup = useCallback(() => {
    updateDraft((c) => {
      const terminal = c.terminal ?? createDefaultTerminalPreset();
      const group = createDefaultGroup(terminal.groups.length + 1);
      return {
        ...c,
        terminal: {
          ...terminal,
          groups: [...terminal.groups, group],
          activeGroupId: group.id,
          focusedSessionId: group.sessions[0]?.id ?? terminal.focusedSessionId,
        },
      };
    });
  }, [updateDraft]);

  const removeGroup = useCallback(
    (groupId: string) => {
      updateDraft((c) => {
        if (!c.terminal) return c;
        const groups = c.terminal.groups.filter((g) => g.id !== groupId);
        return { ...c, terminal: groups.length > 0 ? { ...c.terminal, groups } : null };
      });
    },
    [updateDraft],
  );

  const updateGroup = useCallback(
    (groupId: string, updater: (g: WorkspaceStartupGroup) => WorkspaceStartupGroup) => {
      updateDraft((c) => updateGroupById(c, groupId, updater));
    },
    [updateDraft],
  );

  const addSession = useCallback(
    (groupId: string) => {
      updateDraft((c) =>
        updateGroupById(c, groupId, (g) => {
          const s = { ...createDefaultSession(g.sessions.length + 1), id: createStartupId("session") };
          return { ...g, sessions: [...g.sessions, s], root: appendSessionToSplitTree(g.root, s.id) };
        }),
      );
    },
    [updateDraft],
  );

  const removeSession = useCallback(
    (groupId: string, sessionId: string) => {
      updateDraft((c) => {
        const terminal = c.terminal;
        if (!terminal) return c;
        return normalizePresetDraft({
          ...c,
          terminal: {
            ...terminal,
            groups: terminal.groups.flatMap((g) => {
              if (g.id !== groupId) return [g];
              const next = g.sessions.filter((s) => s.id !== sessionId);
              if (next.length === 0) return [];
              const root = removeSessionFromSplitTree(g.root, sessionId) ?? {
                type: "leaf" as const,
                sessionId: next[0].id,
              };
              return [{ ...g, sessions: next, root }];
            }),
          },
        });
      });
    },
    [updateDraft],
  );

  const updateSession = useCallback(
    (
      groupId: string,
      sessionId: string,
      updater: (s: WorkspaceStartupSession) => WorkspaceStartupSession,
    ) => {
      updateDraft((c) =>
        updateGroupById(c, groupId, (g) => ({
          ...g,
          sessions: g.sessions.map((s) => (s.id === sessionId ? updater(s) : s)),
        })),
      );
    },
    [updateDraft],
  );

  /* ── Resolve preset ── */

  const resolveCurrentPreset = useCallback(async (): Promise<WorkspaceStartupPreset> => {
    if (advancedOpen) {
      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
        workspace.id,
        advancedFormat,
        advancedDraft,
      );
      setBuilderDraft(normalizePresetDraft(normalized));
      return normalized;
    }
    const normalized = await ipc.normalizeWorkspaceStartupPreset(workspace.id, builderDraft);
    setBuilderDraft(normalizePresetDraft(normalized));
    return normalized;
  }, [advancedDraft, advancedFormat, advancedOpen, builderDraft, workspace.id]);

  /* ── Advanced editor ── */

  const syncAdvancedFromBuilder = useCallback(
    async (format: WorkspaceStartupPresetFormat) => {
      const serialized = await serializeCurrentBuilder(format);
      setAdvancedFormat(format);
      setAdvancedDraft(serialized);
    },
    [serializeCurrentBuilder],
  );

  const handleToggleAdvanced = useCallback(async () => {
    if (loading) return;
    try {
      if (!advancedOpen) {
        await syncAdvancedFromBuilder(advancedFormat);
        setAdvancedOpen(true);
        return;
      }
      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
        workspace.id,
        advancedFormat,
        advancedDraft,
      );
      setBuilderDraft(normalizePresetDraft(normalized));
      setAdvancedOpen(false);
    } catch (error) {
      toast.error(`Fix the preset before closing: ${String(error)}`);
    }
  }, [advancedDraft, advancedFormat, advancedOpen, loading, syncAdvancedFromBuilder, workspace.id]);

  const handleAdvancedFormatChange = useCallback(
    async (nextFormat: WorkspaceStartupPresetFormat) => {
      if (loading || nextFormat === advancedFormat) return;
      try {
        if (advancedOpen) {
          const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(
            workspace.id,
            advancedFormat,
            advancedDraft,
          );
          setBuilderDraft(normalizePresetDraft(normalized));
          setAdvancedDraft(await serializeForEditor(nextFormat, normalized));
          setAdvancedFormat(nextFormat);
          return;
        }
        await syncAdvancedFromBuilder(nextFormat);
      } catch (error) {
        toast.error(`Failed to switch format: ${String(error)}`);
      }
    },
    [
      advancedDraft,
      advancedFormat,
      advancedOpen,
      loading,
      serializeForEditor,
      syncAdvancedFromBuilder,
      workspace.id,
    ],
  );

  /* ── Actions ── */

  const handleSave = useCallback(async () => {
    if (loading) return;
    setSaving(true);
    try {
      const normalized = advancedOpen
        ? await ipc.setWorkspaceStartupPresetRaw(workspace.id, advancedFormat, advancedDraft)
        : await ipc.setWorkspaceStartupPreset(workspace.id, builderDraft);
      const canonical = normalizePresetDraft(normalized);
      setSavedPreset(canonical);
      setBuilderDraft(canonical);
      setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, canonical);
      toast.success("Startup preset saved.");
    } catch (error) {
      toast.error(`Failed to save: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [
    advancedDraft,
    advancedFormat,
    advancedOpen,
    builderDraft,
    loading,
    serializeCurrentBuilder,
    workspace.id,
  ]);

  const handleClear = useCallback(async () => {
    if (loading) return;
    setSaving(true);
    try {
      await ipc.clearWorkspaceStartupPreset(workspace.id);
      const empty = createEmptyPreset();
      setSavedPreset(null);
      setBuilderDraft(empty);
      setAdvancedFormat("json");
      setAdvancedDraft(await serializeCurrentBuilder("json", empty));
      setAdvancedOpen(false);
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, null);
      toast.success("Startup preset cleared.");
    } catch (error) {
      toast.error(`Failed to clear: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [loading, serializeCurrentBuilder, workspace.id]);

  const handleSaveCurrentLayout = useCallback(async () => {
    if (loading) return;
    setSaving(true);
    try {
      if (!isActiveWorkspace) throw new Error("Switch to this workspace first");
      const serialized =
        useTerminalStore.getState().serializeWorkspaceRuntimeAsStartupPreset(workspace.id);
      if (!serialized) throw new Error("Runtime layout is not available");
      const normalized = await ipc.setWorkspaceStartupPreset(workspace.id, serialized);
      const canonical = normalizePresetDraft(normalized);
      setSavedPreset(canonical);
      setBuilderDraft(canonical);
      setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
      useTerminalStore.getState().setWorkspaceStartupPresetState(workspace.id, canonical);
      toast.success("Current layout saved as startup preset.");
    } catch (error) {
      toast.error(`Failed to save layout: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  }, [advancedFormat, isActiveWorkspace, loading, serializeCurrentBuilder, workspace.id]);

  const performApply = useCallback(
    async (removeWorktrees: boolean) => {
      if (!pendingApplyPreset || applyInFlightRef.current || loading) return;
      applyInFlightRef.current = true;
      setSaving(true);
      try {
        const normalized = await resolveCurrentPreset();
        const applied = await useTerminalStore
          .getState()
          .applyWorkspaceStartupPresetNow(workspace.id, normalized, { removeWorktrees });
        if (!applied) throw new Error("The preset could not be applied");
        setPendingApplyPreset(null);
        const canonical = normalizePresetDraft(normalized);
        setBuilderDraft(canonical);
        setAdvancedDraft(await serializeCurrentBuilder(advancedFormat, canonical));
        await refreshLiveSessionCount();
        toast.success("Startup preset applied.");
      } catch (error) {
        toast.error(`Failed to apply: ${String(error)}`);
      } finally {
        applyInFlightRef.current = false;
        setSaving(false);
      }
    },
    [
      advancedFormat,
      loading,
      pendingApplyPreset,
      refreshLiveSessionCount,
      resolveCurrentPreset,
      serializeCurrentBuilder,
      workspace.id,
    ],
  );

  const handleApplyNow = useCallback(async () => {
    if (applyInFlightRef.current || loading) return;
    applyInFlightRef.current = true;
    setSaving(true);
    try {
      if (!isActiveWorkspace) throw new Error("Switch to this workspace first");
      const normalized = await resolveCurrentPreset();
      const count = await refreshLiveSessionCount();
      if (count > 0) {
        setPendingApplyPreset(normalizePresetDraft(normalized));
        return;
      }
      const applied = await useTerminalStore
        .getState()
        .applyWorkspaceStartupPresetNow(workspace.id, normalized);
      if (!applied) throw new Error("The preset could not be applied");
      await refreshLiveSessionCount();
      toast.success("Startup preset applied.");
    } catch (error) {
      toast.error(`Failed to apply: ${String(error)}`);
    } finally {
      applyInFlightRef.current = false;
      setSaving(false);
    }
  }, [isActiveWorkspace, loading, refreshLiveSessionCount, resolveCurrentPreset, workspace.id]);

  const handleImport = useCallback(async () => {
    if (loading) return;
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const selected = await openDialog({
        multiple: false,
        title: "Import startup preset",
        filters: [
          { name: "Preset files", extensions: ["json", "toml"] },
          { name: "JSON", extensions: ["json"] },
          { name: "TOML", extensions: ["toml"] },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      const format = fileFormatFromPath(selected);
      const raw = await readTextFile(selected);
      const normalized = await ipc.normalizeWorkspaceStartupPresetRaw(workspace.id, format, raw);
      setBuilderDraft(normalizePresetDraft(normalized));
      setAdvancedFormat(format);
      setAdvancedDraft(raw);
      toast.success("Preset imported.");
    } catch (error) {
      toast.error(`Import failed: ${String(error)}`);
    }
  }, [loading, workspace.id]);

  const handleExport = useCallback(async () => {
    if (loading) return;
    try {
      const format = advancedFormat;
      const normalized = await resolveCurrentPreset();
      const raw = await serializeCurrentBuilder(format, normalized);
      const { save } = await import("@tauri-apps/plugin-dialog");
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const target = await save({
        title: "Export startup preset",
        defaultPath: defaultExportFilename(workspace, format),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!target) return;
      await writeTextFile(target, raw);
      toast.success("Preset exported.");
    } catch (error) {
      toast.error(`Export failed: ${String(error)}`);
    }
  }, [advancedFormat, loading, resolveCurrentPreset, serializeCurrentBuilder, workspace]);

  /* ── Render ── */

  if (loading) {
    return (
      <div className="wss-empty">
        <span style={{ color: "var(--text-3)" }}>Loading startup preset...</span>
      </div>
    );
  }

  const harnessOptions = [
    { value: "", label: "No agent" },
    ...installedHarnesses.map((h) => ({ value: h.id, label: h.name })),
  ];

  function paneLabel(session: WorkspaceStartupSession, index: number): string {
    if (session.title) return session.title;
    const agent = installedHarnesses.find((h) => h.id === session.harnessId);
    if (agent) return agent.name;
    return `Shell ${index + 1}`;
  }

  return (
    <div className="wss">
      {/* ── Snapshot CTA ── */}
      <div className="wss-snapshot">
        <div className="wss-snapshot-text">
          <div className="wss-snapshot-title">Quick setup</div>
          <div className="wss-snapshot-desc">
            Save your current terminal layout as the default for this workspace.
          </div>
        </div>
        <button
          type="button"
          className="ws-prop-btn ws-prop-btn-accent"
          onClick={() => void handleSaveCurrentLayout()}
          disabled={controlsDisabled || !isActiveWorkspace}
          title={isActiveWorkspace ? undefined : "Switch to this workspace first"}
        >
          <Camera size={11} />
          Snapshot layout
        </button>
      </div>

      {/* ── Default view ── */}
      <div className="wsp-section">
        <div className="wsp-section-label">When opening</div>
        <div className="wsp-card">
          <div className="wsp-field">
            <span className="wsp-field-label">Start in</span>
            <Dropdown
              value={builderDraft.defaultView}
              options={VIEW_OPTIONS.map((v) => ({
                value: v,
                label: v.charAt(0).toUpperCase() + v.slice(1),
              }))}
              triggerStyle={{ borderRadius: "var(--radius-sm)", minWidth: 120 }}
              onChange={(v) => handleDefaultViewChange(v as WorkspaceDefaultView)}
            />
          </div>
          {(builderDraft.defaultView === "split" || builderDraft.defaultView === "terminal") && (
            <>
              <div className="wsp-field-divider" />
              <div className="wsp-field">
                <span className="wsp-field-label">Terminal size</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    className="ws-depth-input"
                    type="number"
                    min={15}
                    max={72}
                    value={builderDraft.splitPanelSize ?? DEFAULT_SPLIT_PANEL_SIZE}
                    onChange={(e) =>
                      updateDraft((c) => ({ ...c, splitPanelSize: Number(e.target.value) }))
                    }
                  />
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>%</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Terminal tabs builder ── */}
      <div className="wsp-section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="wsp-section-label">Terminal tabs</div>
            <div className="wss-hint">
              Created automatically when no terminals are running.
            </div>
          </div>
          <button
            type="button"
            className="ws-prop-btn"
            onClick={addGroup}
            disabled={controlsDisabled}
          >
            <Plus size={11} />
            Add tab
          </button>
        </div>

        {!terminalDraft || terminalDraft.groups.length === 0 ? (
          <div className="wss-empty">
            <p>No terminal tabs configured yet.</p>
            <button
              type="button"
              className="ws-prop-btn ws-prop-btn-accent"
              onClick={ensureTerminal}
            >
              <Plus size={11} />
              Add first tab
            </button>
          </div>
        ) : (
          <div className="wss-tabs">
            {terminalDraft.groups.map((group, gi) => {
              const tabExpanded = expandedTabs[group.id] ?? false;
              const worktree: WorkspaceStartupWorktreeConfig = group.worktree ?? {
                enabled: false,
                repoMode: "active_repo",
                repoPath: null,
                baseBranch: null,
                baseDir: null,
                branchPrefix: null,
              };

              return (
                <div key={group.id} className="wss-tab">
                  {/* Tab header */}
                  <div className="wss-tab-header">
                    <span className="wss-tab-index">{gi + 1}</span>
                    <input
                      className="wss-tab-name"
                      value={group.name}
                      onChange={(e) =>
                        updateGroup(group.id, (g) => ({ ...g, name: e.target.value }))
                      }
                      placeholder={`Tab ${gi + 1}`}
                    />
                    <button
                      type="button"
                      className="wss-icon-btn"
                      onClick={() =>
                        setExpandedTabs((p) => ({ ...p, [group.id]: !p[group.id] }))
                      }
                      title="Tab settings"
                    >
                      <Settings size={11} />
                    </button>
                    <button
                      type="button"
                      className="wss-icon-btn wss-icon-btn-danger"
                      onClick={() => removeGroup(group.id)}
                      title="Remove tab"
                    >
                      <X size={11} />
                    </button>
                  </div>

                  {/* Tab advanced settings (collapsed) */}
                  {tabExpanded && (
                    <div className="wss-tab-settings">
                      <label className="wss-check">
                        <input
                          type="checkbox"
                          checked={Boolean(group.broadcastOnStart)}
                          onChange={(e) =>
                            updateDraft((c) => {
                              if (!c.terminal) return c;
                              return {
                                ...c,
                                terminal: {
                                  ...c.terminal,
                                  groups: c.terminal.groups.map((g) => ({
                                    ...g,
                                    broadcastOnStart:
                                      g.id === group.id ? e.target.checked : false,
                                  })),
                                },
                              };
                            })
                          }
                        />
                        <span>Broadcast input to all panes</span>
                      </label>
                      <div className="wss-wt-section">
                        <label className="wss-check">
                          <input
                            type="checkbox"
                            checked={worktree.enabled}
                            onChange={(e) =>
                              updateGroup(group.id, (g) => ({
                                ...g,
                                worktree: e.target.checked
                                  ? {
                                      enabled: true,
                                      repoMode: g.worktree?.repoMode ?? "active_repo",
                                      repoPath: g.worktree?.repoPath ?? null,
                                      baseBranch: g.worktree?.baseBranch ?? null,
                                      baseDir: g.worktree?.baseDir ?? ".panes/worktrees",
                                      branchPrefix: g.worktree?.branchPrefix ?? "panes/preset",
                                    }
                                  : null,
                              }))
                            }
                          />
                          <span>Create git worktree per pane</span>
                        </label>
                        {worktree.enabled && (
                          <div className="wss-wt-fields">
                            <div className="wss-wt-row">
                              <span className="wss-wt-label">Repo</span>
                              <Dropdown
                                value={worktree.repoMode}
                                options={[
                                  { value: "active_repo", label: "Active repo" },
                                  { value: "fixed_repo", label: "Fixed repo" },
                                ]}
                                triggerStyle={{
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: 11,
                                  padding: "2px 6px",
                                }}
                                onChange={(v) =>
                                  updateGroup(group.id, (g) => ({
                                    ...g,
                                    worktree: {
                                      ...(g.worktree ?? worktree),
                                      enabled: true,
                                      repoMode: v as "active_repo" | "fixed_repo",
                                    },
                                  }))
                                }
                              />
                            </div>
                            {worktree.repoMode === "fixed_repo" && (
                              <div className="wss-wt-row">
                                <span className="wss-wt-label">Path</span>
                                <input
                                  className="wss-input"
                                  value={worktree.repoPath ?? ""}
                                  onChange={(e) =>
                                    updateGroup(group.id, (g) => ({
                                      ...g,
                                      worktree: {
                                        ...(g.worktree ?? worktree),
                                        enabled: true,
                                        repoMode: "fixed_repo",
                                        repoPath: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder="."
                                />
                              </div>
                            )}
                            <div className="wss-wt-row">
                              <span className="wss-wt-label">Branch</span>
                              <input
                                className="wss-input"
                                value={worktree.baseBranch ?? ""}
                                onChange={(e) =>
                                  updateGroup(group.id, (g) => ({
                                    ...g,
                                    worktree: {
                                      ...(g.worktree ?? worktree),
                                      enabled: true,
                                      baseBranch: e.target.value || null,
                                    },
                                  }))
                                }
                                placeholder="main"
                              />
                            </div>
                            <div className="wss-wt-row">
                              <span className="wss-wt-label">Directory</span>
                              <input
                                className="wss-input"
                                value={worktree.baseDir ?? ""}
                                onChange={(e) =>
                                  updateGroup(group.id, (g) => ({
                                    ...g,
                                    worktree: {
                                      ...(g.worktree ?? worktree),
                                      enabled: true,
                                      baseDir: e.target.value || null,
                                    },
                                  }))
                                }
                                placeholder=".panes/worktrees"
                              />
                            </div>
                            <div className="wss-wt-row">
                              <span className="wss-wt-label">Prefix</span>
                              <input
                                className="wss-input"
                                value={worktree.branchPrefix ?? ""}
                                onChange={(e) =>
                                  updateGroup(group.id, (g) => ({
                                    ...g,
                                    worktree: {
                                      ...(g.worktree ?? worktree),
                                      enabled: true,
                                      branchPrefix: e.target.value || null,
                                    },
                                  }))
                                }
                                placeholder="panes/preset"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Panes */}
                  <div className="wss-panes">
                    {group.sessions.map((session, si) => {
                      const paneExpanded = expandedPanes[session.id] ?? false;

                      return (
                        <div key={session.id} className="wss-pane">
                          {/* Compact pane row */}
                          <div className="wss-pane-row">
                            <Dropdown
                              value={session.harnessId ?? ""}
                              options={harnessOptions}
                              triggerStyle={{
                                borderRadius: "var(--radius-sm)",
                                fontSize: 11,
                                padding: "2px 6px",
                                minWidth: 100,
                              }}
                              onChange={(v) =>
                                updateSession(group.id, session.id, (s) => ({
                                  ...s,
                                  harnessId: v || null,
                                  launchHarnessOnCreate: v
                                    ? (s.launchHarnessOnCreate ?? true)
                                    : false,
                                }))
                              }
                            />
                            <span className="wss-pane-at">in</span>
                            <input
                              className="wss-input wss-pane-dir"
                              value={session.cwd}
                              onChange={(e) =>
                                updateSession(group.id, session.id, (s) => ({
                                  ...s,
                                  cwd: e.target.value,
                                }))
                              }
                              placeholder="."
                              title={`Working directory for ${paneLabel(session, si)}`}
                            />
                            <button
                              type="button"
                              className={`wss-icon-btn ${paneExpanded ? "wss-icon-btn-active" : ""}`}
                              onClick={() =>
                                setExpandedPanes((p) => ({ ...p, [session.id]: !p[session.id] }))
                              }
                              title="More options"
                            >
                              <Settings size={10} />
                            </button>
                            <button
                              type="button"
                              className="wss-icon-btn wss-icon-btn-danger"
                              onClick={() => removeSession(group.id, session.id)}
                              disabled={group.sessions.length === 1}
                              title="Remove pane"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>

                          {/* Expanded pane details */}
                          {paneExpanded && (
                            <div className="wss-pane-details">
                              <div className="wss-detail-row">
                                <span className="wss-detail-label">Title</span>
                                <input
                                  className="wss-input"
                                  value={session.title ?? ""}
                                  onChange={(e) =>
                                    updateSession(group.id, session.id, (s) => ({
                                      ...s,
                                      title: e.target.value || null,
                                    }))
                                  }
                                  placeholder={paneLabel(session, si)}
                                />
                              </div>
                              <div className="wss-detail-row">
                                <span className="wss-detail-label">Path relative to</span>
                                <Dropdown
                                  value={session.cwdBase ?? "workspace"}
                                  options={PATH_BASE_OPTIONS.map((p) => ({
                                    value: p,
                                    label: p.charAt(0).toUpperCase() + p.slice(1),
                                  }))}
                                  triggerStyle={{
                                    borderRadius: "var(--radius-sm)",
                                    fontSize: 11,
                                    padding: "2px 6px",
                                  }}
                                  onChange={(v) =>
                                    updateSession(group.id, session.id, (s) => ({
                                      ...s,
                                      cwdBase: v as WorkspacePathBase,
                                    }))
                                  }
                                />
                              </div>
                              {session.harnessId && (
                                <label className="wss-check">
                                  <input
                                    type="checkbox"
                                    checked={
                                      session.launchHarnessOnCreate ?? Boolean(session.harnessId)
                                    }
                                    onChange={(e) =>
                                      updateSession(group.id, session.id, (s) => ({
                                        ...s,
                                        launchHarnessOnCreate: e.target.checked,
                                      }))
                                    }
                                  />
                                  <span>Auto-launch agent on startup</span>
                                </label>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="wss-add-pane"
                      onClick={() => addSession(group.id)}
                    >
                      <Plus size={10} />
                      Add pane
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Advanced / Import-Export ── */}
      <div className="wsp-section">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="wss-disclosure"
            onClick={() => void handleToggleAdvanced()}
            disabled={controlsDisabled}
          >
            {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Edit as {advancedFormat.toUpperCase()}
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="ws-prop-btn"
            onClick={() => void handleImport()}
            disabled={controlsDisabled}
          >
            <Upload size={11} />
            Import
          </button>
          <button
            type="button"
            className="ws-prop-btn"
            onClick={() => void handleExport()}
            disabled={controlsDisabled}
          >
            <Download size={11} />
            Export
          </button>
        </div>
        {advancedOpen && (
          <div className="wss-advanced">
            <div style={{ marginBottom: 6 }}>
              <Dropdown
                value={advancedFormat}
                options={[
                  { value: "json", label: "JSON" },
                  { value: "toml", label: "TOML" },
                ]}
                disabled={controlsDisabled}
                triggerStyle={{ borderRadius: "var(--radius-sm)", minWidth: 72, fontSize: 11 }}
                onChange={(v) =>
                  void handleAdvancedFormatChange(v as WorkspaceStartupPresetFormat)
                }
              />
            </div>
            <textarea
              className="wss-editor"
              value={advancedDraft}
              disabled={saving}
              onChange={(e) => setAdvancedDraft(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* ── Footer / Apply confirmation ── */}
      {pendingApplyPreset ? (
        <div className="wss-confirm">
          <div>
            <strong>Replace current terminal sessions?</strong>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-3)" }}>
              All running terminals will be closed.
              {hasWorktrees ? " You can choose to keep or remove existing worktrees." : ""}
            </p>
          </div>
          <div className="wss-confirm-actions">
            <button
              type="button"
              className="ws-prop-btn"
              onClick={() => setPendingApplyPreset(null)}
              disabled={saving}
            >
              Cancel
            </button>
            {hasWorktrees ? (
              <>
                <button
                  type="button"
                  className="ws-prop-btn"
                  onClick={() => void performApply(false)}
                  disabled={saving}
                >
                  Keep worktrees
                </button>
                <button
                  type="button"
                  className="ws-prop-btn wss-danger-btn"
                  onClick={() => void performApply(true)}
                  disabled={saving}
                >
                  Remove worktrees
                </button>
              </>
            ) : (
              <button
                type="button"
                className="ws-prop-btn ws-prop-btn-accent"
                onClick={() => void performApply(false)}
                disabled={saving}
              >
                Replace
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="wss-footer">
          <div className="wss-footer-status">
            {savedPreset ? "Preset saved" : "Using defaults"}
            {liveSessionCount > 0 && ` \u00b7 ${liveSessionCount} running`}
          </div>
          <div className="wss-footer-actions">
            {savedPreset && (
              <button
                type="button"
                className="ws-prop-btn"
                onClick={() => void handleClear()}
                disabled={controlsDisabled}
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="ws-prop-btn"
              onClick={() => void handleApplyNow()}
              disabled={controlsDisabled || !isActiveWorkspace}
              title={isActiveWorkspace ? "Apply preset to running workspace" : "Switch to this workspace first"}
            >
              <Play size={10} />
              Apply now
            </button>
            <button
              type="button"
              className="ws-prop-btn ws-prop-btn-accent"
              onClick={() => void handleSave()}
              disabled={controlsDisabled}
            >
              <Save size={10} />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
