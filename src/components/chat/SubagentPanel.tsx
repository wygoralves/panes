import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { useThreadStore } from "../../stores/threadStore";
import {
  collectSubagents,
  subagentDisplayName,
  subagentTone,
  type SubagentEntry,
} from "../../lib/subagentBlocks";
import { activateThread } from "../../lib/threadActions";
import { MessageBlocks } from "./MessageBlocks";
import { formatElapsed, useElapsed } from "../shared/WorkingIndicator";
import type { ApprovalResponse, SubagentBlock, Thread } from "../../types";

interface Props {
  threadId: string;
  /** Opens straight into one subagent; omitted, the pane shows the list. */
  agentId?: string;
  /** Bumped by the opener so the same agent can be re-opened after going back. */
  revision?: number;
}

const SECTION_LIMIT = 8;

/**
 * A worker is identified by the message it ran in as well as its id: the same
 * Codex child thread can come back in a later message, and both entries have
 * their own transcript.
 */
interface SubagentSelection {
  agentId: string;
  /** Null when the opener knew only the agent id. */
  messageId: string | null;
}

function entryKey(entry: SubagentEntry): string {
  return `${entry.messageId}:${entry.block.agentId}`;
}

function findSelectedEntry(
  entries: SubagentEntry[],
  selection: SubagentSelection | null,
): SubagentEntry | null {
  if (!selection) return null;
  if (selection.messageId) {
    const exact = entries.find(
      (entry) =>
        entry.messageId === selection.messageId && entry.block.agentId === selection.agentId,
    );
    if (exact) return exact;
  }
  // Only an agent id: the newest run of that worker is the one on screen.
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].block.agentId === selection.agentId) return entries[index];
  }
  return null;
}

