import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  FileText,
  Search,
  RefreshCw,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  Pencil,
  Save,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { useContextStore, CONTEXT_FILE_TEMPLATES } from "../../stores/contextStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { LLMContextFile, LLMProvider, Repo } from "../../types";

// ── Provider icon colors ────────────────────────────────────────────

const PROVIDER_COLORS: Record<LLMProvider, string> = {
  claude: "#d4a574",
  codex: "#7ee787",
  copilot: "#79c0ff",
  cursor: "#a78bfa",
  gemini: "#60a5fa",
  cline: "#fbbf24",
  windsurf: "#34d399",
  generic: "#737373",
};

// ── Main Component ──────────────────────────────────────────────────

export function LLMContextPanel() {
  const panelOpen = useContextStore((s) => s.panelOpen);
  const closePanel = useContextStore((s) => s.closePanel);

  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closePanel();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panelOpen, closePanel]);

  if (!panelOpen) return null;

  return createPortal(
    <div className="ctx-backdrop" onMouseDown={closePanel}>
      <div
        className="ctx-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <PanelContent />
      </div>
    </div>,
    document.body,
  );
}

// ── Panel Content ───────────────────────────────────────────────────

function PanelContent() {
  const closePanel = useContextStore((s) => s.closePanel);
  const scanWorkspace = useContextStore((s) => s.scanWorkspace);
  const filesByWorkspace = useContextStore((s) => s.filesByWorkspace);
  const scanning = useContextStore((s) => s.scanning);
  const activeFile = useContextStore((s) => s.activeFile);
  const setActiveFile = useContextStore((s) => s.setActiveFile);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const repos = useWorkspaceStore((s) => s.repos);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
  const files = activeWorkspaceId ? filesByWorkspace[activeWorkspaceId] ?? [] : [];
  const isScanning = activeWorkspaceId ? scanning[activeWorkspaceId] ?? false : false;

  // Auto-scan on first open
  useEffect(() => {
    if (activeWorkspaceId && !filesByWorkspace[activeWorkspaceId] && repos.length > 0) {
      void scanWorkspace(activeWorkspaceId, repos);
    }
  }, [activeWorkspaceId, filesByWorkspace, repos, scanWorkspace]);

  const handleRescan = useCallback(() => {
    if (activeWorkspaceId && repos.length > 0) {
      void scanWorkspace(activeWorkspaceId, repos);
    }
  }, [activeWorkspaceId, repos, scanWorkspace]);

  // Group files by provider
  const grouped = useMemo(() => {
    const map = new Map<LLMProvider, LLMContextFile[]>();
    for (const file of files) {
      const list = map.get(file.provider) ?? [];
      list.push(file);
      map.set(file.provider, list);
    }
    return map;
  }, [files]);

  // If viewing/editing a file
  if (activeFile) {
    return <FileViewer file={activeFile} onBack={() => setActiveFile(null)} />;
  }

  return (
    <>
      {/* Header */}
      <div className="ctx-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} style={{ color: "var(--accent)" }} />
          <h2 className="ctx-title">LLM Context Files</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="ctx-icon-btn"
            onClick={handleRescan}
            disabled={isScanning}
            title="Rescan workspace"
          >
            <RefreshCw size={14} className={isScanning ? "git-spin" : ""} />
          </button>
          <button
            type="button"
            className="ctx-icon-btn"
            onClick={closePanel}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Workspace indicator */}
      {activeWorkspace && (
        <div className="ctx-workspace-bar">
          <Search size={11} style={{ opacity: 0.5 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeWorkspace.name || activeWorkspace.rootPath.split("/").pop()}
          </span>
          <span className="ctx-count-badge">{files.length} found</span>
        </div>
      )}

      {/* Body */}
      <div className="ctx-body">
        {isScanning ? (
          <div className="ctx-empty">
            <RefreshCw size={20} className="git-spin" style={{ color: "var(--accent)", opacity: 0.6 }} />
            <p className="ctx-empty-text">Scanning for LLM context files...</p>
          </div>
        ) : files.length === 0 ? (
          <div className="ctx-empty">
            <div className="ctx-empty-icon-box">
              <FileText size={22} style={{ opacity: 0.4 }} />
            </div>
            <p className="ctx-empty-title">No context files detected</p>
            <p className="ctx-empty-text">
              Create context files to provide instructions to AI tools like Claude, Copilot, Cursor, and others.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {Array.from(grouped.entries()).map(([provider, providerFiles]) => (
              <ProviderGroup
                key={provider}
                provider={provider}
                files={providerFiles}
                onSelect={setActiveFile}
              />
            ))}
          </div>
        )}

        {/* Create new section */}
        <CreateSection repos={repos} existingFiles={files} />
      </div>
    </>
  );
}

// ── Provider Group ──────────────────────────────────────────────────

function ProviderGroup({
  provider,
  files,
  onSelect,
}: {
  provider: LLMProvider;
  files: LLMContextFile[];
  onSelect: (file: LLMContextFile) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const color = PROVIDER_COLORS[provider];

  return (
    <div className="ctx-provider-group">
      <button
        type="button"
        className="ctx-provider-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight size={12} style={{ opacity: 0.4 }} />
        ) : (
          <ChevronDown size={12} style={{ opacity: 0.4 }} />
        )}
        <span
          className="ctx-provider-dot"
          style={{ background: color }}
        />
        <span className="ctx-provider-label">{files[0]?.providerLabel ?? provider}</span>
        <span className="ctx-provider-count">{files.length}</span>
      </button>

      {!collapsed &&
        files.map((file) => (
          <button
            key={file.id}
            type="button"
            className="ctx-file-row"
            onClick={() => onSelect(file)}
          >
            <FileText size={13} style={{ color, flexShrink: 0, opacity: 0.7 }} />
            <span className="ctx-file-name">{file.relativePath}</span>
            <span className="ctx-file-repo">{file.repoName}</span>
            {file.sizeBytes !== undefined && (
              <span className="ctx-file-size">
                {file.sizeBytes < 1024
                  ? `${file.sizeBytes}B`
                  : `${(file.sizeBytes / 1024).toFixed(1)}KB`}
              </span>
            )}
            <Eye size={12} style={{ color: "var(--text-3)", flexShrink: 0, opacity: 0 }} className="ctx-file-eye" />
          </button>
        ))}
    </div>
  );
}

