import { useCallback } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
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
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { HarnessInfo } from "../../types";

/* ─── Install command map (mirrors backend harness definitions) ─── */
const INSTALL_COMMANDS: Record<string, string> = {
  codex: "npm install -g @openai/codex",
  "claude-code": "npm install -g @anthropic-ai/claude-code",
  "gemini-cli": "npm install -g @google/gemini-cli",
  kiro: "curl -fsSL https://cli.kiro.dev/install | bash",
  opencode: "npm install -g opencode",
  "kilo-code": "npm install -g kilo-code",
  "factory-droid": "curl -fsSL https://app.factory.ai/cli | sh",
};

/* ─── Harness tile ─── */
function HarnessTile({
  harness,
  onInstallInTerminal,
  onCopyCommand,
  onLaunch,
}: {
  harness: HarnessInfo;
  onInstallInTerminal: () => void;
  onCopyCommand: () => void;
  onLaunch: () => void;
}) {
  const installCmd = INSTALL_COMMANDS[harness.id];

  return (
    <div className={`hp-tile${harness.native ? " hp-tile-native" : ""}${harness.found ? " hp-tile-installed" : ""}`}>
      <div className="hp-tile-icon">
        {getHarnessIcon(harness.id, harness.native ? 22 : 18)}
      </div>

      <div className="hp-tile-body">
        <div className="hp-tile-name-row">
          <span className="hp-tile-name">{harness.name}</span>
          {harness.native && <span className="hp-tile-badge">Native</span>}
        </div>
        <p className="hp-tile-desc">{harness.description}</p>
        {harness.found && (
          <div className="hp-tile-meta">
            <span className="hp-tile-status-ok">
              <CheckCircle2 size={10} />
              Installed
            </span>
            {harness.version && <span className="hp-tile-version">{harness.version}</span>}
          </div>
        )}
      </div>

      <div className="hp-tile-action">
        {harness.found ? (
          <button type="button" className="hp-btn hp-btn-launch" onClick={onLaunch}>
            <Play size={11} />
            Launch
          </button>
        ) : installCmd ? (
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
              Install
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Main panel (full page) ─── */
export function HarnessPanel() {
  const phase = useHarnessStore((s) => s.phase);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const error = useHarnessStore((s) => s.error);
  const scan = useHarnessStore((s) => s.scan);
  const launch = useHarnessStore((s) => s.launch);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const createSession = useTerminalStore((s) => s.createSession);
  const terminalWorkspaces = useTerminalStore((s) => s.workspaces);
  const setActiveView = useUiStore((s) => s.setActiveView);

  const installedCount = harnesses.filter((h) => h.found).length;

  const spawnInTerminal = useCallback(
    async (command: string) => {
      if (!activeWorkspaceId) return;

      const wsState = terminalWorkspaces[activeWorkspaceId];
      if (!wsState || (wsState.layoutMode !== "terminal" && wsState.layoutMode !== "split")) {
        await setLayoutMode(activeWorkspaceId, "terminal");
      }

      const sessionId = await createSession(activeWorkspaceId);
      if (sessionId) {
        void writeCommandToNewSession(activeWorkspaceId, sessionId, command);
      }

      setActiveView("chat");
    },
    [activeWorkspaceId, terminalWorkspaces, setLayoutMode, createSession, setActiveView],
  );

  async function handleLaunch(harnessId: string) {
    const command = await launch(harnessId);
    if (command) await spawnInTerminal(command);
  }

  function handleInstallInTerminal(harnessId: string) {
    const cmd = INSTALL_COMMANDS[harnessId];
    if (cmd) void spawnInTerminal(cmd);
  }

  function handleCopyCommand(harnessId: string) {
    const cmd = INSTALL_COMMANDS[harnessId];
    if (cmd) {
      void copyTextToClipboard(cmd)
        .then(() => {
          void import("../../stores/toastStore").then(({ toast }) => {
            toast.success("Copied to clipboard");
          });
        })
        .catch(() => {
          void import("../../stores/toastStore").then(({ toast }) => {
            toast.error("Failed to copy command");
          });
        });
    }
  }

  return (
    <div className="hp-root">
      <div className="hp-scroll">
        <div className="hp-inner">
          {/* Header */}
          <div className="hp-header">
            <div className="hp-header-top">
              <div className="hp-header-icon">
                <Terminal size={16} />
              </div>
              <h1 className="hp-title">Agent Harnesses</h1>
              <button
                type="button"
                className="hp-rescan"
                onClick={() => void scan()}
                disabled={phase === "scanning"}
                title="Rescan"
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: phase === "scanning" ? "spin 1s linear infinite" : "none",
                  }}
                />
              </button>
            </div>
            <p className="hp-subtitle">
              {phase === "scanning"
                ? "Scanning your system..."
                : `${installedCount} of ${harnesses.length} tools detected`}
            </p>
          </div>

          {/* Content */}
          {phase === "scanning" && harnesses.length === 0 ? (
            <div className="hp-loading">
              <Loader2
                size={20}
                style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
              />
              <p>Detecting installed harnesses...</p>
            </div>
          ) : (
            <div className="hp-grid">
              {harnesses.map((h) => (
                <HarnessTile
                  key={h.id}
                  harness={h}
                  onInstallInTerminal={() => handleInstallInTerminal(h.id)}
                  onCopyCommand={() => handleCopyCommand(h.id)}
                  onLaunch={() => void handleLaunch(h.id)}
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
                Retry
              </button>
            </div>
          )}

          {/* Footer hint */}
          <div className="hp-footer">
            <ArrowRight size={11} />
            <span>Installed harnesses appear as quick-launch options in your terminal + button</span>
          </div>
        </div>
      </div>
    </div>
  );
}
