import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderGit2,
  FolderOpen,
  GitBranch,
  Info,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { WorkspaceStartupSection } from "./WorkspaceStartupSection";
import type { Repo, TrustLevel, Workspace } from "../../types";

type Section = "general" | "repos" | "startup";

const MIN_SCAN_DEPTH = 0;
const MAX_SCAN_DEPTH = 12;

const TRUST_OPTIONS = [
  { value: "trusted", label: "Trusted" },
  { value: "standard", label: "Standard" },
  { value: "restricted", label: "Restricted" },
];

interface WorkspaceSettingsModalProps {
  workspace: Workspace;
  onClose: () => void;
}

export function WorkspaceSettingsModal({
  workspace,
  onClose,
}: WorkspaceSettingsModalProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const storeRepos = useWorkspaceStore((s) => s.repos);
  const storeSetTrust = useWorkspaceStore((s) => s.setRepoTrustLevel);
  const storeSetGitActive = useWorkspaceStore((s) => s.setRepoGitActive);
  const storeSetAllTrust = useWorkspaceStore((s) => s.setAllReposTrustLevel);
  const storeRescan = useWorkspaceStore((s) => s.rescanWorkspace);

  const currentWorkspace =
    workspaces.find((candidate) => candidate.id === workspace.id) ?? workspace;

  const isActive = currentWorkspace.id === activeWorkspaceId;

  const [section, setSection] = useState<Section>("general");
  const [depthDraft, setDepthDraft] = useState(String(currentWorkspace.scanDepth));
  const [depthSaving, setDepthSaving] = useState(false);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [localRepos, setLocalRepos] = useState<Repo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);

  const repos = isActive ? storeRepos : (localRepos ?? []);

  useEffect(() => {
    setDepthDraft(String(currentWorkspace.scanDepth));
    setDepthError(null);
  }, [currentWorkspace.id, currentWorkspace.scanDepth]);

  useEffect(() => {
    if (isActive) return;
    let cancelled = false;
    setReposLoading(true);
    ipc.getRepos(currentWorkspace.id)
      .then((r) => { if (!cancelled) setLocalRepos(r); })
      .catch(() => { if (!cancelled) setLocalRepos([]); })
      .finally(() => { if (!cancelled) setReposLoading(false); });
    return () => { cancelled = true; };
  }, [currentWorkspace.id, isActive]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  async function saveDepth() {
    const n = Number.parseInt(depthDraft.trim(), 10);
    if (!Number.isFinite(n) || n < MIN_SCAN_DEPTH || n > MAX_SCAN_DEPTH) {
      setDepthError(`${MIN_SCAN_DEPTH}–${MAX_SCAN_DEPTH}`);
      return;
    }
    setDepthError(null);
    setDepthSaving(true);
    try {
      const updatedWorkspace = await storeRescan(currentWorkspace.id, n);
      if (!isActive) {
        setLocalRepos(await ipc.getRepos(currentWorkspace.id));
      }
      if (updatedWorkspace) {
        setDepthDraft(String(updatedWorkspace.scanDepth));
      }
      toast.success("Rescanned.");
    } catch {
      toast.error("Failed to update scan depth.");
    } finally {
      setDepthSaving(false);
    }
  }

  async function rescan() {
    setDepthSaving(true);
    try {
      await storeRescan(currentWorkspace.id);
      if (!isActive) {
        setLocalRepos(await ipc.getRepos(currentWorkspace.id));
      }
      toast.success("Repos rescanned.");
    } catch {
      toast.error("Rescan failed.");
    } finally {
      setDepthSaving(false);
    }
  }

  async function setTrust(repoId: string, level: TrustLevel) {
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
      const d = new Date(s);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return s;
    }
  }

  function relPath(p: string) {
    if (p.startsWith(currentWorkspace.rootPath)) {
      const r = p.slice(currentWorkspace.rootPath.length).replace(/^\//, "");
      return r || ".";
    }
    return p;
  }

  async function revealWorkspace() {
    try {
      await ipc.revealPath(currentWorkspace.rootPath);
    } catch {
      toast.error("Failed to reveal workspace in Finder.");
    }
  }

  const name =
    currentWorkspace.name || currentWorkspace.rootPath.split("/").pop() || "Workspace";

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div className="ws-modal" onMouseDown={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ws-header">
          <div className="ws-header-icon">
            <FolderGit2 size={17} />
          </div>
          <div className="ws-header-text">
            <h3 className="ws-header-title">{name}</h3>
            <p className="ws-header-path">{currentWorkspace.rootPath}</p>
          </div>
          <button type="button" className="ws-close" onClick={close}>
            <X size={14} />
          </button>
        </div>

        {/* Nav */}
        <div className="ws-nav">
          <button
            type="button"
            className={`ws-nav-item ${section === "general" ? "ws-nav-item-active" : ""}`}
            onClick={() => setSection("general")}
          >
            <Info size={13} className="ws-nav-icon" />
            General
          </button>
          <button
            type="button"
            className={`ws-nav-item ${section === "repos" ? "ws-nav-item-active" : ""}`}
            onClick={() => setSection("repos")}
          >
            <GitBranch size={13} className="ws-nav-icon" />
            Repositories
          </button>
          <button
            type="button"
            className={`ws-nav-item ${section === "startup" ? "ws-nav-item-active" : ""}`}
            onClick={() => setSection("startup")}
          >
            <Play size={13} className="ws-nav-icon" />
            Startup
          </button>
        </div>

        <div className="ws-divider" />

        {/* Body */}
        <div className="ws-body">

          {section === "general" && (
            <>
              <div className="ws-section">
                <div className="ws-section-label">Workspace</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">Name</span>
                  <span className="ws-prop-value">{name}</span>
                </div>
                <div className="ws-prop">
                  <span className="ws-prop-label">Path</span>
                  <span className="ws-prop-value ws-prop-mono" title={currentWorkspace.rootPath}>
                    {currentWorkspace.rootPath}
                  </span>
                  <div className="ws-prop-actions">
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

              <div className="ws-section">
                <div className="ws-section-label">Scanning</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">Depth</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
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
                      <span style={{ fontSize: 10.5, color: "var(--danger)" }}>{depthError}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="ws-section">
                <div className="ws-section-label">Info</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">Opened</span>
                  <span className="ws-prop-value">{fmtDate(currentWorkspace.lastOpenedAt)}</span>
                </div>
                <div className="ws-prop">
                  <span className="ws-prop-label">Created</span>
                  <span className="ws-prop-value">{fmtDate(currentWorkspace.createdAt)}</span>
                </div>
              </div>
            </>
          )}

          {section === "repos" && (
            <>
              {repos.length > 0 && (
                <div className="ws-repos-toolbar">
                  <span className="ws-repos-toolbar-count">
                    {repos.length} {repos.length === 1 ? "repo" : "repos"}
                  </span>
                  <div className="ws-repos-toolbar-actions">
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
                <div className="ws-repo-empty">Loading...</div>
              ) : repos.length === 0 ? (
                <div className="ws-repo-empty">
                  No repositories found.
                  <br />
                  Try increasing the scan depth in General.
                </div>
              ) : (
                <div className="ws-repo-list">
                  {repos.map((repo) => (
                    <div key={repo.id} className="ws-repo">
                      <FolderGit2
                        size={14}
                        className="ws-repo-icon"
                        style={{ color: repo.isActive ? "var(--accent)" : "var(--text-3)" }}
                      />
                      <div className="ws-repo-info">
                        <div className="ws-repo-name">{repo.name}</div>
                        <div className="ws-repo-path">{relPath(repo.path)}</div>
                      </div>
                      <div className="ws-repo-controls">
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
                  ))}
                </div>
              )}
            </>
          )}

          {section === "startup" && (
            <WorkspaceStartupSection workspace={currentWorkspace} />
          )}
        </div>

        {/* Footer — only for general/repos tabs */}
        {section !== "startup" && (
          <div className="ws-footer">
            <span className="ws-footer-meta">
              {repos.length} {repos.length === 1 ? "repo" : "repos"}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