// ── File Viewer/Editor ──────────────────────────────────────────────

function FileViewer({
  file,
  onBack,
}: {
  file: LLMContextFile;
  onBack: () => void;
}) {
  const saveFileContent = useContextStore((s) => s.saveFileContent);
  const loadFileContent = useContextStore((s) => s.loadFileContent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(file.content ?? "");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const color = PROVIDER_COLORS[file.provider];

  useEffect(() => {
    if (!file.content) {
      void loadFileContent(file);
    }
  }, [file, loadFileContent]);

  useEffect(() => {
    setDraft(file.content ?? "");
  }, [file.content]);

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus();
    }
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveFileContent(file, draft);
      setEditing(false);
    } catch {
      // error handled in store
    }
    setSaving(false);
  };

  const isDirty = draft !== (file.content ?? "");

  return (
    <>
      {/* Header */}
      <div className="ctx-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button type="button" className="ctx-icon-btn" onClick={onBack} title="Back">
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <span className="ctx-provider-dot" style={{ background: color }} />
          <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.fileName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {editing ? (
            <button
              type="button"
              className="ctx-save-btn"
              onClick={() => void handleSave()}
              disabled={saving || !isDirty}
            >
              <Save size={12} />
              {saving ? "Saving..." : "Save"}
            </button>
          ) : (
            <button
              type="button"
              className="ctx-icon-btn"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {editing && (
            <button
              type="button"
              className="ctx-icon-btn"
              onClick={() => {
                setDraft(file.content ?? "");
                setEditing(false);
              }}
              title="Cancel editing"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Meta bar */}
      <div className="ctx-meta-bar">
        <span className="ctx-meta-tag" style={{ borderColor: `${color}33`, color }}>
          {file.providerLabel}
        </span>
        <ExternalLink size={10} style={{ opacity: 0.4 }} />
        <span style={{ opacity: 0.5, fontSize: 11 }}>{file.relativePath}</span>
        <span style={{ marginLeft: "auto", opacity: 0.4 }}>{file.repoName}</span>
      </div>

      {/* Content */}
      <div className="ctx-viewer-body">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="ctx-editor-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="ctx-viewer-pre">{file.content ?? "Loading..."}</pre>
        )}
      </div>
    </>
  );
}

// ── Create Section ──────────────────────────────────────────────────

function CreateSection({
  repos,
  existingFiles,
}: {
  repos: Repo[];
  existingFiles: LLMContextFile[];
}) {
  const createContextFile = useContextStore((s) => s.createContextFile);
  const setActiveFile = useContextStore((s) => s.setActiveFile);
  const [open, setOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(repos[0] ?? null);

  // Filter templates that don't already exist in the selected repo
  const availableTemplates = useMemo(() => {
    if (!selectedRepo) return CONTEXT_FILE_TEMPLATES;
    return CONTEXT_FILE_TEMPLATES.filter(
      (t) =>
        !existingFiles.some(
          (f) => f.repoId === selectedRepo.id && f.relativePath === t.relativePath,
        ),
    );
  }, [selectedRepo, existingFiles]);

  const handleCreate = async (templateIdx: number) => {
    if (!selectedRepo) return;
    const template = availableTemplates[templateIdx];
    if (!template) return;
    const created = await createContextFile(selectedRepo, template);
    if (created) {
      setActiveFile(created);
    }
  };

  return (
    <div className="ctx-create-section">
      <button
        type="button"
        className="ctx-create-toggle"
        onClick={() => setOpen(!open)}
      >
        <Plus size={13} style={{ color: "var(--accent)" }} />
        <span>Create context file</span>
        {open ? (
          <ChevronDown size={11} style={{ opacity: 0.4, marginLeft: "auto" }} />
        ) : (
          <ChevronRight size={11} style={{ opacity: 0.4, marginLeft: "auto" }} />
        )}
      </button>

      {open && (
        <div className="ctx-create-body">
          {/* Repo selector */}
          {repos.length > 1 && (
            <div className="ctx-create-repo-row">
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>Repository:</span>
              <select
                className="ctx-select"
                value={selectedRepo?.id ?? ""}
                onChange={(e) => {
                  const repo = repos.find((r) => r.id === e.target.value);
                  setSelectedRepo(repo ?? null);
                }}
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Template list */}
          {availableTemplates.length === 0 ? (
            <p style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 0", margin: 0 }}>
              All context file types already exist in this repository.
            </p>
          ) : (
            <div className="ctx-template-grid">
              {availableTemplates.map((template, i) => (
                <button
                  key={template.relativePath}
                  type="button"
                  className="ctx-template-card"
                  onClick={() => void handleCreate(i)}
                >
                  <span
                    className="ctx-provider-dot"
                    style={{ background: PROVIDER_COLORS[template.provider] }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ctx-template-name">{template.fileName}</div>
                    <div className="ctx-template-provider">{template.providerLabel}</div>
                  </div>
                  <Plus size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