function SubagentTile({ block, size = 22 }: { block: SubagentBlock; size?: number }) {
  return (
    <span
      className={`subagent-tile msg-block-tile--${subagentTone(block.agentId)}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Bot size={Math.round(size * 0.5)} />
    </span>
  );
}

function SubagentRow({
  entry,
  onOpen,
}: {
  entry: SubagentEntry;
  onOpen: (selection: SubagentSelection) => void;
}) {
  const { t } = useTranslation("chat");
  const { block } = entry;
  const running = block.status === "running";
  const elapsed = useElapsed(block.startedAt, running);
  const name = subagentDisplayName(block, t("subagentPanel.worker"));
  const status = running
    ? block.progress ?? t("subagentPanel.working")
    : block.summary ?? t(`messageBlocks.subagent.status.${block.status}`);
  const time = running
    ? elapsed != null
      ? formatElapsed(elapsed)
      : null
    : block.durationMs != null
      ? formatElapsed(block.durationMs)
      : null;

  return (
    <button
      type="button"
      className="subagent-row"
      onClick={() => onOpen({ agentId: block.agentId, messageId: entry.messageId })}
    >
      <SubagentTile block={block} />
      <span className="subagent-row-main">
        <span className="subagent-row-name" title={name}>
          {name}
        </span>
        <span
          className={`subagent-row-status${block.status === "error" ? " subagent-row-status--error" : ""}`}
          title={status}
        >
          {status}
        </span>
      </span>
      {time ? <span className="subagent-row-time">{time}</span> : <span />}
    </button>
  );
}

function SubagentSection({
  label,
  entries,
  onOpen,
}: {
  label: string;
  entries: SubagentEntry[];
  onOpen: (selection: SubagentSelection) => void;
}) {
  const { t } = useTranslation("chat");
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, SECTION_LIMIT);
  return (
    <section className="subagent-section">
      <div className="subagent-section-head">
        <span>{label}</span>
        <span className="subagent-section-sep" aria-hidden="true" />
        <span>{entries.length}</span>
      </div>
      {visible.map((entry) => (
        <SubagentRow key={entryKey(entry)} entry={entry} onOpen={onOpen} />
      ))}
      {entries.length > SECTION_LIMIT && (
        <button
          type="button"
          className="subagent-section-toggle"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? t("subagentPanel.showLess")
            : t("subagentPanel.showAll", { count: entries.length })}
        </button>
      )}
    </section>
  );
}

function SubagentList({
  entries,
  onOpen,
}: {
  entries: SubagentEntry[];
  onOpen: (selection: SubagentSelection) => void;
}) {
  const { t } = useTranslation("chat");
  const active = entries.filter((entry) => entry.block.status === "running");
  const finished = entries.filter((entry) => entry.block.status !== "running");

  if (entries.length === 0) {
    return (
      <div className="subagent-panel-empty">
        <Bot size={18} />
        <span>{t("subagentPanel.empty")}</span>
      </div>
    );
  }

  return (
    <div className="subagent-panel-scroll">
      {active.length > 0 && (
        <SubagentSection label={t("subagentPanel.active")} entries={active} onOpen={onOpen} />
      )}
      {finished.length > 0 && (
        <SubagentSection label={t("subagentPanel.finished")} entries={finished} onOpen={onOpen} />
      )}
    </div>
  );
}

function SubagentDetail({
  entry,
  thread,
  onBack,
  onOpen,
}: {
  entry: SubagentEntry;
  thread: Thread | null;
  onBack: () => void;
  onOpen: (selection: SubagentSelection) => void;
}) {
  const { t } = useTranslation("chat");
  const { block, children, messageId } = entry;
  const running = block.status === "running";
  const elapsed = useElapsed(block.startedAt, running);
  const name = subagentDisplayName(block, t("subagentPanel.worker"));
  const bodyRef = useRef<HTMLDivElement>(null);

  // Follow the transcript while the subagent is streaming.
  useEffect(() => {
    if (!running || !bodyRef.current) return;
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [running, children.length]);

  const handleLoadActionOutput = useCallback(
    (actionId: string) => useChatStore.getState().hydrateActionOutput(messageId, actionId),
    [messageId],
  );
  const handleApproval = useCallback((approvalId: string, response: ApprovalResponse) => {
    void useChatStore.getState().respondApproval(approvalId, response);
  }, []);
  const handleOpenNested = useCallback(
    (agentId: string | null) => {
      // A nested worker lives in the same message as the one being read.
      if (agentId) onOpen({ agentId, messageId });
    },
    [messageId, onOpen],
  );

  const statusLabel = running
    ? elapsed != null
      ? formatElapsed(elapsed)
      : t("messageBlocks.subagent.status.running")
    : block.durationMs != null
      ? `${t(`messageBlocks.subagent.status.${block.status}`)} · ${formatElapsed(block.durationMs)}`
      : t(`messageBlocks.subagent.status.${block.status}`);
  const showType = Boolean(block.agentType) && block.agentType !== name;

  return (
    <div className="subagent-detail">
      <header className="subagent-detail-header">
        <button
          type="button"
          className="subagent-back"
          onClick={onBack}
          title={t("subagentPanel.back")}
          aria-label={t("subagentPanel.back")}
        >
          <ArrowLeft size={14} />
        </button>
        <SubagentTile block={block} size={20} />
        <h2 className="subagent-detail-title" title={block.description}>
          {name}
        </h2>
      </header>
      <div className="subagent-detail-meta">
        {showType && (
          <>
            <span>{block.agentType}</span>
            <span className="subagent-section-sep" aria-hidden="true" />
          </>
        )}
        <span
          className={`msg-block-status${
            running
              ? " msg-block-status--warning"
              : block.status === "error"
                ? " msg-block-status--danger"
                : ""
          }`}
        >
          {running && <Loader2 size={10} className="git-spin" />}
          {statusLabel}
        </span>
        {running && block.progress ? (
          <>
            <span className="subagent-section-sep" aria-hidden="true" />
            <span className="subagent-detail-progress" title={block.progress}>
              {block.progress}
            </span>
          </>
        ) : null}
      </div>

      <div ref={bodyRef} className="subagent-detail-body">
        {children.length > 0 ? (
          <MessageBlocks
            blocks={children}
            ownerAgentId={block.agentId}
            status={running ? "streaming" : "completed"}
            engineId={thread?.engineId}
            onApproval={handleApproval}
            onLoadActionOutput={handleLoadActionOutput}
            onOpenSubagent={handleOpenNested}
          />
        ) : (
          <div className="subagent-panel-note">
            {running ? t("subagentPanel.waiting") : t("subagentPanel.noOutput")}
          </div>
        )}
        {!running && block.summary ? (
          <div className="subagent-panel-summary">{block.summary}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The subagents of one chat: a list of who is working on what, and one
 * subagent's transcript on drill-down. Neither Codex (parent-owned V2
 * subagents reject `turn/steer`) nor the Claude SDK offers a real channel to
 * a running worker, so the pane is read-only.
 */
export function SubagentPanel({ threadId, agentId, revision }: Props) {
  const { t } = useTranslation("chat");
  const activeChatThreadId = useChatStore((state) => state.threadId);
  const messages = useChatStore((state) => state.messages);
  const thread = useThreadStore(
    (state) => state.threads.find((item) => item.id === threadId) ?? null,
  );
  const [selection, setSelection] = useState<SubagentSelection | null>(
    agentId ? { agentId, messageId: null } : null,
  );
  useEffect(() => {
    setSelection(agentId ? { agentId, messageId: null } : null);
  }, [agentId, revision]);

  const entries = useMemo(
    () => (activeChatThreadId === threadId ? collectSubagents(messages) : []),
    [activeChatThreadId, messages, threadId],
  );
  const selected = useMemo(() => findSelectedEntry(entries, selection), [entries, selection]);
  const back = useCallback(() => setSelection(null), []);

  if (activeChatThreadId !== threadId) {
    return (
      <div className="subagent-panel">
        <div className="subagent-panel-empty">
          <Bot size={18} />
          <span>{t("subagentPanel.otherThread")}</span>
          {thread && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void activateThread(thread)}
            >
              {t("subagentPanel.openChat")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selection && !selected) {
    return (
      <div className="subagent-panel">
        <div className="subagent-panel-empty">
          <Bot size={18} />
          <span>{t("subagentPanel.missing")}</span>
          <button type="button" className="btn" onClick={back}>
            {t("subagentPanel.back")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="subagent-panel">
      {selected ? (
        <SubagentDetail entry={selected} thread={thread} onBack={back} onOpen={setSelection} />
      ) : (
        <SubagentList entries={entries} onOpen={setSelection} />
      )}
    </div>
  );
}
