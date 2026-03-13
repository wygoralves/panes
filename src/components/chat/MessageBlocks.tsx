import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ChevronRight,
  FileCode2,
  FileDiff,
  Terminal,
  Shield,
  Loader2,
  XCircle,
  Brain,
  FileText,
  Image,
  File,
  Info,
} from "lucide-react";
import type {
  ActionBlock,
  ApprovalBlock,
  ApprovalResponse,
  AttachmentBlock,
  ContentBlock,
  DiffBlock,
  MessageStatus,
  NoticeBlock,
  ThinkingBlock,
} from "../../types";
import { ToolInputQuestionnaire } from "./ToolInputQuestionnaire";
import {
  buildDynamicToolCallResponse,
  defaultAdvancedApprovalPayload,
  isDynamicToolCallApproval,
  isMcpElicitationApproval,
  isPermissionsRequestApproval,
  isRequestUserInputApproval,
  parseApprovalCommand,
  parseApprovalReason,
  parseDynamicToolCallArguments,
  parseDynamicToolCallName,
  parseMcpElicitationMessage,
  parseMcpElicitationMode,
  parseMcpElicitationSchema,
  parseMcpElicitationServerName,
  parseMcpElicitationUrl,
  parseProposedExecpolicyAmendment,
  parseProposedNetworkPolicyAmendments,
  parseRequestedPermissions,
  parseToolInputQuestions,
  requiresCustomApprovalPayload,
} from "./toolInputApproval";
import {
  extractDiffFilename,
} from "../../lib/parseDiff";
import { getMessageBlockKey } from "./messageBlockKeys";
import {
  VirtualizedDiffBody,
  useParsedDiff,
} from "../shared/DiffViewer";

const MarkdownContent = lazy(() => import("./MarkdownContent"));
interface Props {
  blocks?: ContentBlock[];
  status?: MessageStatus;
  engineId?: string;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
  onLoadActionOutput?: (actionId: string) => Promise<void>;
}

function isBlockLike(value: unknown): value is { type: string } {
  return typeof value === "object" && value !== null && "type" in value;
}

const actionIcons: Record<string, typeof Terminal> = {
  command: Terminal,
  file_write: FileCode2,
  file_edit: FileCode2,
  file_read: FileCode2,
  file_delete: FileCode2,
};

/* ── Diff Block ── */

function MessageDiffBlock({ block, defaultExpanded }: { block: DiffBlock; defaultExpanded: boolean }) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(defaultExpanded);
  const raw = String(block.diff ?? "");
  const fallbackFilename = useMemo(() => extractDiffFilename(raw), [raw]);
  const {
    parseResult,
    loading: loadingParse,
    parseAttempted,
  } = useParsedDiff(raw, {
    enabled: expanded,
  });
  const filename = parseResult?.filename ?? fallbackFilename;
  const adds = parseResult?.adds ?? 0;
  const dels = parseResult?.dels ?? 0;

  return (
    <div>
      <div className="msg-block-header" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight
          size={11}
          className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
        />
        <FileDiff size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {filename ?? t("messageBlocks.diffFallback", { scope: String(block.scope ?? "turn") })}
        </span>
        {loadingParse && (
          <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
            {t("messageBlocks.parsing")}
          </span>
        )}
        {(adds > 0 || dels > 0) && (
          <span style={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', display: "flex", gap: 5, flexShrink: 0 }}>
            {adds > 0 && <span style={{ color: "var(--success)" }}>+{adds}</span>}
            {dels > 0 && <span style={{ color: "var(--danger)" }}>-{dels}</span>}
          </span>
        )}
      </div>
      {expanded && (
        !parseResult && (loadingParse || !parseAttempted) ? (
          <div style={{ padding: "4px 14px", fontSize: 11.5, color: "var(--text-3)" }}>
            {t("messageBlocks.parsingDiff")}
          </div>
        ) : parseResult && parseResult.parsed.length > 0 ? (
          <div style={{
            margin: "2px 12px 4px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--code-bg)",
          }}>
            <VirtualizedDiffBody parsed={parseResult.parsed} />
          </div>
        ) : (
          <div style={{ padding: "4px 14px", fontSize: 11.5, color: "var(--text-3)" }}>
            {t("messageBlocks.noChanges")}
          </div>
        )
      )}
    </div>
  );
}

