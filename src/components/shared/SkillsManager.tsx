import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Pencil,
  Save,
  Trash2,
  Copy,
  Globe,
  FolderGit2,
  ChevronDown,
  ChevronRight,
  Zap,
  Search,
  Check,
} from "lucide-react";
import { useSkillStore } from "../../stores/skillStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { LLMProvider, Skill } from "../../types";

// ── Provider config ─────────────────────────────────────────────────

const PROVIDER_OPTIONS: { value: LLMProvider | ""; label: string }[] = [
  { value: "", label: "Any provider" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "OpenAI Codex" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "cursor", label: "Cursor" },
  { value: "gemini", label: "Gemini" },
  { value: "cline", label: "Cline" },
  { value: "windsurf", label: "Windsurf" },
];

const PROVIDER_COLORS: Record<string, string> = {
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

export function SkillsManager() {
  const panelOpen = useSkillStore((s) => s.panelOpen);
  const closePanel = useSkillStore((s) => s.closePanel);

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
        className="ctx-panel ctx-panel-wide"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <SkillsPanelContent />
      </div>
    </div>,
    document.body,
  );
}

// ── Panel Content ───────────────────────────────────────────────────

function SkillsPanelContent() {
  const closePanel = useSkillStore((s) => s.closePanel);
  const skills = useSkillStore((s) => s.skills);
  const activeSkillId = useSkillStore((s) => s.activeSkillId);
  const setActiveSkill = useSkillStore((s) => s.setActiveSkill);
  const createSkill = useSkillStore((s) => s.createSkill);

  const [searchQuery, setSearchQuery] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
    );
  }, [skills, searchQuery]);

  const activeSkill = skills.find((s) => s.id === activeSkillId);

  const handleCreate = useCallback(() => {
    createSkill({
      name: "New Skill",
      description: "",
      content: "# Skill Instructions\n\nDescribe what this skill does.\n",
      global: true,
    });
  }, [createSkill]);

  // Show editor if a skill is selected
  if (activeSkill) {
    return <SkillEditor skill={activeSkill} onBack={() => setActiveSkill(null)} />;
  }

  return (
    <>
      {/* Header */}
      <div className="ctx-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} style={{ color: "var(--accent)" }} />
          <h2 className="ctx-title">Skills</h2>
          <span className="ctx-count-badge">{skills.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            className="ctx-create-skill-btn"
            onClick={handleCreate}
          >
            <Plus size={13} />
            New skill
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

      {/* Search bar */}
      {skills.length > 3 && (
        <div className="ctx-search-bar">
          <Search size={13} style={{ opacity: 0.4, flexShrink: 0 }} />
          <input
            className="ctx-search-input"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {/* Body */}
      <div className="ctx-body">
        {filtered.length === 0 ? (
          <div className="ctx-empty">
            <div className="ctx-empty-icon-box">
              <Zap size={22} style={{ opacity: 0.4 }} />
            </div>
            <p className="ctx-empty-title">
              {skills.length === 0 ? "No skills yet" : "No matching skills"}
            </p>
            <p className="ctx-empty-text">
              {skills.length === 0
                ? "Create reusable instruction sets that can be shared across your workspaces."
                : "Try a different search term."}
            </p>
            {skills.length === 0 && (
              <button
                type="button"
                className="ctx-create-skill-btn"
                style={{ marginTop: 8 }}
                onClick={handleCreate}
              >
                <Plus size={13} />
                Create your first skill
              </button>
            )}
          </div>
        ) : (
          <div className="skill-list">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onClick={() => setActiveSkill(skill.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Skill Card ──────────────────────────────────────────────────────

function SkillCard({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const duplicateSkill = useSkillStore((s) => s.duplicateSkill);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const providerColor = skill.provider ? PROVIDER_COLORS[skill.provider] ?? "var(--text-3)" : "var(--text-3)";

  const scopeLabel = skill.global
    ? "All workspaces"
    : skill.workspaceIds.length === 0
      ? "No workspaces"
      : `${skill.workspaceIds.length} workspace${skill.workspaceIds.length > 1 ? "s" : ""}`;

  const wsNames = skill.global
    ? null
    : skill.workspaceIds
        .map((id) => workspaces.find((w) => w.id === id)?.name ?? "?")
        .join(", ");

  return (
    <div className="skill-card" onClick={onClick}>
      <div className="skill-card-header">
        <Zap size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span className="skill-card-name">{skill.name}</span>
        {skill.provider && (
          <span
            className="ctx-meta-tag"
            style={{ borderColor: `${providerColor}33`, color: providerColor }}
          >
            {skill.provider}
          </span>
        )}
        <div className="skill-card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="ctx-icon-btn"
            title="Duplicate"
            onClick={() => duplicateSkill(skill.id)}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="ctx-icon-btn ctx-icon-btn-danger"
            title="Delete"
            onClick={() => deleteSkill(skill.id)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {skill.description && (
        <p className="skill-card-desc">{skill.description}</p>
      )}
      <div className="skill-card-scope">
        {skill.global ? (
          <Globe size={11} style={{ opacity: 0.5 }} />
        ) : (
          <FolderGit2 size={11} style={{ opacity: 0.5 }} />
        )}
        <span>{scopeLabel}</span>
        {wsNames && (
          <span className="skill-card-ws-names" title={wsNames}>
            {wsNames}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Skill Editor ────────────────────────────────────────────────────

function SkillEditor({ skill, onBack }: { skill: Skill; onBack: () => void }) {
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description);
  const [content, setContent] = useState(skill.content);
  const [provider, setProvider] = useState<LLMProvider | "">(skill.provider ?? "");
  const [isGlobal, setIsGlobal] = useState(skill.global);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(
    new Set(skill.workspaceIds),
  );
  const [wsPickerOpen, setWsPickerOpen] = useState(false);

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const isDirty =
    name !== skill.name ||
    description !== skill.description ||
    content !== skill.content ||
    (provider || undefined) !== skill.provider ||
    isGlobal !== skill.global ||
    !setsEqual(selectedWorkspaces, new Set(skill.workspaceIds));

  const handleSave = () => {
    updateSkill(skill.id, {
      name,
      description,
      content,
      provider: provider || undefined,
      global: isGlobal,
      workspaceIds: isGlobal ? [] : Array.from(selectedWorkspaces),
    });
    onBack();
  };

  const toggleWs = (wsId: string) => {
    setSelectedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) {
        next.delete(wsId);
      } else {
        next.add(wsId);
      }
      return next;
    });
  };

  return (
    <>
      {/* Header */}
      <div className="ctx-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button type="button" className="ctx-icon-btn" onClick={onBack} title="Back">
            <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
          <Pencil size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Edit Skill</span>
        </div>
        <button
          type="button"
          className="ctx-save-btn"
          onClick={handleSave}
          disabled={!isDirty || !name.trim()}
        >
          <Save size={12} />
          Save
        </button>
      </div>

      {/* Editor body */}
      <div className="ctx-body" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Name */}
        <div className="skill-field">
          <label className="skill-field-label">Name</label>
          <input
            className="skill-field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill name"
          />
        </div>

        {/* Description */}
        <div className="skill-field">
          <label className="skill-field-label">Description</label>
          <input
            className="skill-field-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description (optional)"
          />
        </div>

        {/* Provider */}
        <div className="skill-field">
          <label className="skill-field-label">Provider</label>
          <select
            className="ctx-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LLMProvider | "")}
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Scope */}
        <div className="skill-field">
          <label className="skill-field-label">Workspace Scope</label>
          <div className="skill-scope-toggle">
            <button
              type="button"
              className={`skill-scope-btn ${isGlobal ? "skill-scope-btn-active" : ""}`}
              onClick={() => setIsGlobal(true)}
            >
              <Globe size={12} />
              All workspaces
            </button>
            <button
              type="button"
              className={`skill-scope-btn ${!isGlobal ? "skill-scope-btn-active" : ""}`}
              onClick={() => setIsGlobal(false)}
            >
              <FolderGit2 size={12} />
              Selected only
            </button>
          </div>

          {!isGlobal && (
            <div className="skill-ws-picker">
              <button
                type="button"
                className="skill-ws-picker-toggle"
                onClick={() => setWsPickerOpen(!wsPickerOpen)}
              >
                <span>
                  {selectedWorkspaces.size === 0
                    ? "Select workspaces..."
                    : `${selectedWorkspaces.size} selected`}
                </span>
                {wsPickerOpen ? (
                  <ChevronDown size={12} style={{ opacity: 0.5 }} />
                ) : (
                  <ChevronRight size={12} style={{ opacity: 0.5 }} />
                )}
              </button>

              {wsPickerOpen && (
                <div className="skill-ws-list">
                  {workspaces.map((ws) => {
                    const checked = selectedWorkspaces.has(ws.id);
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        className={`skill-ws-item ${checked ? "skill-ws-item-active" : ""}`}
                        onClick={() => toggleWs(ws.id)}
                      >
                        <span className="skill-ws-check">
                          {checked && <Check size={12} style={{ color: "var(--accent)" }} />}
                        </span>
                        <FolderGit2 size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                        <span className="skill-ws-name">
                          {ws.name || ws.rootPath.split("/").pop() || "Workspace"}
                        </span>
                      </button>
                    );
                  })}
                  {workspaces.length === 0 && (
                    <p style={{ fontSize: 11, color: "var(--text-3)", padding: 8, margin: 0 }}>
                      No workspaces available.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content editor */}
        <div className="skill-field" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <label className="skill-field-label">Instructions</label>
          <textarea
            ref={contentRef}
            className="skill-content-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write the skill instructions in markdown..."
            spellCheck={false}
          />
        </div>
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}
