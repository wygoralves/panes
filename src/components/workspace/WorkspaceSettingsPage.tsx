import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Info,
  Link,
  Play,
  RefreshCw,
} from "lucide-react";
import { ipc } from "../../lib/ipc";
import { formatShortDate } from "../../lib/formatters";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { toast } from "../../stores/toastStore";
import { Dropdown } from "../shared/Dropdown";
import { WorkspaceStartupSection } from "./WorkspaceStartupSection";
import { GitRemotesView } from "../git/GitRemotesView";
import type { Repo, TrustLevel } from "../../types";

type Section = "general" | "repos" | "startup";

const MIN_SCAN_DEPTH = 0;
const MAX_SCAN_DEPTH = 12;

export function WorkspaceSettingsPage() {
  const { t, i18n } = useTranslation("workspace");
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
  const [remotesRepo, setRemotesRepo] = useState<Repo | null>(null);
  const trustOptions = [
    { value: "trusted", label: t("trust.trusted") },
    { value: "standard", label: t("trust.standard") },
    { value: "restricted", label: t("trust.restricted") },
  ];

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
            <p style={{ color: "var(--text-3)" }}>{t("errors.notFound")}</p>
            <button type="button" className="ws-prop-btn" onClick={goBack}>
              <ArrowLeft size={12} /> {t("actions.back")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const name = workspace.name || workspace.rootPath.split("/").pop() || t("general.workspaceFallback");

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
      toast.success(t("toasts.rescanned"));
    } catch {
      toast.error(t("toasts.updateScanDepthFailed"));
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
      toast.success(t("toasts.reposRescanned"));
    } catch {
      toast.error(t("toasts.rescanFailed"));
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
      toast.error(t("toasts.updateTrustFailed"));
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
      toast.error(t("toasts.toggleVisibilityFailed"));
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
      toast.error(t("toasts.revealFailed"));
    }
  }

  return (
    <>
    <div className="wsp-root">
      <div className="wsp-scroll">
        <div className="wsp-inner">
          {/* Header */}
          <div
            className="wsp-header"
            onMouseDown={handleDragMouseDown}
            onDoubleClick={handleDragDoubleClick}
          >
            <button type="button" className="wsp-back" onClick={goBack} title={t("actions.back")}>
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
              {t("nav.general")}
            </button>
            <button
              type="button"
              className={`wsp-nav-item ${section === "repos" ? "wsp-nav-active" : ""}`}
              onClick={() => setSection("repos")}
            >
              <GitBranch size={13} />
              {t("nav.repositories")}
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
              {t("nav.startup")}
            </button>
          </div>

          {/* Content */}
          <div className="wsp-content">
            {section === "general" && (
              <>
                <div className="wsp-section">
                  <div className="wsp-section-label">{t("sections.workspace")}</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">{t("general.name")}</span>
                      <span className="wsp-field-value">{name}</span>
                    </div>
                    <div className="wsp-field-divider" />
                    <div className="wsp-field">
                      <span className="wsp-field-label">{t("general.path")}</span>
                      <span className="wsp-field-value wsp-mono" title={workspace.rootPath}>
                        {workspace.rootPath}
                      </span>
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

                <div className="wsp-section">
                  <div className="wsp-section-label">{t("sections.scanning")}</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">{t("scanning.depth")}</span>
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
                          {depthSaving ? t("scanning.scanning") : t("actions.rescan")}
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
                  <div className="wsp-section-label">{t("sections.info")}</div>
                  <div className="wsp-card">
                    <div className="wsp-field">
                      <span className="wsp-field-label">{t("info.opened")}</span>
                      <span className="wsp-field-value">{fmtDate(workspace.lastOpenedAt)}</span>
                    </div>
                    <div className="wsp-field-divider" />
                    <div className="wsp-field">
                      <span className="wsp-field-label">{t("info.created")}</span>
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
                      {t("repos.count", { count: repos.length })}
                    </span>
                    <div className="wsp-toolbar-actions">
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
                  <div className="wsp-empty">{t("repos.loading")}</div>
                ) : repos.length === 0 ? (
                  <div className="wsp-empty">
                    {t("repos.emptyTitle")}
                    <br />
                    {t("repos.emptyHint")}
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
