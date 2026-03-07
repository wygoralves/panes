import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  FolderGit2,
  FolderOpen,
  GitBranch,
  Info,
  Link,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { formatShortDate } from "../../lib/formatters";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { WorkspaceStartupSection } from "./WorkspaceStartupSection";
import { GitRemotesView } from "../git/GitRemotesView";
import type { Repo, TrustLevel, Workspace } from "../../types";

type Section = "general" | "repos" | "startup";

const MIN_SCAN_DEPTH = 0;
const MAX_SCAN_DEPTH = 12;

interface WorkspaceSettingsModalProps {
  workspace: Workspace;
  onClose: () => void;
}

export function WorkspaceSettingsModal({
  workspace,
  onClose,
}: WorkspaceSettingsModalProps) {
  const { t, i18n } = useTranslation("workspace");
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
  const [remotesRepo, setRemotesRepo] = useState<Repo | null>(null);
  const trustOptions = [
    { value: "trusted", label: t("trust.trusted") },
    { value: "standard", label: t("trust.standard") },
    { value: "restricted", label: t("trust.restricted") },
  ];

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
      toast.success(t("toasts.rescanned"));
    } catch {
      toast.error(t("toasts.updateScanDepthFailed"));
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
      toast.success(t("toasts.reposRescanned"));
    } catch {
      toast.error(t("toasts.rescanFailed"));
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
      toast.error(t("toasts.updateTrustFailed"));
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
      toast.error(t("toasts.toggleVisibilityFailed"));
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
      toast.error(t("toasts.updateTrustLevelsFailed"));
    }
  }

  function fmtDate(s: string) {
    try {
      return formatShortDate(s, i18n.language);
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
      toast.error(t("toasts.revealFailed"));
    }
  }

  const name =
    currentWorkspace.name || currentWorkspace.rootPath.split("/").pop() || t("general.workspaceFallback");

  return (
    <>
    {createPortal(
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
            {t("nav.general")}
          </button>
          <button
            type="button"
            className={`ws-nav-item ${section === "repos" ? "ws-nav-item-active" : ""}`}
            onClick={() => setSection("repos")}
          >
            <GitBranch size={13} className="ws-nav-icon" />
            {t("nav.repositories")}
          </button>
          <button
            type="button"
            className={`ws-nav-item ${section === "startup" ? "ws-nav-item-active" : ""}`}
            onClick={() => setSection("startup")}
          >
            <Play size={13} className="ws-nav-icon" />
            {t("nav.startup")}
          </button>
        </div>

        <div className="ws-divider" />

        {/* Body */}
        <div className="ws-body">

          {section === "general" && (
            <>
              <div className="ws-section">
                <div className="ws-section-label">{t("sections.workspace")}</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">{t("general.name")}</span>
                  <span className="ws-prop-value">{name}</span>
                </div>
                <div className="ws-prop">
                  <span className="ws-prop-label">{t("general.path")}</span>
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
                      {t("actions.reveal")}
                    </button>
                  </div>
                </div>
              </div>

              <div className="ws-section">
                <div className="ws-section-label">{t("sections.scanning")}</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">{t("scanning.depth")}</span>
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
                      {depthSaving ? t("scanning.scanning") : t("actions.rescan")}
                    </button>
                    {depthError && (
                      <span style={{ fontSize: 10.5, color: "var(--danger)" }}>{depthError}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="ws-section">
                <div className="ws-section-label">{t("sections.info")}</div>
                <div className="ws-prop">
                  <span className="ws-prop-label">{t("info.opened")}</span>
                  <span className="ws-prop-value">{fmtDate(currentWorkspace.lastOpenedAt)}</span>
                </div>
                <div className="ws-prop">
                  <span className="ws-prop-label">{t("info.created")}</span>
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
                    {t("repos.count", { count: repos.length })}
                  </span>
                  <div className="ws-repos-toolbar-actions">
                    <button
                      type="button"
                      className="ws-prop-btn"
                      onClick={() => void bulkTrust("trusted")}
                    >
                      {t("repos.allTrusted")}
                    </button>
                    <button
                      type="button"
                      className="ws-prop-btn"
                      onClick={() => void bulkTrust("standard")}
                    >
                      {t("repos.allStandard")}
                    </button>
                    <button
                      type="button"
                      className="ws-prop-btn"
                      onClick={() => void rescan()}
                      disabled={depthSaving}
                    >
                      <RefreshCw size={10} />
                      {depthSaving ? t("scanning.scanning") : t("actions.rescan")}
                    </button>
                  </div>
                </div>
              )}

              {reposLoading && !isActive ? (
                <div className="ws-repo-empty">{t("repos.loading")}</div>
              ) : repos.length === 0 ? (
                <div className="ws-repo-empty">
                  {t("repos.emptyTitle")}
                  <br />
                  {t("repos.emptyHint")}
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
                        <button
                          type="button"
                          className="ws-prop-btn"
                          title={t("repos.manageRemotes")}
                          onClick={() => setRemotesRepo(repo)}
                        >
                          <Link size={11} />
                        </button>
                        <Dropdown
                          value={repo.trustLevel}
                          options={trustOptions}
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
                          title={repo.isActive ? t("repos.visible") : t("repos.hidden")}
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
              {t("repos.count", { count: repos.length })}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )}
  {remotesRepo &&
    createPortal(
      <GitRemotesView
        repo={remotesRepo}
        onClose={() => setRemotesRepo(null)}
      />,
      document.body,
    )}
  </>
  );
}