/* ── Thinking Block ── */

function ThinkingBlockView({ block, isStreaming }: { block: ThinkingBlock; isStreaming: boolean }) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const content = String(block.content ?? "");

  return (
    <div>
      <div className="msg-block-header" onClick={() => setExpanded((v) => !v)}>
        <ChevronRight
          size={11}
          className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
        />
        <Brain
          size={12}
          className={isStreaming ? "thinking-icon-active" : undefined}
          style={isStreaming ? { color: "var(--info)", flexShrink: 0 } : { color: "var(--info)", opacity: 0.45, flexShrink: 0 }}
        />
        <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
          {t("messageBlocks.thinking")}
          {isStreaming ? "\u2026" : ""}
        </span>
      </div>
      {expanded && (
        isStreaming ? (
          <pre
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--text-2)",
              padding: "2px 12px 8px 30px",
              minWidth: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
            }}
          >
            {content}
          </pre>
        ) : (
          <Suspense
            fallback={
              <pre
                style={{
                  margin: 0,
                  fontSize: 12.5,
                  color: "var(--text-2)",
                  padding: "2px 12px 8px 30px",
                  minWidth: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                }}
              >
                {content}
              </pre>
            }
          >
            <MarkdownContent
              content={content}
              className="prose"
              style={{
                fontSize: 12.5,
                color: "var(--text-2)",
                padding: "2px 12px 8px 30px",
                minWidth: 0,
              }}
            />
          </Suspense>
        )
      )}
    </div>
  );
}

function NoticeBlockView({ block }: { block: NoticeBlock }) {
  return (
    <div
      style={{
        margin: "2px 12px 8px",
        padding: "9px 12px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid rgba(96, 165, 250, 0.16)",
        background: "rgba(96, 165, 250, 0.08)",
        color: "var(--text-2)",
        fontSize: 12,
        lineHeight: 1.5,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <Info size={14} style={{ flexShrink: 0, color: "var(--info)", marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--info)", marginBottom: 2 }}>
          {block.title}
        </div>
        <div>{block.message}</div>
      </div>
    </div>
  );
}

/* ── Action Block ── */

function ActionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("chat");
  if (status === "done") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--success)", fontSize: 10, opacity: 0.7 }}>
        <CheckCircle2 size={11} />
        {t("messageBlocks.actionStatus.done")}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--warning)", fontSize: 10, fontWeight: 500 }}>
        <Loader2 size={11} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
        {t("messageBlocks.actionStatus.running")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--danger)", fontSize: 10 }}>
        <XCircle size={11} />
        {t("messageBlocks.actionStatus.error")}
      </span>
    );
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--text-3)", fontSize: 10 }}>
      <Circle size={11} />
      {t("messageBlocks.actionStatus.pending")}
    </span>
  );
}

