import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Info,
  Play,
  RefreshCw,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { WorkspaceStartupSection } from "./WorkspaceStartupSection";
import type { Repo, TrustLevel } from "../../types";

type Section = "general" | "repos" | "startup";

const MIN_SCAN_DEPTH = 0;
const MAX_SCAN_DEPTH = 12;

const TRUST_OPTIONS = [
  { value: "trusted", label: "Trusted" },
  { value: "standard", label: "Standard" },
  { value: "restricted", label: "Restricted" },
];

export function WorkspaceSettingsPage() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const storeRepos = useWorkspaceStore((s) => s.repos);
  const storeSetTrust = useWorkspaceStore((s) => s.setRepoTrustLevel);
  const storeSetGitActive = useWorkspaceStore((s) => s.setRepoGitActive);
  const storeSetAllTrust = useWorkspaceStore((s) => s.setAllReposTrustLevel);
  const storeRescan = useWorkspaceStore((s) => s.rescanWorkspace);
  const settingsWorkspaceId = useUiStore((s) => s.settingsWorkspaceId);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const workspace = workspaces.find((w) => w.id === settingsWorkspaceId) ?? null;
  const isActive = workspace?.id === activeWorkspaceId;

  const [section, setSection] = useState<Section>("general");
  const [depthDraft, setDepthDraft] = useState("");
  const [depthSaving, setDepthSaving] = useState(false);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [localRepos, setLocalRepos] = useState<Repo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);

  const repos = isActive ? storeRepos : (localRepos ?? []);

  useEffect(() => {
    if (workspace) {
      setDepthDraft(String(workspace.scanDepth));
      setDepthError(null);
    }
  }, [workspace?.id, workspace?.scanDepth]);

  useEffect(() => {
    if (!workspace || isActive) return;
    let cancelled = false;
    setReposLoading(true);
    ipc
      .getRepos(workspace.id)
      .then((r) => { if (!cancelled) setLocalRepos(r); })
      .catch(() => { if (!cancelled) setLocalRepos([]); })
      .finally(() => { if (!cancelled) setReposLoading(false); });
    return () => { cancelled = true; };
  }, [workspace?.id, isActive]);

  const goBack = useCallback(() => setActiveView("chat"), [setActiveView]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") goBack();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [goBack]);

  if (!workspace) {
    return (
      <div className="wsp-root">
        <div className="wsp-scroll">
          <div className="wsp-inner">
            <p style={{ color: "var(--text-3)" }}>Workspace not found.</p>
            <button type="button" className="ws-prop-btn" onClick={goBack}>
              <ArrowLeft size={12} /> Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const name = workspace.name || workspace.rootPath.split("/").pop() || "Workspace";

  async function saveDepth() {
    if (!workspace) return;
    const n = Number.parseInt(depthDraft.trim(), 10);
    if (!Number.isFinite(n) || n < MIN_SCAN_DEPTH || n > MAX_SCAN_DEPTH) {
      setDepthError(`${MIN_SCAN_DEPTH}–${MAX_SCAN_DEPTH}`);
      return;
    }
    setDepthError(null);
    setDepthSaving(true);
    try {
      const updated = await storeRescan(workspace.id, n);
      if (!isActive) setLocalRepos(await ipc.getRepos(workspace.id));
      if (updated) setDepthDraft(String(updated.scanDepth));
      toast.success("Rescanned.");
    } catch {
      toast.error("Failed to update scan depth.");
    } finally {
      setDepthSaving(false);
    }
  }

  async function rescan() {
    if (!workspace) return;
    setDepthSaving(true);
    try {
      await storeRescan(workspace.id);
      if (!isActive) setLocalRepos(await ipc.getRepos(workspace.id));
      toast.success("Repos rescanned.");
    } catch {
      toast.error("Rescan failed.");
    } finally {
      setDepthSaving(false);
    }
  }

  async function setTrust(repoId: string, level: TrustLevel) {
    if (!workspace) return;
    try {
      if (isActive) {
        await storeSetTrust(repoId, level);
      } else {
        await ipc.setRepoTrustLevel(repoId, level);
        setLocalRepos((p) => (p ?? []).map((r) => (r.id === repoId ? { ...r, trustLevel: level } : r)));
      }
    } catch {
      toast.error("Failed to update trust level.");
    }
  }

  async function toggleActive(repoId: string, on: boolean) {
    if (!workspace) return;
    try {
      if (isActive) {
        await storeSetGitActive(repoId, on);
      } else {
        await ipc.setRepoGitActive(repoId, on);
        setLocalRepos((p) => (p ?? []).map((r) => (r.id === repoId ? { ...r, isActive: on } : r)));
      }
    } catch {
      toast.error("Failed to toggle visibility.");
    }
  }

  async function bulkTrust(level: TrustLevel) {
    if (!workspace) return;
    try {
      if (isActive) {
        await storeSetAllTrust(level);
      } else {
        await Promise.all(repos.map((r) => ipc.setRepoTrustLevel(r.id, level)));
        setLocalRepos((p) => (p ?? []).map((r) => ({ ...r, trustLevel: level })));
      }
    } catch {
      toast.error("Failed to update trust levels.");
    }
  }

  function fmtDate(s: string) {
    try {
      return new Date(s).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return s;
    }
  }

  function relPath(p: string) {
    if (p.startsWith(workspace!.rootPath)) {
      const r = p.slice(workspace!.rootPath.length).replace(/^\//, "");
      return r || ".";
    }
    return p;
  }

  async function revealWorkspace() {
    if (!workspace) return;
    try {
      await ipc.revealPath(workspace.rootPath);
    } catch {
      toast.error("Failed to reveal workspace in Finder.");
    }
  }

  return (
    <div className="wsp-root">
      <div className="wsp-scroll">
        <div className="wsp-inner">
          {/* Header */}
          <div className="wsp-header">
            <button type="button" className="wsp-back" onClick={goBack} title="Back">
              <ArrowLeft size={14} />
            </button>
            <div className="wsp-header-icon">
              <FolderGit2 size={18} />
            </div>
            <div className="wsp-header-text">
              <h1 className="wsp-title">{name}</h1>
              <p className="wsp-path">{workspace.rootPath}</p>
            </div>
          </div>

          {/* Nav */}
          <div className="wsp-nav">
            <button
              type="button"
              className={`wsp-nav-item ${section === "general" ? "wsp-nav-active" : ""}`}
              onClick={() => setSection("general")}
            >
              <Info size={13} />
              General
            </button>
            <button
              type="button"
              className={`wsp-nav-item ${section === "repos" ? "wsp-nav-active" : ""}`}
              onClick={() => setSection("repos")}
            >
              <GitBranch size={13} />
              Repositories
              {repos.length > 0 && (
                <span className="wsp-nav-count">{repos.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`wsp-nav-item ${section === "startup" ? "wsp-nav-active" : ""}`}
              onClick={() => setSection("startup")}
            >
              <Play size={13} />
              Startup
            </button>
          </div>

          {/* Content */}
          <div className="wsp-content">
            {section === "general" && (
              <>
                <div className="wsp-section">
                  <div className="wsp-section-label">Workspace</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">Name</span>
                      <span className="wsp-field-value">{name}</span>
                    </div>
                    <div className="wsp-field-divider" />
                    <div className="wsp-field">
                      <span className="wsp-field-label">Path</span>
                      <span className="wsp-field-value wsp-mono" title={workspace.rootPath}>
                        {workspace.rootPath}
                      </span>
                      <button
                        type="button"
                        className="ws-prop-btn"
                        onClick={() => void revealWorkspace()}
                      >
                        <FolderOpen size={11} />
                        Reveal
                      </button>
                    </div>
                  </div>
                </div>

                <div className="wsp-section">
                  <div className="wsp-section-label">Scanning</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">Depth</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                        <input
                          type="number"
                          min={MIN_SCAN_DEPTH}
                          max={MAX_SCAN_DEPTH}
                          step={1}
                          value={depthDraft}
                          className="ws-depth-input"
                          onChange={(e) => {
                            setDepthDraft(e.target.value);
                            if (depthError) setDepthError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void saveDepth(); }
                          }}
                        />
                        <button
                          type="button"
                          className="ws-prop-btn ws-prop-btn-accent"
                          onClick={() => void saveDepth()}
                          disabled={depthSaving}
                        >
                          <RefreshCw size={10} />
                          {depthSaving ? "Scanning..." : "Rescan"}
                        </button>
                        {depthError && (
                          <span style={{ fontSize: 10.5, color: "var(--danger)" }}>
                            {depthError}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="wsp-section">
                  <div className="wsp-section-label">Info</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">Opened</span>
                      <span className="wsp-field-value">{fmtDate(workspace.lastOpenedAt)}</span>
                    </div>
                    <div className="wsp-field-divider" />
                    <div className="wsp-field">
                      <span className="wsp-field-label">Created</span>
                      <span className="wsp-field-value">{fmtDate(workspace.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {section === "repos" && (
              <>
                {repos.length > 0 && (
                  <div className="wsp-toolbar">
                    <span className="wsp-toolbar-count">
                      {repos.length} {repos.length === 1 ? "repo" : "repos"}
                    </span>
                    <div className="wsp-toolbar-actions">
                      <button
                        type="button"
                        className="ws-prop-btn"
                        onClick={() => void bulkTrust("trusted")}
                      >
                        All trusted
                      </button>
                      <button
                        type="button"
                        className="ws-prop-btn"
                        onClick={() => void bulkTrust("standard")}
                      >
                        All standard
                      </button>
                      <button
                        type="button"
                        className="ws-prop-btn"
                        onClick={() => void rescan()}
                        disabled={depthSaving}
                      >
                        <RefreshCw size={10} />
                        {depthSaving ? "Scanning..." : "Rescan"}
                      </button>
                    </div>
                  </div>
                )}

                {reposLoading && !isActive ? (
                  <div className="wsp-empty">Loading...</div>
                ) : repos.length === 0 ? (
                  <div className="wsp-empty">
                    No repositories found.
                    <br />
                    Try increasing the scan depth in General.
                  </div>
                ) : (
                  <div className="wsp-card" style={{ padding: 0 }}>
                    {repos.map((repo, i) => (
                      <div key={repo.id}>
                        {i > 0 && <div className="wsp-field-divider" />}
                        <div className="wsp-repo">
                          <FolderGit2
                            size={14}
                            style={{
                              flexShrink: 0,
                              color: repo.isActive ? "var(--accent)" : "var(--text-3)",
                            }}
                          />
                          <div className="wsp-repo-info">
                            <div className="wsp-repo-name">{repo.name}</div>
                            <div className="wsp-repo-path">{relPath(repo.path)}</div>
                          </div>
                          <div className="wsp-repo-controls">
                            <Dropdown
                              value={repo.trustLevel}
                              options={TRUST_OPTIONS}
                              onChange={(v) => void setTrust(repo.id, v as TrustLevel)}
                              triggerStyle={{
                                borderRadius: "var(--radius-sm)",
                                minWidth: 88,
                                fontSize: 11,
                                padding: "3px 8px",
                              }}
                            />
                            <label
                              className="ws-toggle"
                              title={repo.isActive ? "Visible in git panel" : "Hidden from git panel"}
                            >
                              <input
                                type="checkbox"
                                checked={repo.isActive}
                                onChange={(e) => void toggleActive(repo.id, e.target.checked)}
                              />
                              <span className="ws-toggle-track" />
                              <span className="ws-toggle-thumb" />
                            </label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {section === "startup" && (
              <WorkspaceStartupSection workspace={workspace} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
