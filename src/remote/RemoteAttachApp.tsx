import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Loader2, MessageSquare, PlugZap, RefreshCw, Shield, ShieldOff, SquareTerminal } from "lucide-react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useTranslation } from "react-i18next";
import { MessageBlocks } from "../components/chat/MessageBlocks";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { ipc, listenThreadUpdated } from "../lib/ipc";
import { resetPanesTransport, setPanesTransport } from "../lib/panesTransport";
import { createRemoteTransport, type RemotePanesTransport } from "../lib/remoteTransport";
import { useChatStore } from "../stores/chatStore";
import { toast } from "../stores/toastStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useThreadStore } from "../stores/threadStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { ContentBlock, Message, RemoteControllerLease, RemoteDeviceGrant } from "../types";
import { RemoteGitPanel } from "./RemoteGitPanel";
import { selectWorkspaceThreads } from "./remoteAttachState";

const REMOTE_URL_STORAGE_KEY = "panes:remote.attach.url";
const CONTROL_TTL_SECS = 45;
const CONTROL_RENEW_MS = 20_000;

interface RemoteBootstrapState {
  mode: "desktop" | "remote";
  url: string;
  token: string;
  autoConnect: boolean;
}

function parseRemoteBootstrapState(): RemoteBootstrapState {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const persistedUrl = localStorage.getItem(REMOTE_URL_STORAGE_KEY) ?? "";
  const url = search.get("remoteUrl") ?? hash.get("remoteUrl") ?? persistedUrl;
  const token = hash.get("token") ?? search.get("token") ?? "";
  const mode =
    window.location.pathname === "/remote" ||
    search.get("remote") === "1" ||
    search.has("remoteUrl")
      ? "remote"
      : "desktop";

  return {
    mode,
    url,
    token,
    autoConnect: Boolean(url && token),
  };
}

function normalizeRemoteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^http/i, "ws");
  }
  return `ws://${trimmed}`;
}

function messageBlocks(message: Message): ContentBlock[] | undefined {
  if (message.blocks && message.blocks.length > 0) {
    return message.blocks;
  }
  if (message.content && message.content.trim()) {
    return [{ type: "text", content: message.content }];
  }
  return undefined;
}

async function bootstrapRemoteStores(): Promise<void> {
  await useWorkspaceStore.getState().loadWorkspaces();
  const workspaceIds = useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id);
  await useThreadStore.getState().refreshAllThreads(workspaceIds);
}

