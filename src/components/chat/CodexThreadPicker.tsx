import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightCircle,
  ChevronDown,
  GitBranch,
  PackageMinus,
  RefreshCw,
  Scissors,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ipc } from "../../lib/ipc";
import type { CodexRemoteThread } from "../../types";

interface CodexThreadPickerProps {
  disabled?: boolean;
  workspaceId?: string | null;
  modelId?: string | null;
  canManageActiveThread?: boolean;
  onFork: () => Promise<void>;
  onRollback: (numTurns: number) => Promise<void>;
  onCompact: () => Promise<void>;
  onAttachRemoteThread: (engineThreadId: string) => Promise<void>;
}

type RemoteFilterMode = "active" | "archived";

function formatRemoteThreadTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

function describeRemoteThread(thread: CodexRemoteThread): string {
  const title = thread.title?.trim();
  if (title) {
    return title;
  }

  const preview = thread.preview.trim();
  if (preview) {
    return preview.split("\n")[0] ?? preview;
  }

  return thread.engineThreadId;
}

export function CodexThreadPicker({
  disabled = false,
  workspaceId,
  modelId,
  canManageActiveThread = false,
  onFork,
  onRollback,
  onCompact,
  onAttachRemoteThread,
}: CodexThreadPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [rollbackTurnsText, setRollbackTurnsText] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [remoteThreads, setRemoteThreads] = useState<CodexRemoteThread[]>([]);
  const [remoteNextCursor, setRemoteNextCursor] = useState<string | null>(null);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [remoteFilter, setRemoteFilter] = useState<RemoteFilterMode>("active");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 520));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function loadRemoteThreads(reset: boolean) {
    if (!workspaceId || !modelId) {
      setRemoteThreads([]);
      setRemoteNextCursor(null);
      setRemoteLoaded(true);
      return;
    }

    const cursor = reset ? null : remoteNextCursor;
    setBusyAction(reset ? "remote-refresh" : "remote-more");
    if (reset) {
      setError(null);
      setRemoteLoaded(false);
      setRemoteNextCursor(null);
    }

    try {
      const page = await ipc.listCodexRemoteThreads(workspaceId, {
        cursor,
        limit: 20,
        searchTerm: searchQuery || null,
        archived: remoteFilter === "archived",
      });

      setRemoteThreads((current) => {
        if (reset) {
          return page.threads;
        }

        const seen = new Set(current.map((thread) => thread.engineThreadId));
        return [
          ...current,
          ...page.threads.filter((thread) => !seen.has(thread.engineThreadId)),
        ];
      });
      setRemoteNextCursor(page.nextCursor ?? null);
      setRemoteLoaded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      if (reset) {
        setRemoteThreads([]);
        setRemoteNextCursor(null);
        setRemoteLoaded(true);
      }
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadRemoteThreads(true);
  }, [modelId, open, remoteFilter, searchQuery, workspaceId]);

  async function handleFork() {
    setBusyAction("fork");
    setError(null);
    try {
      await onFork();
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRollback() {
    const parsedTurns = Number.parseInt(rollbackTurnsText.trim(), 10);
    if (!Number.isFinite(parsedTurns) || parsedTurns < 1) {
      setError(t("threadPicker.invalidTurns"));
      return;
    }

    setBusyAction("rollback");
    setError(null);
    try {
      await onRollback(parsedTurns);
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCompact() {
    setBusyAction("compact");
    setError(null);
    try {
      await onCompact();
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAttachRemoteThread(thread: CodexRemoteThread) {
    setBusyAction(`attach:${thread.engineThreadId}`);
    setError(null);
    try {
      await onAttachRemoteThread(thread.engineThreadId);
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  const remoteBrowsingDisabled = !workspaceId || !modelId;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`chat-toolbar-btn chat-toolbar-btn-bordered${open ? " chat-toolbar-btn-active" : ""}`}
        disabled={disabled || busyAction !== null}
        title={t("threadPicker.title")}
        onClick={() => setOpen((current) => !current)}
      >
        <GitBranch size={12} />
        <span style={{ fontSize: 11 }}>{t("threadPicker.shortTitle")}</span>
        <ChevronDown size={12} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="codex-config-popover"
            style={{
              position: "fixed",
              zIndex: 1300,
              bottom: pos.bottom,
              left: pos.left,
              width: "min(500px, calc(100vw - 16px))",
            }}
          >
            <div className="codex-config-header">
              <div>
                <div className="codex-config-title">{t("threadPicker.title")}</div>
                <div className="codex-config-subtitle">
                  {t("threadPicker.subtitle")}
                </div>
              </div>
            </div>

            <div className="codex-config-fields">
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="codex-config-label">
                  {t("threadPicker.resumeTitle")}
                </div>
                <div className="codex-config-note">
                  {t("threadPicker.resumeDescription")}
                </div>

                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto auto" }}>
                  <input
                    className="codex-config-select"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setSearchQuery(searchDraft.trim());
                      }
                    }}
                    placeholder={t("threadPicker.searchPlaceholder")}
                    disabled={busyAction !== null || remoteBrowsingDisabled}
                  />
                  <select
                    className="codex-config-select"
                    value={remoteFilter}
                    onChange={(event) =>
                      setRemoteFilter(event.target.value as RemoteFilterMode)
                    }
                    disabled={busyAction !== null || remoteBrowsingDisabled}
                  >
                    <option value="active">
                      {t("threadPicker.filters.active")}
                    </option>
                    <option value="archived">
                      {t("threadPicker.filters.archived")}
                    </option>
                  </select>
                  <button
                    type="button"
                    className="chat-toolbar-btn chat-toolbar-btn-active"
                    onClick={() => setSearchQuery(searchDraft.trim())}
                    disabled={busyAction !== null || remoteBrowsingDisabled}
                  >
                    <Search size={12} />
                    {t("threadPicker.searchAction")}
                  </button>
                </div>

                <div className="codex-config-note">
                  {remoteBrowsingDisabled
                    ? t("threadPicker.resumeUnavailable")
                    : t("threadPicker.remoteHistoryNote")}
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    maxHeight: 260,
                    overflowY: "auto",
                    paddingRight: 2,
                  }}
                >
                  {!remoteLoaded && busyAction === "remote-refresh" ? (
                    <div className="codex-config-note">
                      {t("threadPicker.loadingRemote")}
                    </div>
                  ) : null}

                  {remoteLoaded && remoteThreads.length === 0 && !remoteBrowsingDisabled ? (
                    <div className="codex-config-note">
                      {t("threadPicker.noRemoteThreads")}
                    </div>
                  ) : null}

                  {remoteThreads.map((thread) => {
                    const threadLabel = describeRemoteThread(thread);
                    const attachBusy = busyAction === `attach:${thread.engineThreadId}`;
                    const attachLabel = thread.localThreadId
                      ? t("threadPicker.openAttachedAction")
                      : t("threadPicker.attachAction");

                    return (
                      <div
                        key={thread.engineThreadId}
                        style={{
                          display: "grid",
                          gap: 8,
                          padding: 10,
                          borderRadius: 10,
                          background: "var(--bg-3)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 12,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              className="codex-config-label"
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={threadLabel}
                            >
                              {threadLabel}
                            </div>
                            <div
                              className="codex-config-note"
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                              title={thread.cwd}
                            >
                              {thread.cwd}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="chat-toolbar-btn chat-toolbar-btn-active"
                            onClick={() => void handleAttachRemoteThread(thread)}
                            disabled={busyAction !== null || remoteBrowsingDisabled}
                          >
                            <ArrowRightCircle size={12} />
                            {attachBusy ? t("threadPicker.working") : attachLabel}
                          </button>
                        </div>

                        {thread.preview.trim() ? (
                          <div className="codex-config-note">{thread.preview}</div>
                        ) : null}

                        <div className="codex-config-note">
                          {t("threadPicker.threadMeta", {
                            updatedAt: formatRemoteThreadTimestamp(thread.updatedAt),
                            sourceKind: thread.sourceKind,
                            statusType: thread.statusType,
                            modelProvider: thread.modelProvider,
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <button
                    type="button"
                    className="chat-toolbar-btn"
                    onClick={() => void loadRemoteThreads(true)}
                    disabled={busyAction !== null || remoteBrowsingDisabled}
                  >
                    <RefreshCw size={12} />
                    {busyAction === "remote-refresh"
                      ? t("threadPicker.working")
                      : t("threadPicker.refreshAction")}
                  </button>
                  <button
                    type="button"
                    className="chat-toolbar-btn"
                    onClick={() => void loadRemoteThreads(false)}
                    disabled={
                      busyAction !== null ||
                      remoteBrowsingDisabled ||
                      !remoteNextCursor
                    }
                  >
                    <RefreshCw size={12} />
                    {busyAction === "remote-more"
                      ? t("threadPicker.working")
                      : t("threadPicker.loadMoreAction")}
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  opacity: canManageActiveThread ? 1 : 0.72,
                }}
              >
                <div className="codex-config-label">{t("threadPicker.forkTitle")}</div>
                <div className="codex-config-note">{t("threadPicker.forkDescription")}</div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleFork()}
                  disabled={busyAction !== null || !canManageActiveThread}
                >
                  <GitBranch size={12} />
                  {busyAction === "fork"
                    ? t("threadPicker.working")
                    : t("threadPicker.forkAction")}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  opacity: canManageActiveThread ? 1 : 0.72,
                }}
              >
                <div className="codex-config-label">{t("threadPicker.rollbackTitle")}</div>
                <div className="codex-config-note">
                  {t("threadPicker.rollbackDescription")}
                </div>
                <label className="codex-config-field">
                  <span className="codex-config-note">
                    {t("threadPicker.rollbackTurns")}
                  </span>
                  <input
                    className="codex-config-select"
                    inputMode="numeric"
                    value={rollbackTurnsText}
                    onChange={(event) => setRollbackTurnsText(event.target.value)}
                    disabled={busyAction !== null || !canManageActiveThread}
                  />
                </label>
                <div className="codex-config-note">
                  {t("threadPicker.rollbackWarning")}
                </div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleRollback()}
                  disabled={busyAction !== null || !canManageActiveThread}
                >
                  <PackageMinus size={12} />
                  {busyAction === "rollback"
                    ? t("threadPicker.working")
                    : t("threadPicker.rollbackAction")}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  opacity: canManageActiveThread ? 1 : 0.72,
                }}
              >
                <div className="codex-config-label">{t("threadPicker.compactTitle")}</div>
                <div className="codex-config-note">
                  {t("threadPicker.compactDescription")}
                </div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleCompact()}
                  disabled={busyAction !== null || !canManageActiveThread}
                >
                  <Scissors size={12} />
                  {busyAction === "compact"
                    ? t("threadPicker.working")
                    : t("threadPicker.compactAction")}
                </button>
              </div>
            </div>

            {error ? <div className="codex-config-error">{error}</div> : null}
          </div>,
          document.body,
        )}
    </>
  );
}
