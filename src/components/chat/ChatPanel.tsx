import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { MessageBlocks } from "./MessageBlocks";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    messages,
    send,
    cancel,
    respondApproval,
    streaming,
    error,
    setActiveThread: bindChatThread,
    threadId
  } = useChatStore();
  const { repos, activeRepoId, activeWorkspaceId } = useWorkspaceStore();
  const { ensureThreadForScope, threads, activeThreadId } = useThreadStore();
  const viewportRef = useRef<HTMLDivElement>(null);

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeRepoId) ?? null,
    [repos, activeRepoId]
  );

  const activeThread = useMemo(
    () => threads.find((item) => item.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      void bindChatThread(null);
      return;
    }

    void (async () => {
      const thread = await ensureThreadForScope({
        workspaceId: activeWorkspaceId,
        repoId: activeRepo?.id ?? null,
        engineId: "codex",
        modelId: "gpt-5-codex",
        title: activeRepo ? `${activeRepo.name} Chat` : "General"
      });

      await bindChatThread(thread);
    })();
  }, [activeWorkspaceId, activeRepo?.id, activeRepo?.name, ensureThreadForScope, bindChatThread]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const nearBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 120;
    if (nearBottom) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ".") {
        event.preventDefault();
        void cancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || !threadId) {
      return;
    }

    const text = input.trim();
    setInput("");
    await send(text);
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12, padding: 16 }}>
      <div className="surface" style={{ padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Engine: {activeThread?.engineId ?? "codex"}</span>
        <span style={{ fontSize: 12, color: "var(--text-soft)" }}>
          Model: {activeThread?.modelId ?? "gpt-5-codex"}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-soft)", fontSize: 12 }}>
          Repo: {activeRepo?.name ?? "workspace"}
        </span>
      </div>

      <div ref={viewportRef} className="surface" style={{ padding: 12, overflow: "auto" }}>
        <div style={{ display: "grid", gap: 12 }}>
          {messages.map((message) => (
            <div key={message.id}>
              <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--text-soft)" }}>{message.role}</p>
              <MessageBlocks
                blocks={message.blocks}
                onApproval={(approvalId, decision) =>
                  void respondApproval(approvalId, {
                    decision,
                    engine: activeThread?.engineId ?? "codex",
                    model: activeThread?.modelId ?? "gpt-5-codex"
                  })
                }
              />
            </div>
          ))}
          {messages.length === 0 && (
            <p style={{ margin: 0, color: "var(--text-soft)" }}>
              Open a folder and send a message to start working with Codex.
            </p>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="surface" style={{ padding: 10, display: "grid", gap: 8 }}>
        <textarea
          rows={4}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void onSubmit(event);
            }
          }}
          placeholder="Ask Codex to inspect, edit, or run tasks in this repo..."
          style={{ width: "100%", resize: "vertical" }}
          disabled={!threadId}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void cancel()} disabled={!streaming || !threadId}>
            Cancel (Cmd+.)
          </button>
          <button type="submit" disabled={!threadId}>
            Send (Cmd+Enter)
          </button>
        </div>
        {error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{error}</p>}
      </form>
    </div>
  );
}