function useRemoteController(
  grant: RemoteDeviceGrant | null,
  activeWorkspaceId: string | null,
  activeThreadId: string | null,
) {
  const [workspaceLease, setWorkspaceLease] = useState<RemoteControllerLease | null>(null);
  const [threadLease, setThreadLease] = useState<RemoteControllerLease | null>(null);
  const [controlDesired, setControlDesired] = useState(true);
  const [controlError, setControlError] = useState<string | null>(null);

  const releaseLease = useCallback(async (lease: RemoteControllerLease | null) => {
    if (!lease) {
      return;
    }
    try {
      await ipc.releaseRemoteControllerLease(lease.id);
    } catch {
      // Best effort; the host cleans up expired leases.
    }
  }, []);

  const ensureWorkspaceControl = useCallback(
    async (workspaceId: string | null): Promise<boolean> => {
      if (!grant || !workspaceId) {
        return false;
      }
      const lease = await ipc.acquireRemoteControllerLease(
        grant.id,
        "workspace",
        workspaceId,
        CONTROL_TTL_SECS,
      );
      setWorkspaceLease(lease);
      return true;
    },
    [grant],
  );

  const ensureThreadControl = useCallback(
    async (threadId: string | null): Promise<boolean> => {
      if (!grant || !threadId) {
        return false;
      }
      const lease = await ipc.acquireRemoteControllerLease(
        grant.id,
        "thread",
        threadId,
        CONTROL_TTL_SECS,
      );
      setThreadLease(lease);
      return true;
    },
    [grant],
  );

  useEffect(() => {
    if (!workspaceLease || workspaceLease.scopeId === activeWorkspaceId) {
      return;
    }
    void releaseLease(workspaceLease);
    setWorkspaceLease(null);
  }, [activeWorkspaceId, releaseLease, workspaceLease]);

  useEffect(() => {
    if (!threadLease || threadLease.scopeId === activeThreadId) {
      return;
    }
    void releaseLease(threadLease);
    setThreadLease(null);
  }, [activeThreadId, releaseLease, threadLease]);

  useEffect(() => {
    if (!grant || !activeWorkspaceId || !controlDesired) {
      return;
    }

    let cancelled = false;
    const renew = async () => {
      try {
        await ensureWorkspaceControl(activeWorkspaceId);
        if (!cancelled) {
          setControlError(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setWorkspaceLease(null);
        setControlDesired(false);
        setControlError(String(error));
      }
    };

    void renew();
    const timer = window.setInterval(() => {
      void renew();
    }, CONTROL_RENEW_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspaceId, controlDesired, ensureWorkspaceControl, grant]);

  useEffect(() => {
    if (!grant || !activeThreadId || !controlDesired) {
      return;
    }

    let cancelled = false;
    const renew = async () => {
      try {
        await ensureThreadControl(activeThreadId);
        if (!cancelled) {
          setControlError(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setThreadLease(null);
        setControlDesired(false);
        setControlError(String(error));
      }
    };

    void renew();
    const timer = window.setInterval(() => {
      void renew();
    }, CONTROL_RENEW_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeThreadId, controlDesired, ensureThreadControl, grant]);

  const requestControl = useCallback(async (): Promise<boolean> => {
    setControlError(null);
    setControlDesired(true);

    try {
      if (activeWorkspaceId) {
        await ensureWorkspaceControl(activeWorkspaceId);
      }
      if (activeThreadId) {
        await ensureThreadControl(activeThreadId);
      }
      return true;
    } catch (error) {
      setControlDesired(false);
      setControlError(String(error));
      return false;
    }
  }, [activeThreadId, activeWorkspaceId, ensureThreadControl, ensureWorkspaceControl]);

  const releaseControl = useCallback(async () => {
    setControlDesired(false);
    setControlError(null);
    await Promise.allSettled([releaseLease(workspaceLease), releaseLease(threadLease)]);
    setWorkspaceLease(null);
    setThreadLease(null);
  }, [releaseLease, threadLease, workspaceLease]);

  return {
    hasWorkspaceControl:
      workspaceLease?.scopeType === "workspace" && workspaceLease.scopeId === activeWorkspaceId,
    hasThreadControl:
      threadLease?.scopeType === "thread" && threadLease.scopeId === activeThreadId,
    controlDesired,
    controlError,
    ensureWorkspaceControl,
    ensureThreadControl,
    requestControl,
    releaseControl,
  };
}

function RemoteChatPane({
  activeWorkspaceId,
  activeThreadId,
  activeRepoName,
  canCreateThread,
  canSendToThread,
  ensureWorkspaceControl,
  ensureThreadControl,
  onCreateThread,
}: {
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  activeRepoName: string | null;
  canCreateThread: boolean;
  canSendToThread: boolean;
  ensureWorkspaceControl: (workspaceId: string | null) => Promise<boolean>;
  ensureThreadControl: (threadId: string | null) => Promise<boolean>;
  onCreateThread: () => Promise<string | null>;
}) {
  const { t, i18n } = useTranslation(["app", "chat"]);
  const {
    messages,
    hasOlderMessages,
    loadingOlderMessages,
    streaming,
    error,
    loadOlderMessages,
    send,
    cancel,
    respondApproval,
    hydrateActionOutput,
  } = useChatStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDisabled = !activeWorkspaceId || (!activeThreadId ? !canCreateThread : !canSendToThread);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (nearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleApproval = useCallback(
    async (approvalId: string, response: Parameters<typeof respondApproval>[1]) => {
      if (!activeThreadId) {
        return;
      }
      const ok = await ensureThreadControl(activeThreadId);
      if (!ok) {
        toast.error(t("app:remoteAttach.control.takeControlFailed"));
        return;
      }
      await respondApproval(approvalId, response);
    },
    [activeThreadId, ensureThreadControl, respondApproval, t],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const message = input.trim();
      if (!message || !activeWorkspaceId) {
        return;
      }

      let threadId = activeThreadId;
      if (!threadId) {
        const hasWorkspaceControl = await ensureWorkspaceControl(activeWorkspaceId);
        if (!hasWorkspaceControl) {
          toast.error(t("app:remoteAttach.control.takeControlFailed"));
          return;
        }
        threadId = await onCreateThread();
      }

      if (!threadId) {
        return;
      }

      const hasThreadControl = await ensureThreadControl(threadId);
      if (!hasThreadControl) {
        toast.error(t("app:remoteAttach.control.takeControlFailed"));
        return;
      }

      const sent = await send(message, { threadIdOverride: threadId });
      if (sent) {
        setInput("");
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      ensureThreadControl,
      ensureWorkspaceControl,
      input,
      onCreateThread,
      send,
      t,
    ],
  );

  const handleCancel = useCallback(async () => {
    if (!activeThreadId) {
      return;
    }
    const hasThreadControl = await ensureThreadControl(activeThreadId);
    if (!hasThreadControl) {
      toast.error(t("app:remoteAttach.control.takeControlFailed"));
      return;
    }
    await cancel();
  }, [activeThreadId, cancel, ensureThreadControl, t]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <MessageSquare size={16} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            {activeRepoName
              ? t("app:remoteAttach.chat.repoTitle", { name: activeRepoName })
              : t("app:remoteAttach.chat.workspaceTitle")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {activeThreadId
              ? t("app:remoteAttach.chat.threadReady")
              : t("app:remoteAttach.chat.threadMissing")}
          </div>
        </div>
        {streaming ? (
          <button
            type="button"
            className="btn btn-outline"
            disabled={!activeThreadId || !canSendToThread}
            onClick={() => void handleCancel()}
          >
            {t("chat:panel.stop")}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="git-error-bar">
          <span style={{ flex: 1 }}>{error}</span>
        </div>
      ) : null}

      {hasOlderMessages ? (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <button
            type="button"
            className="btn btn-outline"
            style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
            disabled={loadingOlderMessages}
            onClick={() => void loadOlderMessages()}
          >
            {loadingOlderMessages ? <Loader2 size={13} className="git-spin" /> : null}
            {t("app:remoteAttach.chat.loadOlder")}
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {messages.length === 0 ? (
          <div className="git-empty" style={{ height: "100%" }}>
            <div className="git-empty-icon-box">
              <MessageSquare size={20} />
            </div>
            <p className="git-empty-title">{t("app:remoteAttach.chat.emptyTitle")}</p>
            <p className="git-empty-sub">{t("app:remoteAttach.chat.emptyHint")}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                background:
                  message.role === "assistant"
                    ? "rgba(96, 165, 250, 0.05)"
                    : "var(--panel-bg-elev-1)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-3)",
                  }}
                >
                  {message.role === "assistant"
                    ? t("app:remoteAttach.chat.assistant")
                    : t("app:remoteAttach.chat.user")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {new Date(message.createdAt).toLocaleString(i18n.language)}
                </div>
              </div>
              <div style={{ padding: "8px 0" }}>
                <MessageBlocks
                  blocks={messageBlocks(message)}
                  status={message.status}
                  engineId={message.turnEngineId ?? undefined}
                  onApproval={(approvalId, response) => {
                    void handleApproval(approvalId, response);
                  }}
                  onLoadActionOutput={(actionId) => hydrateActionOutput(message.id, actionId)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        style={{
          padding: "12px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={composerDisabled}
          placeholder={
            composerDisabled
              ? t("app:remoteAttach.chat.takeControlPlaceholder")
              : t("chat:panel.placeholders.chat")
          }
          style={{
            width: "100%",
            minHeight: 96,
            resize: "vertical",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--panel-bg-elev-1)",
            color: "var(--text-1)",
            padding: "12px",
            font: "inherit",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {activeThreadId
              ? t("app:remoteAttach.chat.sendingToThread")
              : t("app:remoteAttach.chat.creatingThread")}
          </span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={composerDisabled || !input.trim()}
          >
            {t("chat:panel.send")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RemoteAttachApp() {
  const { t } = useTranslation("app");
  const bootstrapState = useMemo(() => parseRemoteBootstrapState(), []);
  const autoConnectTriedRef = useRef(false);
  const transportRef = useRef<RemotePanesTransport | null>(null);
  const [remoteUrl, setRemoteUrl] = useState(bootstrapState.url);
  const [token, setToken] = useState(bootstrapState.token);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [grant, setGrant] = useState<RemoteDeviceGrant | null>(null);

  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    repos,
    activeRepoId,
    setActiveRepo,
  } = useWorkspaceStore();
  const workspaceThreads = useThreadStore((state) =>
    selectWorkspaceThreads(state.threadsByWorkspace, activeWorkspaceId),
  );
  const activeThreadId = useThreadStore((state) => state.activeThreadId);
  const setActiveThread = useThreadStore((state) => state.setActiveThread);
  const createThread = useThreadStore((state) => state.createThread);
  const refreshThreads = useThreadStore((state) => state.refreshThreads);
  const chatThreadId = useChatStore((state) => state.threadId);
  const bindChatThread = useChatStore((state) => state.setActiveThread);
  const setRemoteAttachMode = useTerminalStore((state) => state.setRemoteAttachMode);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeRepo = repos.find((repo) => repo.id === activeRepoId) ?? null;
  const activeThread =
    workspaceThreads.find((thread) => thread.id === activeThreadId) ?? workspaceThreads[0] ?? null;

  const controller = useRemoteController(grant, activeWorkspaceId, activeThread?.id ?? null);

  useEffect(() => {
    setRemoteAttachMode(true);
    return () => {
      setRemoteAttachMode(false);
    };
  }, [setRemoteAttachMode]);

  const connect = useCallback(
    async (urlValue: string, tokenValue: string) => {
      const normalizedUrl = normalizeRemoteUrl(urlValue);
      const normalizedToken = tokenValue.trim();
      if (!normalizedUrl || !normalizedToken) {
        setConnectionError(t("remoteAttach.connection.missingFields"));
        return;
      }

      setConnecting(true);
      setConnectionError(null);

      try {
        await controller.releaseControl();
        transportRef.current?.close(1000, "reconnect");
      } catch {
        // ignore cleanup errors
      }
      resetPanesTransport();

      const transport = createRemoteTransport(normalizedUrl, { authToken: normalizedToken });
      transportRef.current = transport;
      setPanesTransport(transport);

      try {
        const nextGrant = await ipc.getAuthenticatedRemoteDeviceGrant();
        await bootstrapRemoteStores();
        localStorage.setItem(REMOTE_URL_STORAGE_KEY, normalizedUrl);
        setGrant(nextGrant);
      } catch (error) {
        transport.close(4000, "connect_failed");
        transportRef.current = null;
        resetPanesTransport();
        setGrant(null);
        setConnectionError(String(error));
      } finally {
        setConnecting(false);
      }
    },
    [controller, t],
  );

  const disconnect = useCallback(async () => {
    await controller.releaseControl();
    transportRef.current?.close(1000, "user_disconnect");
    transportRef.current = null;
    resetPanesTransport();
    setGrant(null);
  }, [controller]);

  useEffect(() => {
    if (
      bootstrapState.mode !== "remote" ||
      autoConnectTriedRef.current ||
      !bootstrapState.autoConnect
    ) {
      return;
    }
    autoConnectTriedRef.current = true;
    void connect(bootstrapState.url, bootstrapState.token);
  }, [bootstrapState, connect]);

  useEffect(() => {
    if (!grant) {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenThreadUpdated(({ workspaceId, thread }) => {
      if (thread && useThreadStore.getState().applyThreadUpdateLocal(thread)) {
        return;
      }
      void useThreadStore.getState().refreshThreads(workspaceId);
    }).then((stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [grant]);

  useEffect(() => {
    if (!grant || activeWorkspaceId || workspaces.length === 0) {
      return;
    }
    void setActiveWorkspace(workspaces[0].id);
  }, [activeWorkspaceId, grant, setActiveWorkspace, workspaces]);

  useEffect(() => {
    if (!grant || !activeWorkspaceId) {
      return;
    }
    void refreshThreads(activeWorkspaceId);
  }, [activeWorkspaceId, grant, refreshThreads]);

  useEffect(() => {
    const nextThreadId = activeThread?.id ?? null;
    if (nextThreadId !== activeThreadId) {
      setActiveThread(nextThreadId);
    }
    if (chatThreadId !== nextThreadId) {
      void bindChatThread(nextThreadId);
    }
  }, [activeThread, activeThreadId, bindChatThread, chatThreadId, setActiveThread]);

  const handleCreateThread = useCallback(async (): Promise<string | null> => {
    if (!activeWorkspaceId) {
      return null;
    }
    const threadId = await createThread({
      workspaceId: activeWorkspaceId,
      repoId: activeRepo?.id ?? null,
      title: activeRepo
        ? t("remoteAttach.threadTitle.repo", { name: activeRepo.name })
        : t("remoteAttach.threadTitle.workspace"),
    });
    if (!threadId) {
      return null;
    }
    setActiveThread(threadId);
    await bindChatThread(threadId);
    await controller.ensureThreadControl(threadId);
    return threadId;
  }, [activeRepo, activeWorkspaceId, bindChatThread, controller, createThread, setActiveThread, t]);

  if (bootstrapState.mode !== "remote" && !grant) {
    return null;
  }

  if (!grant) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "32px 20px",
          background:
            "radial-gradient(circle at top left, rgba(96,165,250,0.12), transparent 38%), radial-gradient(circle at bottom right, rgba(34,197,94,0.1), transparent 42%), var(--bg-app)",
        }}
      >
        <div
          style={{
            width: "min(540px, 100%)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--panel-bg-elev-1)",
            boxShadow: "var(--shadow-3)",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                display: "grid",
                placeItems: "center",
                background: "rgba(96, 165, 250, 0.12)",
                color: "var(--accent)",
              }}
            >
              <PlugZap size={18} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, color: "var(--text-1)" }}>
                {t("remoteAttach.connection.title")}
              </h1>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-3)" }}>
                {t("remoteAttach.connection.subtitle")}
              </p>
            </div>
          </div>

          {connectionError ? (
            <div className="git-error-bar">
              <span>{connectionError}</span>
            </div>
          ) : null}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void connect(remoteUrl, token);
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                {t("remoteAttach.connection.urlLabel")}
              </span>
              <input
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="ws://127.0.0.1:9000"
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--panel-bg-elev-2)",
                  color: "var(--text-1)",
                  padding: "11px 12px",
                  font: "inherit",
                }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                {t("remoteAttach.connection.tokenLabel")}
              </span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={t("remoteAttach.connection.tokenPlaceholder")}
                style={{
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border)",
                  background: "var(--panel-bg-elev-2)",
                  color: "var(--text-1)",
                  padding: "11px 12px",
                  font: "inherit",
                }}
              />
            </label>

            <button type="submit" className="btn btn-primary" disabled={connecting}>
              {connecting ? <Loader2 size={14} className="git-spin" /> : <Link2 size={14} />}
              {connecting
                ? t("remoteAttach.connection.connecting")
                : t("remoteAttach.connection.connect")}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-app)",
      }}
    >
      <div
        style={{
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: "rgba(96, 165, 250, 0.12)",
              color: "var(--accent)",
            }}
          >
            <Link2 size={16} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
              {t("remoteAttach.shell.title")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)" }}>
              {t("remoteAttach.shell.connectedAs", { label: grant.label })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: controller.hasWorkspaceControl
                ? "rgba(34, 197, 94, 0.12)"
                : "rgba(245, 158, 11, 0.12)",
              color: controller.hasWorkspaceControl ? "var(--success)" : "var(--warning)",
            }}
          >
            {controller.hasWorkspaceControl ? <Shield size={12} /> : <ShieldOff size={12} />}
            {controller.hasWorkspaceControl
              ? t("remoteAttach.control.active")
              : t("remoteAttach.control.viewer")}
          </span>

          {controller.controlError ? (
            <span style={{ fontSize: 11, color: "var(--danger)" }}>{controller.controlError}</span>
          ) : null}

          {controller.hasWorkspaceControl ? (
            <button type="button" className="btn btn-outline" onClick={() => void controller.releaseControl()}>
              {t("remoteAttach.control.release")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void controller.requestControl()}>
              {t("remoteAttach.control.take")}
            </button>
          )}

          <button type="button" className="btn btn-ghost" onClick={() => void bootstrapRemoteStores()}>
            <RefreshCw size={13} />
            {t("remoteAttach.shell.refresh")}
          </button>

          <button type="button" className="btn btn-ghost" onClick={() => void disconnect()}>
            {t("remoteAttach.shell.disconnect")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <PanelGroup direction="horizontal" style={{ height: "100%" }}>
          <Panel defaultSize={22} minSize={18}>
            <aside
              style={{
                height: "100%",
                minHeight: 0,
                overflow: "auto",
                borderRight: "1px solid var(--border)",
                background: "var(--panel-bg-elev-1)",
              }}
            >
              <div style={{ padding: "14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {t("remoteAttach.workspaces.title")}
                </div>
              </div>

              <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
                {workspaces.map((workspace) => {
                  const active = workspace.id === activeWorkspaceId;
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => void setActiveWorkspace(workspace.id)}
                      style={{
                        textAlign: "left",
                        padding: "12px",
                        borderRadius: "var(--radius-md)",
                        border: active
                          ? "1px solid rgba(96, 165, 250, 0.35)"
                          : "1px solid var(--border)",
                        background: active ? "rgba(96, 165, 250, 0.08)" : "transparent",
                        color: "var(--text-1)",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {workspace.name}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "var(--text-3)",
                          fontFamily: '"JetBrains Mono", monospace',
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={workspace.rootPath}
                      >
                        {workspace.rootPath}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div style={{ padding: "14px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {t("remoteAttach.threads.title")}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!activeWorkspaceId || !controller.hasWorkspaceControl}
                    onClick={() => void handleCreateThread()}
                  >
                    {t("remoteAttach.threads.new")}
                  </button>
                </div>

                {repos.length > 0 ? (
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {t("remoteAttach.threads.repoScope")}
                    </span>
                    <select
                      value={activeRepoId ?? ""}
                      onChange={(event) => setActiveRepo(event.target.value || null)}
                      style={{
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: "var(--panel-bg-elev-2)",
                        color: "var(--text-1)",
                        padding: "9px 10px",
                        font: "inherit",
                      }}
                    >
                      {repos.map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
                {workspaceThreads.length === 0 ? (
                  <div className="git-empty" style={{ padding: "24px 10px" }}>
                    <div className="git-empty-icon-box">
                      <MessageSquare size={18} />
                    </div>
                    <p className="git-empty-title">{t("remoteAttach.threads.emptyTitle")}</p>
                    <p className="git-empty-sub">{t("remoteAttach.threads.emptyHint")}</p>
                  </div>
                ) : (
                  workspaceThreads.map((thread) => {
                    const active = thread.id === activeThread?.id;
                    return (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setActiveThread(thread.id)}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          borderRadius: "var(--radius-md)",
                          border: active
                            ? "1px solid rgba(96, 165, 250, 0.35)"
                            : "1px solid var(--border)",
                          background: active ? "rgba(96, 165, 250, 0.08)" : "transparent",
                          color: "var(--text-1)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 999,
                              flexShrink: 0,
                              background:
                                thread.status === "streaming"
                                  ? "var(--accent)"
                                  : thread.status === "awaiting_approval"
                                    ? "var(--warning)"
                                    : "var(--border-strong)",
                            }}
                          />
                          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {thread.title}
                          </span>
                        </div>
                        <div style={{ marginTop: 5, fontSize: 10.5, color: "var(--text-3)" }}>
                          {new Date(thread.lastActivityAt).toLocaleString()}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={48} minSize={30}>
            <PanelGroup direction="vertical" style={{ height: "100%" }}>
              <Panel defaultSize={58} minSize={28}>
                <RemoteChatPane
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThread?.id ?? null}
                  activeRepoName={activeRepo?.name ?? null}
                  canCreateThread={controller.hasWorkspaceControl}
                  canSendToThread={controller.hasThreadControl}
                  ensureWorkspaceControl={controller.ensureWorkspaceControl}
                  ensureThreadControl={controller.ensureThreadControl}
                  onCreateThread={handleCreateThread}
                />
              </Panel>

              <PanelResizeHandle className="resize-handle" />

              <Panel defaultSize={42} minSize={24}>
                <div style={{ height: "100%", minHeight: 0, position: "relative" }}>
                  {activeWorkspaceId ? (
                    <>
                      <div
                        style={{
                          padding: "12px 14px",
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <SquareTerminal size={16} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                          {t("remoteAttach.terminal.title")}
                        </div>
                      </div>
                      <div
                        style={{
                          height: "calc(100% - 49px)",
                          opacity: controller.hasWorkspaceControl ? 1 : 0.85,
                        }}
                      >
                        <TerminalPanel workspaceId={activeWorkspaceId} />
                      </div>
                      {!controller.hasWorkspaceControl ? (
                        <div
                          style={{
                            position: "absolute",
                            inset: "49px 14px 14px",
                            display: "grid",
                            placeItems: "center",
                            pointerEvents: "none",
                          }}
                        >
                          <div
                            style={{
                              padding: "10px 12px",
                              borderRadius: "var(--radius-md)",
                              border: "1px solid var(--border)",
                              background: "rgba(15, 23, 42, 0.75)",
                              color: "white",
                              fontSize: 12,
                            }}
                          >
                            {t("remoteAttach.terminal.readOnly")}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="git-empty" style={{ height: "100%" }}>
                      <div className="git-empty-icon-box">
                        <SquareTerminal size={20} />
                      </div>
                      <p className="git-empty-title">{t("remoteAttach.terminal.emptyTitle")}</p>
                      <p className="git-empty-sub">{t("remoteAttach.terminal.emptyHint")}</p>
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="resize-handle" />

          <Panel defaultSize={30} minSize={20}>
            <RemoteGitPanel repo={activeRepo} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
