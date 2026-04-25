import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-shell";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useHarnessStore } from "../../stores/harnessStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { writeCommandToNewSession } from "../../lib/ipc";
import { copyTextToClipboard } from "../../lib/clipboard";
import { showWorkspaceSurface } from "../../lib/workspacePaneNavigation";
import {
  getHarnessInstallCommand,
  getHarnessTileAction,
} from "../../lib/harnessInstallActions";
import { handleDragDoubleClick, handleDragMouseDown } from "../../lib/windowDrag";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { HarnessInfo } from "../../types";

/* ─── Harness tile ─── */
function HarnessTile({
  harness,
  description,
  onInstallInTerminal,
  onCopyCommand,
  onLaunch,
  onOpenWebsite,
}: {
  harness: HarnessInfo;
  description: string;
  onInstallInTerminal: () => void;
  onCopyCommand: () => void;
  onLaunch: () => void;
  onOpenWebsite: () => void;
}) {
  const { t } = useTranslation("app");
  const installCmd = getHarnessInstallCommand(harness.id);
  const action = getHarnessTileAction(harness);

  return (
    <div className={`hp-tile${harness.native ? " hp-tile-native" : ""}${harness.found ? " hp-tile-installed" : ""}`}>
      <div className="hp-tile-icon">
        {getHarnessIcon(harness.id, harness.native ? 22 : 18)}
      </div>

      <div className="hp-tile-body">
        <div className="hp-tile-name-row">
          <span className="hp-tile-name">{harness.name}</span>
          {harness.native && <span className="hp-tile-badge">{t("harnesses.native")}</span>}
        </div>
        <p className="hp-tile-desc">{description}</p>
        {harness.found && (
          <div className="hp-tile-meta">
            <span className="hp-tile-status-ok">
              <CheckCircle2 size={10} />
              {t("harnesses.installed")}
            </span>
            {harness.version && <span className="hp-tile-version">{harness.version}</span>}
          </div>
        )}
      </div>

      <div className="hp-tile-action">
        {action === "launch" ? (
          <button type="button" className="hp-btn hp-btn-launch" onClick={onLaunch}>
            <Play size={11} />
            {t("harnesses.launch")}
          </button>
        ) : action === "install" && installCmd ? (
          <div className="hp-tile-action-group">
            <button
              type="button"
              className="hp-btn hp-btn-copy"
              onClick={onCopyCommand}
              title={installCmd}
            >
              <ClipboardCopy size={11} />
            </button>
            <button
              type="button"
              className="hp-btn hp-btn-install"
              onClick={onInstallInTerminal}
            >
              <Download size={11} />
              {t("harnesses.install")}
            </button>
          </div>
        ) : action === "manual" ? (
          <button
            type="button"
            className="hp-btn hp-btn-copy"
            onClick={onOpenWebsite}
            title={harness.website}
          >
            <ExternalLink size={11} />
            {t("harnesses.website")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Main panel (full page) ─── */
export function HarnessPanel() {
  const { t } = useTranslation("app");
  const phase = useHarnessStore((s) => s.phase);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const error = useHarnessStore((s) => s.error);
  const loadedOnce = useHarnessStore((s) => s.loadedOnce);
  const scan = useHarnessStore((s) => s.scan);
  const ensureScanned = useHarnessStore((s) => s.ensureScanned);
  const launch = useHarnessStore((s) => s.launch);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const createSession = useTerminalStore((s) => s.createSession);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const installedCount = harnesses.filter((h) => h.found).length;
  const goBack = useCallback(() => setActiveView("chat"), [setActiveView]);

  useEffect(() => {
    if (loadedOnce) {
      return;
    }
    void ensureScanned();
  }, [ensureScanned, loadedOnce]);

  const spawnInTerminal = useCallback(
    async (command: string) => {
      if (!activeWorkspaceId) return;

      showWorkspaceSurface(activeWorkspaceId, "terminal");

      const sessionId = await createSession(activeWorkspaceId);
      if (sessionId) {
        void writeCommandToNewSession(activeWorkspaceId, sessionId, command);
      }

      setActiveView("chat");
    },
    [activeWorkspaceId, createSession, setActiveView],
  );

  async function handleLaunch(harnessId: string) {
    const command = await launch(harnessId);
    if (command) await spawnInTerminal(command);
  }

  function handleInstallInTerminal(harnessId: string) {
    const cmd = getHarnessInstallCommand(harnessId);
    if (cmd) void spawnInTerminal(cmd);
  }

  function handleCopyCommand(harnessId: string) {
    const cmd = getHarnessInstallCommand(harnessId);
    if (cmd) {
      void copyTextToClipboard(cmd)
        .then(() => {
          void import("../../stores/toastStore").then(({ toast }) => {
            toast.success(t("harnesses.copySuccess"));
          });
        })
        .catch(() => {
          void import("../../stores/toastStore").then(({ toast }) => {
            toast.error(t("harnesses.copyFailed"));
          });
        });
    }
  }

  function handleOpenWebsite(website: string) {
    void open(website).catch(() => {
      void import("../../stores/toastStore").then(({ toast }) => {
        toast.error(t("harnesses.websiteOpenFailed"));
      });
    });
  }

  return (
    <div className="hp-root">
      <div className="hp-scroll">
        <div className="hp-inner">
          {/* Header */}
          <div className="hp-header">
            <div
              className="hp-header-top"
              onMouseDown={handleDragMouseDown}
              onDoubleClick={handleDragDoubleClick}
            >
              <button type="button" className="wsp-back" onClick={goBack} title={t("workspace:actions.back")}>
                <ArrowLeft size={14} />
              </button>
              <div className="hp-header-icon">
                <Terminal size={16} />
              </div>
              <div className="hp-header-text">
                <h1 className="hp-title">{t("harnesses.title")}</h1>
                <p className="hp-subtitle">
                  {phase === "scanning"
                    ? t("harnesses.scanning")
                    : t("harnesses.detectedCount", {
                        installed: installedCount,
                        total: harnesses.length,
                      })}
                </p>
              </div>
              <button
                type="button"
                className="hp-rescan"
                onClick={() => void scan()}
                disabled={phase === "scanning"}
                title={t("harnesses.rescan")}
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: phase === "scanning" ? "spin 1s linear infinite" : "none",
                  }}
                />
              </button>
            </div>
          </div>

          {/* Content */}
          {phase === "scanning" && harnesses.length === 0 ? (
            <div className="hp-loading">
              <Loader2
                size={20}
                style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
              />
              <p>{t("harnesses.loading")}</p>
            </div>
          ) : (
            <div className="hp-grid">
              {harnesses.map((h) => (
                <HarnessTile
                  key={h.id}
                  harness={h}
                  description={t(`harnesses.descriptions.${h.id}`, { defaultValue: h.description })}
                  onInstallInTerminal={() => handleInstallInTerminal(h.id)}
                  onCopyCommand={() => handleCopyCommand(h.id)}
                  onLaunch={() => void handleLaunch(h.id)}
                  onOpenWebsite={() => handleOpenWebsite(h.website)}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="hp-error">
              <p>{error}</p>
              <button
                type="button"
                className="hp-btn hp-btn-install"
                onClick={() => void scan()}
              >
                {t("harnesses.retry")}
              </button>
            </div>
          )}

          {/* Footer hint */}
          <div className="hp-footer">
            <ArrowRight size={11} />
            <span>{t("harnesses.footerHint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
