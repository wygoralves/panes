import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, MessageSquare, X } from "lucide-react";
import { ipc } from "../../lib/ipc";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { SearchResult } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SearchModal({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveRepo = useWorkspaceStore((s) => s.setActiveRepo);
  const threads = useThreadStore((s) => s.threads);
  const refreshThreads = useThreadStore((s) => s.refreshThreads);
  const setActiveThread = useThreadStore((s) => s.setActiveThread);
  const bindChatThread = useChatStore((s) => s.setActiveThread);

  const threadById = useMemo(() => {
    const map = new Map<string, (typeof threads)[number]>();
    for (const thread of threads) {
      map.set(thread.id, thread);
    }
    return map;
  }, [threads]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(undefined);
      setLoading(false);
      setActiveIndex(0);
      return;
    }

    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open || !activeWorkspaceId) {
      return;
    }
    void refreshThreads(activeWorkspaceId);
  }, [open, activeWorkspaceId, refreshThreads]);

  useEffect(() => {
    if (!open || !activeWorkspaceId) {
      return;
    }

    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setError(undefined);
      setLoading(false);
      setActiveIndex(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    const timer = window.setTimeout(async () => {
      try {
        const found = await ipc.searchMessages(activeWorkspaceId, term);
        if (cancelled) {
          return;
        }
        setResults(found);
        setActiveIndex(0);
      } catch (searchError) {
        if (cancelled) {
          return;
        }
        setError(String(searchError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, activeWorkspaceId]);

  async function openResult(result: SearchResult) {
    if (!activeWorkspaceId) {
      return;
    }

    await refreshThreads(activeWorkspaceId);
    const currentThreads = useThreadStore.getState().threads;
    const targetThread = currentThreads.find((thread) => thread.id === result.threadId);
    if (!targetThread) {
      return;
    }

    setActiveRepo(targetThread.repoId ?? null);
    setActiveThread(targetThread.id);
    await bindChatThread(targetThread.id);
    onClose();
  }

  if (!open) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(8, 9, 12, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "14vh 20px 20px"
      }}
      onClick={onClose}
    >
      <div
        className="surface"
        style={{
          width: "min(760px, 100%)",
          maxHeight: "70vh",
          overflow: "hidden",
          display: "grid",
          gridTemplateRows: "auto 1fr",
          boxShadow: "0 22px 70px rgba(0, 0, 0, 0.45)"
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: 12, borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid var(--border-active)",
              background: "var(--bg-2)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px"
            }}
          >
            <Search size={14} style={{ color: "var(--text-3)", flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search messages in current workspace..."
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                background: "transparent",
                color: "var(--text-1)",
                fontSize: 13
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((idx) => Math.min(idx + 1, Math.max(results.length - 1, 0)));
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((idx) => Math.max(idx - 1, 0));
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const selected = results[activeIndex];
                  if (selected) {
                    void openResult(selected);
                  }
                }
              }}
            />
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-2)",
                cursor: "pointer"
              }}
            >
              <X size={14} />
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>
            Shortcut: Cmd/Ctrl+Shift+F
          </p>
        </div>

        <div style={{ overflow: "auto" }}>
          {!activeWorkspaceId && (
            <p style={{ margin: 0, padding: 16, color: "var(--text-2)" }}>
              Select a workspace to search.
            </p>
          )}

          {activeWorkspaceId && query.trim().length < 2 && (
            <p style={{ margin: 0, padding: 16, color: "var(--text-2)" }}>
              Type at least 2 characters.
            </p>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, color: "var(--text-2)" }}>
              <Loader2 size={14} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
              Searching...
            </div>
          )}

          {!loading && error && (
            <p style={{ margin: 0, padding: 16, color: "var(--danger)" }}>{error}</p>
          )}

          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <p style={{ margin: 0, padding: 16, color: "var(--text-2)" }}>
              No results for "{query.trim()}".
            </p>
          )}

          {!loading && !error && results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {results.map((result, index) => {
                const thread = threadById.get(result.threadId);
                const active = index === activeIndex;
                return (
                  <button
                    key={`${result.messageId}-${index}`}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => void openResult(result)}
                    style={{
                      textAlign: "left",
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--border)",
                      background: active ? "rgba(14, 240, 195, 0.08)" : "transparent",
                      cursor: "pointer",
                      display: "grid",
                      gap: 4
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)", fontSize: 11.5 }}>
                      <MessageSquare size={12} />
                      {thread?.title || "Thread"}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12.5,
                        color: "var(--text-1)"
                      }}
                    >
                      {result.snippet}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