function ActionBlockView({
  block,
  onLoadDeferredOutput,
}: {
  block: ActionBlock;
  onLoadDeferredOutput?: () => Promise<void>;
}) {
  const { t } = useTranslation("chat");
  const outputChunks = Array.isArray(block.outputChunks) ? block.outputChunks : [];
  const outputDeferred = block.outputDeferred === true;
  const outputText = useMemo(
    () => {
      if (outputChunks.length === 0) {
        return "";
      }
      if (outputChunks.length === 1) {
        const firstContent = outputChunks[0].content;
        return typeof firstContent === "string" ? firstContent : String(firstContent ?? "");
      }
      return outputChunks.map((chunk) => String(chunk.content ?? "")).join("");
    },
    [outputChunks],
  );
  const Icon = actionIcons[block.actionType] ?? Terminal;
  const isRunning = block.status === "running";
  const isPending = block.status === "pending";
  const hasBody = outputChunks.length > 0 || Boolean(block.result?.error) || outputDeferred;
  const actionDetails = (block.details ?? {}) as Record<string, unknown>;
  const outputTruncated =
    "outputTruncated" in actionDetails && actionDetails.outputTruncated === true;
  const progressMessage =
    actionDetails.progressKind === "mcp" && typeof actionDetails.progressMessage === "string"
      ? actionDetails.progressMessage
      : null;
  const [expanded, setExpanded] = useState(isRunning || isPending);
  const [loadingDeferredOutput, setLoadingDeferredOutput] = useState(false);
  const [deferredOutputError, setDeferredOutputError] = useState<string | null>(null);
  const deferredOutputRequestedRef = useRef(false);
  const canToggle = hasBody;

  const requestDeferredOutput = useCallback(() => {
    if (!onLoadDeferredOutput || deferredOutputRequestedRef.current) {
      return;
    }

    deferredOutputRequestedRef.current = true;
    setLoadingDeferredOutput(true);
    setDeferredOutputError(null);
    onLoadDeferredOutput()
      .catch((error) => {
        deferredOutputRequestedRef.current = false;
        setDeferredOutputError(String(error));
      })
      .finally(() => {
        setLoadingDeferredOutput(false);
      });
  }, [onLoadDeferredOutput]);

  useEffect(() => {
    if (!expanded || !outputDeferred || outputChunks.length > 0) {
      return;
    }
    requestDeferredOutput();
  }, [expanded, outputDeferred, outputChunks.length, requestDeferredOutput]);

  useEffect(() => {
    if (!outputDeferred || outputChunks.length > 0) {
      deferredOutputRequestedRef.current = false;
    }
  }, [outputDeferred, outputChunks.length]);

  return (
    <div>
      <div
        className={canToggle ? "msg-block-header" : undefined}
        style={canToggle ? undefined : { display: "flex", alignItems: "center", gap: 6, padding: "3px 12px" }}
        onClick={canToggle ? () => setExpanded((v) => !v) : undefined}
      >
        {canToggle && (
          <ChevronRight
            size={11}
            className={`msg-block-chevron${expanded ? " msg-block-chevron-open" : ""}`}
          />
        )}
        <Icon size={12} style={{ color: "var(--text-3)", flexShrink: 0, opacity: 0.7 }} />
        <span style={{ fontSize: 11.5, color: "var(--text-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {block.summary}
        </span>
        <ActionStatusBadge status={block.status} />
      </div>

      {progressMessage && (
        <div
          style={{
            padding: "0 12px 6px 30px",
            fontSize: 11,
            color: "var(--text-3)",
            lineHeight: 1.5,
          }}
        >
          {progressMessage}
        </div>
      )}

      {expanded && (outputChunks.length > 0 || block.result?.error || outputDeferred) && (
        <div style={{
          margin: "2px 12px 4px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}>
          {outputDeferred && outputChunks.length === 0 && (
            <div
              style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--code-bg)",
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "var(--text-3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {loadingDeferredOutput && (
                  <Loader2 size={12} style={{ animation: "pulse-soft 1s ease-in-out infinite" }} />
                )}
                {loadingDeferredOutput
                  ? t("messageBlocks.deferredOutput.loadingFull")
                  : deferredOutputError
                    ? t("messageBlocks.deferredOutput.failed")
                    : t("messageBlocks.deferredOutput.loading")}
              </span>
              {!loadingDeferredOutput && deferredOutputError && onLoadDeferredOutput && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deferredOutputRequestedRef.current = false;
                    requestDeferredOutput();
                  }}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-xs)",
                    padding: "3px 8px",
                    background: "var(--bg-2)",
                    color: "var(--text-2)",
                    fontSize: 10.5,
                    cursor: "pointer",
                  }}
                >
                  {t("messageBlocks.deferredOutput.retry")}
                </button>
              )}
            </div>
          )}

          {outputChunks.length > 0 && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                background: "var(--code-bg)",
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 160,
                color: "var(--text-2)",
              }}
            >
              {outputText}
            </pre>
          )}

          {outputTruncated && (
            <div
              style={{
                margin: 0,
                padding: "5px 12px",
                borderTop: outputChunks.length > 0 ? "1px solid var(--border)" : undefined,
                background: "rgba(148, 163, 184, 0.06)",
                fontSize: 10.5,
                color: "var(--text-3)",
              }}
            >
              {t("messageBlocks.outputTruncated")}
            </div>
          )}

          {block.result?.error && (
            <pre
              style={{
                margin: 0,
                padding: "8px 12px",
                borderTop:
                  outputChunks.length > 0 || outputTruncated
                    ? "1px solid rgba(248, 113, 113, 0.2)"
                    : undefined,
                background: "rgba(248, 113, 113, 0.06)",
                fontSize: 11.5,
                lineHeight: 1.5,
                fontFamily: '"JetBrains Mono", monospace',
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 120,
                color: "var(--danger)",
              }}
            >
              {String(block.result.error)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Approval Card ── */

const APPROVAL_INTERNAL_KEYS = new Set([
  "_serverMethod",
  "threadId",
  "thread_id",
  "turnId",
  "turn_id",
  "itemId",
  "item_id",
  "proposedExecpolicyAmendment",
  "proposed_execpolicy_amendment",
  "proposedNetworkPolicyAmendments",
  "proposed_network_policy_amendments",
  "networkApprovalContext",
  "network_approval_context",
  "questions",
  "command",
  "reason",
  "commandActions",
  "callId",
  "call_id",
  "arguments",
  "tool",
  "name",
  "permissions",
  "serverName",
  "server_name",
  "message",
  "mode",
  "url",
  "requestedSchema",
  "requested_schema",
  "elicitationId",
  "elicitation_id",
]);

function extractApprovalDetails(details: Record<string, unknown>) {
  const command = parseApprovalCommand(details);
  const reason = parseApprovalReason(details);
  const commandActions = Array.isArray(details.commandActions) ? details.commandActions : [];
  const commandActionCount = commandActions.length;
  const remainingDetails: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (!APPROVAL_INTERNAL_KEYS.has(k)) remainingDetails[k] = v;
  }
  const hasRemainingDetails = Object.keys(remainingDetails).length > 0;
  return { command, reason, commandActionCount, remainingDetails, hasRemainingDetails };
}

function ApprovalCard({
  block,
  engineId,
  onApproval,
}: {
  block: ApprovalBlock;
  engineId?: string;
  onApproval: (approvalId: string, response: ApprovalResponse) => void;
}) {
  const { t } = useTranslation("chat");
  const isPending = block.status === "pending";
  const isClaudeThread = engineId === "claude";
  const details = block.details ?? {};
  const isToolInputRequest = isRequestUserInputApproval(details);
  const isDynamicToolCall = isDynamicToolCallApproval(details);
  const isPermissionsRequest = isPermissionsRequestApproval(details);
  const isMcpElicitation = isMcpElicitationApproval(details);
  const requiresCustomPayload = requiresCustomApprovalPayload(details);
  const toolInputQuestions = isToolInputRequest ? parseToolInputQuestions(details) : [];
  const proposedExecpolicyAmendment = parseProposedExecpolicyAmendment(details);
  const proposedNetworkPolicyAmendments = parseProposedNetworkPolicyAmendments(details);
  const requestedPermissions = isPermissionsRequest ? parseRequestedPermissions(details) : null;
  const showStructuredToolInput =
    isPending && !isClaudeThread && isToolInputRequest && toolInputQuestions.length > 0;
  const showClaudeUnsupportedApproval =
    isPending &&
    isClaudeThread &&
    (isToolInputRequest ||
      isDynamicToolCall ||
      isMcpElicitation ||
      requiresCustomPayload ||
      proposedExecpolicyAmendment.length > 0 ||
      proposedNetworkPolicyAmendments.length > 0);
  const dynamicToolName = parseDynamicToolCallName(details);
  const dynamicToolArguments = parseDynamicToolCallArguments(details);
  const mcpServerName = parseMcpElicitationServerName(details);
  const mcpMessage = parseMcpElicitationMessage(details);
  const mcpMode = parseMcpElicitationMode(details);
  const mcpUrl = parseMcpElicitationUrl(details);
  const mcpSchema = parseMcpElicitationSchema(details);

  const { command, reason, commandActionCount, remainingDetails, hasRemainingDetails } =
    extractApprovalDetails(details);
  const displayReason = isMcpElicitation ? mcpMessage ?? reason : reason;

  const defaultAdvancedPayload = useMemo(
    () => JSON.stringify(defaultAdvancedApprovalPayload(details), null, 2),
    [details],
  );
  const [advancedJsonPayload, setAdvancedJsonPayload] = useState(defaultAdvancedPayload);
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);
  const [showRemainingDetails, setShowRemainingDetails] = useState(false);
  const [dynamicToolSuccess, setDynamicToolSuccess] = useState(true);
  const [dynamicToolText, setDynamicToolText] = useState("");
  const [dynamicToolImageUrl, setDynamicToolImageUrl] = useState("");

  useEffect(() => {
    setAdvancedJsonPayload(defaultAdvancedPayload);
  }, [defaultAdvancedPayload, block.approvalId]);

  useEffect(() => {
    setDynamicToolSuccess(true);
    setDynamicToolText("");
    setDynamicToolImageUrl("");
  }, [block.approvalId]);

  let decisionLabel = t("messageBlocks.approval.decision.answered");
  if (block.decision === "decline") {
    decisionLabel = t("messageBlocks.approval.decision.denied");
  } else if (block.decision === "cancel") {
    decisionLabel = t("messageBlocks.approval.decision.canceled");
  } else if (block.decision === "accept" || block.decision === "accept_for_session") {
    decisionLabel = t("messageBlocks.approval.decision.approved");
  }

  let decisionBackground = "rgba(148,163,184,0.12)";
  let decisionColor = "var(--text-2)";
  if (block.decision === "decline" || block.decision === "cancel") {
    decisionBackground = "rgba(248,113,113,0.12)";
    decisionColor = "var(--danger)";
  } else if (block.decision === "accept" || block.decision === "accept_for_session") {
    decisionBackground = "rgba(52,211,153,0.12)";
    decisionColor = "var(--success)";
  }

  function submitAdvancedJsonPayload() {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(advancedJsonPayload);
    } catch (error) {
      setAdvancedJsonError(
        t("messageBlocks.approval.invalidJson", { error: String(error) }),
      );
      return;
    }

    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      setAdvancedJsonError(t("messageBlocks.approval.payloadMustBeObject"));
      return;
    }

    setAdvancedJsonError(null);
    onApproval(block.approvalId, parsedPayload as ApprovalResponse);
  }

  function submitDynamicToolResponse() {
    onApproval(
      block.approvalId,
      buildDynamicToolCallResponse(dynamicToolText, dynamicToolSuccess, dynamicToolImageUrl),
    );
  }

  return (
    <div className="acard">
      {/* Header */}
      <div className="acard-header">
        <Shield size={12} className="acard-header-icon" />
        <span className="acard-summary">{block.summary}</span>
        <span className="acard-type">{block.actionType}</span>
        {!isPending && block.decision && (
          <span
            className="acard-decision"
            style={{ background: decisionBackground, color: decisionColor }}
          >
            {decisionLabel}
          </span>
        )}
      </div>

      {/* Details */}
      {!isToolInputRequest && (command || displayReason || commandActionCount > 0 || requestedPermissions || mcpUrl || mcpSchema || hasRemainingDetails) && (
        <div className="acard-details">
          {command && (
            <pre className="acard-command">{command}</pre>
          )}
          {!command && displayReason && (
            <p className="acard-reason">{displayReason}</p>
          )}
          {isMcpElicitation && mcpServerName && (
            <p className="acard-meta">{mcpServerName}</p>
          )}
          {isMcpElicitation && mcpMode === "url" && mcpUrl && (
            <pre className="acard-command">{mcpUrl}</pre>
          )}
          {isPermissionsRequest && requestedPermissions && (
            <pre className="acard-remaining-pre">
              {JSON.stringify(requestedPermissions, null, 2)}
            </pre>
          )}
          {isMcpElicitation && mcpMode === "form" && mcpSchema && (
            <pre className="acard-remaining-pre">
              {JSON.stringify(mcpSchema, null, 2)}
            </pre>
          )}
          {commandActionCount > 0 && (
            <p className="acard-meta">
              {t("messageBlocks.approval.actionCount", { count: commandActionCount })}
            </p>
          )}
          {proposedExecpolicyAmendment.length > 0 && (
            <p className="acard-meta">
              {t("messageBlocks.approval.execPolicyAmendment", {
                value: proposedExecpolicyAmendment.join(" "),
              })}
            </p>
          )}
          {proposedNetworkPolicyAmendments.length > 0 && (
            <p className="acard-meta">
              {t("messageBlocks.approval.networkAmendment", {
                value: proposedNetworkPolicyAmendments
                  .map((amendment) => `${amendment.action} ${amendment.host}`)
                  .join(", "),
              })}
            </p>
          )}
          {isDynamicToolCall && dynamicToolName && (
            <p className="acard-meta">
              {t("messageBlocks.approval.dynamicTool", { name: dynamicToolName })}
            </p>
          )}
          {hasRemainingDetails && (
            <div className="acard-remaining">
              <button
                type="button"
                className="acard-toggle"
                onClick={() => setShowRemainingDetails((v) => !v)}
              >
                {showRemainingDetails
                  ? t("messageBlocks.approval.hideDetails")
                  : t("messageBlocks.approval.showDetails")}
              </button>
              {showRemainingDetails && (
                <pre className="acard-remaining-pre">
                  {JSON.stringify(remainingDetails, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tool input questions */}
      {isToolInputRequest && toolInputQuestions.length > 0 && (
        <div className="acard-section">
          <p className="acard-reason">
            {t("messageBlocks.approval.pendingQuestions", {
              count: toolInputQuestions.length,
            })}
          </p>
        </div>
      )}

      {showStructuredToolInput && (
        <div className="acard-section">
          <ToolInputQuestionnaire
            details={details}
            onSubmit={(response) => onApproval(block.approvalId, response)}
          />
        </div>
      )}

      {showClaudeUnsupportedApproval && (
        <div className="acard-section">
          <p className="acard-reason">
            {t("messageBlocks.approval.claudeUnsupported")}
          </p>
          <div className="acard-advanced-footer">
            <button
              type="button"
              className="approval-btn approval-btn-deny"
              onClick={() => onApproval(block.approvalId, { decision: "decline" })}
            >
              {t("panel.approvalActions.deny")}
            </button>
          </div>
        </div>
      )}

      {isPending && !isClaudeThread && isDynamicToolCall && (
        <div className="acard-section">
          <div className="acard-advanced" style={{ gap: 10 }}>
            <p className="acard-reason">
              {t("messageBlocks.approval.dynamicToolPrompt")}
            </p>
            {dynamicToolArguments && (
              <pre className="acard-remaining-pre">
                {JSON.stringify(dynamicToolArguments, null, 2)}
              </pre>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className={`approval-btn ${dynamicToolSuccess ? "approval-btn-allow" : "approval-btn-deny"}`}
                onClick={() => setDynamicToolSuccess((current) => !current)}
              >
                {dynamicToolSuccess
                  ? t("messageBlocks.approval.dynamicToolSuccess")
                  : t("messageBlocks.approval.dynamicToolFailure")}
              </button>
            </div>
            <textarea
              className="acard-textarea"
              value={dynamicToolText}
              onChange={(event) => setDynamicToolText(event.target.value)}
              rows={4}
              placeholder={t("messageBlocks.approval.toolResponsePlaceholder")}
            />
            <input
              className="acard-textarea"
              value={dynamicToolImageUrl}
              onChange={(event) => setDynamicToolImageUrl(event.target.value)}
              placeholder={t("messageBlocks.approval.imageUrlPlaceholder")}
            />
            <div className="acard-advanced-footer">
              <button
                type="button"
                className="approval-btn approval-btn-allow"
                onClick={submitDynamicToolResponse}
              >
                {t("messageBlocks.approval.sendToolResponse")}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPending && !isClaudeThread && requiresCustomPayload && !showStructuredToolInput && (
        <div className="acard-section">
          <p className="acard-reason">
            {t("messageBlocks.approval.customPayloadHint")}
          </p>
        </div>
      )}

      {/* Standard approval — no inline buttons; the approval banner handles it */}

      {/* Advanced JSON — only for custom payload requests */}
      {isPending && !isClaudeThread && requiresCustomPayload && (
        <div className="acard-section">
          <div className="acard-advanced">
            <textarea
              className="acard-textarea"
              value={advancedJsonPayload}
              onChange={(event) => {
                setAdvancedJsonPayload(event.target.value);
                if (advancedJsonError) {
                  setAdvancedJsonError(null);
                }
              }}
              rows={6}
            />
            {advancedJsonError && (
              <p className="acard-error">{advancedJsonError}</p>
            )}
            <div className="acard-advanced-footer">
              <button
                type="button"
                className="approval-btn approval-btn-allow"
                onClick={submitAdvancedJsonPayload}
              >
                {t("messageBlocks.approval.sendPayload")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

function MessageBlocksView({ blocks = [], status, engineId, onApproval, onLoadActionOutput }: Props) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];

  const lastDiffIndex = useMemo(() => {
    for (let i = safeBlocks.length - 1; i >= 0; i--) {
      const b = safeBlocks[i];
      if (isBlockLike(b) && b.type === "diff") return i;
    }
    return -1;
  }, [safeBlocks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {safeBlocks.map((rawBlock, index) => {
        if (!isBlockLike(rawBlock)) return null;
        const block = rawBlock as ContentBlock;
        const blockKey = getMessageBlockKey(block, index, safeBlocks);

        /* ── Text ── */
        if (block.type === "text") {
          const textContent = String(block.content ?? "");
          const isLastBlock = index === safeBlocks.length - 1;
          const isStreamingText = status === "streaming" && isLastBlock;

          if (isStreamingText) {
            return (
              <div
                key={blockKey}
                style={{
                  fontSize: 13,
                  padding: "4px 14px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {textContent}
              </div>
            );
          }

          return (
            <Suspense
              key={blockKey}
              fallback={
                <div
                  style={{
                    fontSize: 13,
                    padding: "4px 14px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {textContent}
                </div>
              }
            >
              <MarkdownContent
                content={textContent}
                className="prose"
                style={{ fontSize: 13, padding: "4px 14px" }}
              />
            </Suspense>
          );
        }

        /* ── Code ── */
        if (block.type === "code") {
          const lang = String(block.language ?? "text");
          return (
            <div
              key={blockKey}
              style={{
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                overflow: "hidden",
                background: "var(--code-bg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  color: "var(--text-3)",
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <FileCode2 size={12} style={{ opacity: 0.5 }} />
                {block.filename || lang}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: '"JetBrains Mono", monospace',
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                <code className={`language-${lang}`}>{String(block.content ?? "")}</code>
              </pre>
            </div>
          );
        }

        /* ── Diff ── */
        if (block.type === "diff") {
          return <MessageDiffBlock key={blockKey} block={block} defaultExpanded={index === lastDiffIndex} />;
        }

        /* ── Notice ── */
        if (block.type === "notice") {
          return <NoticeBlockView key={blockKey} block={block} />;
        }

        /* ── Action ── */
        if (block.type === "action") {
          return (
            <ActionBlockView
              key={blockKey}
              block={block}
              onLoadDeferredOutput={
                onLoadActionOutput ? () => onLoadActionOutput(block.actionId) : undefined
              }
            />
          );
        }

        /* ── Approval ── */
        if (block.type === "approval") {
          return (
            <ApprovalCard
              key={blockKey}
              block={block}
              engineId={engineId}
              onApproval={onApproval}
            />
          );
        }

        /* ── Thinking ── */
        if (block.type === "thinking") {
          const isLastBlock = index === safeBlocks.length - 1;
          const thinkingActive = status === "streaming" && isLastBlock;
          return <ThinkingBlockView key={blockKey} block={block} isStreaming={thinkingActive} />;
        }

        /* ── Attachment ── */
        if (block.type === "attachment") {
          const attachmentBlock = block as AttachmentBlock;
          const mime = attachmentBlock.mimeType ?? "";
          const AttachIcon = mime.startsWith("image/")
            ? Image
            : mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript")
              ? FileText
              : File;
          return (
            <div
              key={blockKey}
              className="chat-attachment-chip"
              style={{ margin: "2px 12px", display: "inline-flex" }}
            >
              <AttachIcon size={12} />
              <span className="chat-attachment-chip-name">{attachmentBlock.fileName}</span>
            </div>
          );
        }

        /* ── Error ── */
        if (block.type === "error") {
          return (
            <div
              key={blockKey}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(248, 113, 113, 0.15)",
                background: "rgba(248, 113, 113, 0.06)",
                color: "var(--danger)",
                fontSize: 13,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              {block.message}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
}

export const MessageBlocks = memo(
  MessageBlocksView,
  (prev, next) =>
    prev.blocks === next.blocks &&
    prev.status === next.status &&
    prev.engineId === next.engineId &&
    prev.onApproval === next.onApproval &&
    prev.onLoadActionOutput === next.onLoadActionOutput,
);
