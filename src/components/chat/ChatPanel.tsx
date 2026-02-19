import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { MessageBlocks } from "./MessageBlocks";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [engineId, setEngineId] = useState("codex");
  const [modelId, setModelId] = useState("gpt-5-codex");
  const { messages, send, cancel, bootstrap, connectStream, respondApproval, streaming, error } = useChatStore();
  const { repos, activeRepoId } = useWorkspaceStore();
  const viewportRef = useRef<HTMLDivElement>(null);

  const activeRepo = useMemo(
    () => repos.find((repo) => repo.id === activeRepoId) ?? repos[0],
    [repos, activeRepoId]
  );

  useEffect(() => {
    void bootstrap();
    void connectStream();
  }, [bootstrap, connectStream]);

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

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) {
      return;
    }

    const text = input.trim();
    setInput("");
    await send(text);
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12, padding: 16 }}>
      <div className="surface" style={{ padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
        <select value={engineId} onChange={(e) => setEngineId(e.target.value)}>
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
        </select>
        <input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          style={{ minWidth: 220 }}
          placeholder="model id"
        />
        <span style={{ marginLeft: "auto", color: "var(--text-soft)", fontSize: 12 }}>
          Repo: {activeRepo?.name ?? "none"}
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
                    engine: engineId,
                    model: modelId
                  })
                }
              />
            </div>
          ))}
          {messages.length === 0 && (
            <p style={{ margin: 0, color: "var(--text-soft)" }}>
              Start by sending a message to the active thread.
            </p>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="surface" style={{ padding: 10, display: "grid", gap: 8 }}>
        <textarea
          rows={4}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the agent to inspect, edit, or run tasks in this repo..."
          style={{ width: "100%", resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void cancel()} disabled={!streaming}>
            Cancel (Cmd+.)
          </button>
          <button type="submit">Send (Cmd+Enter)</button>
        </div>
        {error && <p style={{ margin: 0, color: "var(--danger)", fontSize: 12 }}>{error}</p>}
      </form>
    </div>
  );
}
