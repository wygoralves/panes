import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  MessageSquare,
  Package,
  Play,
  RefreshCw,
  Star,
  X,
  Zap,
} from "lucide-react";
import { useHarnessStore } from "../../stores/harnessStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { HarnessInfo } from "../../types";

/* ─── Per-harness brand colors ─── */
const HARNESS_COLORS: Record<string, string> = {
  codex: "#0ef0c3",
  "claude-code": "#d97706",
  "gemini-cli": "#4285f4",
  kiro: "#6366f1",
  opencode: "#10b981",
  "kilo-code": "#ec4899",
  "factory-droid": "#8b5cf6",
};

function getBrandColor(id: string): string {
  return HARNESS_COLORS[id] ?? "var(--accent)";
}

/* ─── Featured native harness card (Codex) ─── */
function NativeHarnessCard({
  harness,
  installing,
  npmAvailable,
  onInstall,
  onLaunch,
}: {
  harness: HarnessInfo;
  installing: boolean;
  npmAvailable: boolean;
  onInstall: () => void;
  onLaunch: () => void;
}) {
  const canInstall = !harness.found && harness.canAutoInstall && npmAvailable;

  return (
    <div className="harness-card-native">
      {/* Top accent bar */}
      <div className="harness-native-accent" />

      <div className="harness-native-content">
        {/* Badge + title row */}
        <div className="harness-native-head">
          <div className="harness-native-icon">
            <Zap size={16} />
          </div>
          <div className="harness-native-title-col">
            <div className="harness-native-title-row">
              <span className="harness-native-name">{harness.name}</span>
              <span className="harness-native-badge">
                <Star size={9} />
                Native
              </span>
            </div>
            <p className="harness-native-desc">{harness.description}</p>
          </div>
        </div>

        {/* Status row */}
        <div className="harness-native-status-row">
          {harness.found ? (
            <>
              <div className="harness-native-status harness-native-status-ok">
                <CheckCircle2 size={11} />
                Installed
              </div>
              {harness.version && (
                <span className="harness-native-version">{harness.version}</span>
              )}
              {harness.path && (
                <span className="harness-native-path" title={harness.path}>
                  {harness.path}
                </span>
              )}
            </>
          ) : (
            <div className="harness-native-status harness-native-status-missing">
              Not installed
            </div>
          )}
        </div>

        {/* Chat integration callout */}
        <div className="harness-native-callout">
          <MessageSquare size={11} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span>Powers the Panes chat — messages are routed through this engine</span>
        </div>

        {/* Action */}
        <div className="harness-native-actions">
          {harness.found ? (
            <button
              type="button"
              className="harness-btn harness-btn-launch-native"
              onClick={onLaunch}
            >
              <Play size={12} />
              Launch in terminal
            </button>
          ) : canInstall ? (
            <button
              type="button"
              className="harness-btn harness-btn-install-native"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? (
                <>
                  <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                  Installing...
                </>
              ) : (
                <>
                  <Download size={12} />
                  Install now
                </>
              )}
            </button>
          ) : (
            <a
              href={harness.website}
              target="_blank"
              rel="noopener noreferrer"
              className="harness-btn harness-btn-website"
            >
              <ExternalLink size={11} />
              Get it
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Regular harness card ─── */
function HarnessCard({
  harness,
  installing,
  npmAvailable,
  onInstall,
  onLaunch,
}: {
  harness: HarnessInfo;
  installing: boolean;
  npmAvailable: boolean;
  onInstall: () => void;
  onLaunch: () => void;
}) {
  const color = getBrandColor(harness.id);
  const canInstall = !harness.found && harness.canAutoInstall && npmAvailable;

  return (
    <div className="harness-card" style={{ "--harness-color": color } as React.CSSProperties}>
      {/* Status indicator */}
      <div className="harness-card-status">
        {harness.found ? (
          <div className="harness-status-dot harness-status-installed" />
        ) : (
          <div className="harness-status-dot harness-status-missing" />
        )}
      </div>

      {/* Info */}
      <div className="harness-card-info">
        <div className="harness-card-header">
          <span className="harness-card-name">{harness.name}</span>
          {harness.found && harness.version && (
            <span className="harness-card-version">{harness.version}</span>
          )}
        </div>
        <p className="harness-card-desc">{harness.description}</p>
        {harness.found && harness.path && (
          <p className="harness-card-path" title={harness.path}>
            {harness.path}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="harness-card-actions">
        {harness.found ? (
          <button
            type="button"
            className="harness-btn harness-btn-launch"
            onClick={onLaunch}
            title={`Launch ${harness.name}`}
          >
            <Play size={12} />
            Launch
          </button>
        ) : canInstall ? (
          <button
            type="button"
            className="harness-btn harness-btn-install"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <>
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                Installing...
              </>
            ) : (
              <>
                <Download size={12} />
                Install
              </>
            )}
          </button>
        ) : (
          <a
            href={harness.website}
            target="_blank"
            rel="noopener noreferrer"
            className="harness-btn harness-btn-website"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink size={11} />
            Get it
          </a>
        )}
      </div>
    </div>
  );
}

/* ─── Install log ─── */
function InstallLog({ log }: { log: { dep: string; line: string; stream: string }[] }) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [log.length]);

  return (
    <pre ref={ref} className="harness-install-log">
      {log.length === 0
        ? "Waiting..."
        : log.map((entry, i) => (
            <div
              key={i}
              style={{
                color:
                  entry.stream === "stderr"
                    ? "var(--warning)"
                    : entry.stream === "status"
                      ? "var(--accent)"
                      : "var(--text-2)",
              }}
            >
              {entry.line}
            </div>
          ))}
    </pre>
  );
}

/* ─── Main panel ─── */
export function HarnessPanel() {
  const open = useHarnessStore((s) => s.open);
  const phase = useHarnessStore((s) => s.phase);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const npmAvailable = useHarnessStore((s) => s.npmAvailable);
  const installingId = useHarnessStore((s) => s.installingId);
  const installLog = useHarnessStore((s) => s.installLog);
  const error = useHarnessStore((s) => s.error);
  const closePanel = useHarnessStore((s) => s.closePanel);
  const scan = useHarnessStore((s) => s.scan);
  const install = useHarnessStore((s) => s.install);
  const launch = useHarnessStore((s) => s.launch);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setLayoutMode = useTerminalStore((s) => s.setLayoutMode);
  const createSession = useTerminalStore((s) => s.createSession);
  const terminalWorkspaces = useTerminalStore((s) => s.workspaces);

  if (!open) return null;

  const nativeHarnesses = harnesses.filter((h) => h.native);
  const regularHarnesses = harnesses.filter((h) => !h.native);
  const installedCount = harnesses.filter((h) => h.found).length;

  async function handleLaunch(harnessId: string) {
    const command = await launch(harnessId);
    if (!command || !activeWorkspaceId) return;

    // Switch to terminal mode and write the command
    const wsState = terminalWorkspaces[activeWorkspaceId];
    if (!wsState || (wsState.layoutMode !== "terminal" && wsState.layoutMode !== "split")) {
      await setLayoutMode(activeWorkspaceId, "terminal");
    }

    // Create a new terminal session for this harness
    const sessionId = await createSession(activeWorkspaceId);
    if (sessionId) {
      // Small delay to let terminal initialize, then write command
      setTimeout(async () => {
        try {
          const { ipc } = await import("../../lib/ipc");
          await ipc.terminalWrite(activeWorkspaceId, sessionId, command + "\r");
        } catch {
          // Terminal may not be ready yet, ignore
        }
      }, 300);
    }

    closePanel();
  }

  return (
    <div
      className="harness-overlay"
      onClick={closePanel}
    >
      <div
        className="harness-panel surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="harness-panel-header">
          <div className="harness-panel-title-row">
            <div className="harness-panel-icon">
              <Package size={16} style={{ color: "var(--accent)" }} />
            </div>
            <div className="harness-panel-title-text">
              <h2 className="harness-panel-title">Harnesses</h2>
              <p className="harness-panel-subtitle">
                {phase === "scanning"
                  ? "Scanning your system..."
                  : `${installedCount} of ${harnesses.length} installed`}
              </p>
            </div>
          </div>
          <div className="harness-panel-header-actions">
            <button
              type="button"
              className="btn-ghost harness-refresh-btn"
              onClick={() => void scan()}
              disabled={phase === "scanning"}
              title="Rescan"
            >
              <RefreshCw
                size={13}
                style={{
                  animation: phase === "scanning" ? "spin 1s linear infinite" : "none",
                }}
              />
            </button>
            <button
              type="button"
              className="btn-ghost harness-close-btn"
              onClick={closePanel}
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="harness-panel-content">
          {phase === "scanning" && harnesses.length === 0 ? (
            <div className="harness-scanning">
              <Loader2
                size={24}
                style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
              />
              <p>Detecting installed harnesses...</p>
            </div>
          ) : (
            <>
              {/* Native integration section (Codex) */}
              {nativeHarnesses.length > 0 && (
                <div className="harness-section">
                  {nativeHarnesses.map((h) => (
                    <NativeHarnessCard
                      key={h.id}
                      harness={h}
                      installing={installingId === h.id}
                      npmAvailable={npmAvailable}
                      onInstall={() => void install(h.id)}
                      onLaunch={() => void handleLaunch(h.id)}
                    />
                  ))}
                </div>
              )}

              {/* Installed section (non-native) */}
              {regularHarnesses.some((h) => h.found) && (
                <div className="harness-section">
                  <div className="harness-section-label">
                    <CheckCircle2 size={11} style={{ color: "var(--success)" }} />
                    Installed
                  </div>
                  <div className="harness-card-list">
                    {regularHarnesses
                      .filter((h) => h.found)
                      .map((h) => (
                        <HarnessCard
                          key={h.id}
                          harness={h}
                          installing={installingId === h.id}
                          npmAvailable={npmAvailable}
                          onInstall={() => void install(h.id)}
                          onLaunch={() => void handleLaunch(h.id)}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Available section (non-native) */}
              {regularHarnesses.some((h) => !h.found) && (
                <div className="harness-section">
                  <div className="harness-section-label">
                    <Download size={11} style={{ color: "var(--text-3)" }} />
                    Available
                  </div>
                  <div className="harness-card-list">
                    {regularHarnesses
                      .filter((h) => !h.found)
                      .map((h) => (
                        <HarnessCard
                          key={h.id}
                          harness={h}
                          installing={installingId === h.id}
                          npmAvailable={npmAvailable}
                          onInstall={() => void install(h.id)}
                          onLaunch={() => void handleLaunch(h.id)}
                        />
                      ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Install log */}
          {phase === "installing" && installLog.length > 0 && (
            <div className="harness-section">
              <div className="harness-section-label">
                <Loader2
                  size={11}
                  style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }}
                />
                Installation log
              </div>
              <InstallLog log={installLog} />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="harness-error">
              <p>{error}</p>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void scan()}
                style={{ padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="harness-panel-footer">
          <p>
            Installed harnesses appear as quick-launch options in your terminal.
          </p>
        </div>
      </div>
    </div>
  );
}
