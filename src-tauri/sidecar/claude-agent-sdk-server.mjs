#!/usr/bin/env node
// Bridges the Claude Agent SDK to a stdio-based JSON-line protocol for Panes.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

let queryFn;
const sdkModuleSpecifier = process.env.CLAUDE_AGENT_SDK_MODULE;
try {
  const sdk = sdkModuleSpecifier
    ? await import(sdkModuleSpecifier)
    : await import("@anthropic-ai/claude-agent-sdk");
  queryFn = sdk.query;
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      message: sdkModuleSpecifier
        ? `Failed to load ${sdkModuleSpecifier}: ${err.message}.`
        : `Failed to load bundled @anthropic-ai/claude-agent-sdk: ${err.message}.`,
    }) + "\n",
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const activeQueries = new Map();
const pendingApprovals = new Map();
let shuttingDown = false;
const MAX_ATTACHMENTS_PER_TURN = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 40_000;
const TOOL_OUTPUT_CHUNK_SIZE = 8_192;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "json",
  "js",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rs",
  "go",
  "css",
  "html",
  "yaml",
  "yml",
  "toml",
  "xml",
  "sql",
  "sh",
  "csv",
  "svg",
]);
const IMAGE_ATTACHMENT_MEDIA_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set(IMAGE_ATTACHMENT_MEDIA_TYPES.values());

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function chunkText(value, chunkSize) {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

function truncateTextToMaxChars(value, maxChars) {
  if ([...value].length <= maxChars) {
    return [value, false];
  }
  return [[...value].slice(0, maxChars).join(""), true];
}

function attachmentExtension(attachment) {
  const fileName = attachment?.fileName || attachment?.filePath || "";
  const extension = path.extname(fileName).replace(/^\./, "").toLowerCase();
  return extension || "";
}

function normalizeAttachmentMimeType(attachment) {
  const mimeType = attachment?.mimeType;
  return typeof mimeType === "string" && mimeType.trim()
    ? mimeType.trim().toLowerCase()
    : null;
}

function isSupportedTextMimeType(mimeType) {
  return (
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("xml") ||
    mimeType.includes("yaml") ||
    mimeType.includes("toml") ||
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("x-rust") ||
    mimeType.includes("x-python") ||
    mimeType.includes("x-go") ||
    mimeType.includes("x-shellscript") ||
    mimeType.includes("sql") ||
    mimeType.includes("csv")
  );
}

function classifyAttachment(attachment) {
  const mimeType = normalizeAttachmentMimeType(attachment);
  const extension = attachmentExtension(attachment);

  if (mimeType && SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    return {
      kind: "image",
      mediaType: mimeType,
    };
  }

  if (mimeType === "image/svg+xml") {
    return { kind: "text" };
  }

  if (mimeType && isSupportedTextMimeType(mimeType)) {
    return { kind: "text" };
  }

  if (IMAGE_ATTACHMENT_MEDIA_TYPES.has(extension)) {
    return {
      kind: "image",
      mediaType: IMAGE_ATTACHMENT_MEDIA_TYPES.get(extension),
    };
  }

  if (TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return { kind: "text" };
  }

  return null;
}

async function buildAttachmentContentBlock(attachment, cwd) {
  const resolvedPath = normalizePath(cwd, attachment?.filePath ?? attachment?.path);
  const fileName =
    (typeof attachment?.fileName === "string" && attachment.fileName.trim()) ||
    (resolvedPath ? path.basename(resolvedPath) : "attachment");

  if (!resolvedPath) {
    throw new Error(`Attachment "${fileName}" has an empty path.`);
  }

  const attachmentType = classifyAttachment(attachment);
  if (!attachmentType) {
    throw new Error(
      `Attachment "${fileName}" is not supported by the Claude sidecar. Only text and PNG/JPEG/GIF/WEBP image attachments are currently supported.`,
    );
  }

  let bytes;
  try {
    bytes = await readFile(resolvedPath);
  } catch (err) {
    throw new Error(
      `Attachment "${fileName}" could not be read at "${resolvedPath}": ${err.message || String(err)}`,
    );
  }

  const sizeBytes = Math.max(bytes.byteLength, Number(attachment?.sizeBytes) || 0);
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment "${fileName}" exceeds the 10 MB per-file limit.`);
  }

  if (attachmentType.kind === "image") {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: attachmentType.mediaType,
        data: bytes.toString("base64"),
      },
    };
  }

  const rawText = bytes.toString("utf8");
  const [truncatedText, wasTruncated] = truncateTextToMaxChars(
    rawText,
    MAX_TEXT_ATTACHMENT_CHARS,
  );
  let text = `Attached text file: ${fileName} (${resolvedPath})\n<attached-file-content>\n${truncatedText}\n</attached-file-content>`;
  if (wasTruncated) {
    text += `\n\n[Attachment content was truncated to ${MAX_TEXT_ATTACHMENT_CHARS} characters.]`;
  }

  return {
    type: "text",
    text,
  };
}

function buildPromptInput(prompt, attachments, cwd, sessionIdHint) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return prompt;
  }

  if (attachments.length > MAX_ATTACHMENTS_PER_TURN) {
    throw new Error(
      `You can attach at most ${MAX_ATTACHMENTS_PER_TURN} files per Claude turn.`,
    );
  }

  return (async function* promptWithAttachments() {
    const content = [];
    if (typeof prompt === "string" && prompt.length > 0) {
      content.push({ type: "text", text: prompt });
    }

    for (const attachment of attachments) {
      content.push(await buildAttachmentContentBlock(attachment, cwd));
    }

    if (content.length === 0) {
      throw new Error(
        "Claude turn must include either a prompt or at least one supported attachment.",
      );
    }

    yield {
      type: "user",
      message: {
        role: "user",
        content,
      },
      parent_tool_use_id: null,
      session_id: sessionIdHint || "",
    };
  })();
}

function mapToolNameToActionType(toolName) {
  switch (toolName) {
    case "Read":
      return "file_read";
    case "Write":
      return "file_write";
    case "Edit":
      return "file_edit";
    case "Bash":
      return "command";
    case "WebFetch":
      return "search";
    case "Glob":
    case "Grep":
      return "search";
    default:
      return "other";
  }
}

function summarizeTool(toolName, toolInput) {
  if (!toolInput) return toolName;
  if (toolInput.command) return `${toolName}: ${toolInput.command}`;
  if (toolInput.file_path) return `${toolName}: ${toolInput.file_path}`;
  if (toolInput.pattern) return `${toolName}: ${toolInput.pattern}`;
  if (toolInput.url) return `${toolName}: ${toolInput.url}`;
  if (toolInput.prompt) return `${toolName}: ${toolInput.prompt.slice(0, 80)}`;
  return toolName;
}

function normalizePath(cwd, value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return path.resolve(cwd, value);
}

function isWithinRoot(rootPath, targetPath) {
  const rel = path.relative(rootPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isWithinAnyRoot(roots, targetPath) {
  return roots.some((root) => isWithinRoot(root, targetPath));
}

function collectCandidatePaths(toolName, toolInput, cwd) {
  const paths = [];
  const add = (value) => {
    const normalized = normalizePath(cwd, value);
    if (normalized) {
      paths.push(normalized);
    }
  };

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      add(toolInput?.file_path ?? toolInput?.path);
      add(toolInput?.new_file_path);
      add(toolInput?.old_file_path);
      break;
    case "Glob":
    case "Grep":
      add(toolInput?.path);
      add(toolInput?.cwd);
      break;
    default:
      break;
  }

  return paths;
}

function resolvePermissionMode(approvalPolicy, allowNetwork) {
  switch (approvalPolicy) {
    case "restricted":
    case "standard":
    case "trusted":
      return approvalPolicy;
    case "untrusted":
      return "restricted";
    case "never":
      return "trusted";
    case "on-failure":
      return "standard";
    case "on-request":
    default:
      return allowNetwork ? "trusted" : "standard";
  }
}

function requiresApproval(permissionMode, toolName) {
  if (permissionMode === "trusted") {
    return false;
  }
  if (permissionMode === "restricted") {
    return true;
  }
  return !["Read", "Glob", "Grep", "ExitPlanMode", "EnterPlanMode"].includes(toolName);
}

function createQueryContext(id) {
  return {
    id,
    query: null,
    actionCounter: 0,
    actionIdsByToolUseId: new Map(),
    streamToolUseIdsByIndex: new Map(),
    suppressedToolUseIds: new Set(),
    pendingApprovalIds: new Set(),
    cancelled: false,
    turnCompleted: false,
    sessionId: null,
    tokenUsage: null,
    stopReason: null,
  };
}

function setContextSessionId(context, sessionId) {
  if (typeof sessionId === "string" && sessionId.length > 0) {
    context.sessionId = sessionId;
  }
}

function updateContextTokenUsage(context, tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object" || Array.isArray(tokenUsage)) {
    return;
  }

  const input = Number(tokenUsage.input);
  const output = Number(tokenUsage.output);
  if (!Number.isFinite(input) && !Number.isFinite(output)) {
    return;
  }

  context.tokenUsage = {
    input: Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0,
    output: Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0,
  };
}

function emitTurnCompleted(context, status) {
  if (context.turnCompleted) {
    return;
  }

  context.turnCompleted = true;
  const payload = {
    id: context.id,
    type: "turn_completed",
    status,
    sessionId: context.sessionId,
  };
  if (context.tokenUsage) {
    payload.tokenUsage = context.tokenUsage;
  }
  if (typeof context.stopReason === "string" && context.stopReason.length > 0) {
    payload.stopReason = context.stopReason;
  }
  emit(payload);
}

function serializeToolOutput(output) {
  if (typeof output === "string") {
    return output;
  }
  if (output == null) {
    return undefined;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function getActionIdForToolUse(context, toolUseId) {
  if (typeof toolUseId === "string" && toolUseId.length > 0) {
    const actionId = context.actionIdsByToolUseId.get(toolUseId);
    context.actionIdsByToolUseId.delete(toolUseId);
    if (actionId) {
      return actionId;
    }
  }

  return `claude-action-${context.actionCounter}`;
}

function formatSdkResultError(message) {
  if (Array.isArray(message?.errors) && message.errors.length > 0) {
    return message.errors.join("\n");
  }
  if (typeof message?.subtype === "string" && message.subtype.length > 0) {
    return `Claude query failed: ${message.subtype.replaceAll("_", " ")}`;
  }
  return "Claude query failed.";
}

function cleanupPendingApprovalsForQuery(queryId, denialMessage) {
  const context = activeQueries.get(queryId);
  if (!context) {
    return;
  }

  for (const approvalId of context.pendingApprovalIds) {
    const pending = pendingApprovals.get(approvalId);
    if (!pending) {
      continue;
    }
    pendingApprovals.delete(approvalId);
    pending.resolve({
      behavior: "deny",
      message: denialMessage,
    });
  }
  context.pendingApprovalIds.clear();
}

function emitDeniedToolCompletion(context, toolUseId, errorMessage) {
  if (typeof toolUseId !== "string" || toolUseId.length === 0) {
    // toolUseId not provided by the SDK — the PreToolUse action_started
    // (if any) will remain dangling. This is a best-effort path.
    return;
  }

  const actionId = context.actionIdsByToolUseId.get(toolUseId);
  if (!actionId) {
    // Tool was denied before PreToolUse fired (e.g., content_block_start
    // no longer registers actionIds). No action_started was emitted, so
    // no action_completed is needed either.
    context.suppressedToolUseIds.add(toolUseId);
    return;
  }

  context.actionIdsByToolUseId.delete(toolUseId);
  context.suppressedToolUseIds.add(toolUseId);
  emit({
    id: context.id,
    type: "action_completed",
    actionId,
    success: false,
    error: errorMessage,
    durationMs: 0,
  });
}

function emitApprovalRequest(context, actionType, summary, details) {
  const approvalId = `${context.id}:approval:${context.pendingApprovalIds.size + 1}:${Date.now()}`;
  emit({
    id: context.id,
    type: "approval_requested",
    approvalId,
    actionType,
    summary,
    details,
  });
  return approvalId;
}

async function requestPermissionApproval(context, toolName, toolInput, suggestions = []) {
  const approvalId = emitApprovalRequest(
    context,
    mapToolNameToActionType(toolName),
    summarizeTool(toolName, toolInput),
    toolInput ?? {},
  );

  const permission = await new Promise((resolve) => {
    pendingApprovals.set(approvalId, {
      queryId: context.id,
      suggestions,
      kind: "permission",
      resolve,
    });
    context.pendingApprovalIds.add(approvalId);
  });

  context.pendingApprovalIds.delete(approvalId);
  pendingApprovals.delete(approvalId);
  return permission;
}

function buildAskUserQuestionDetails(toolInput) {
  return {
    _serverMethod: "item/tool/requestuserinput",
    questions: Array.isArray(toolInput?.questions) ? toolInput.questions : [],
  };
}

function buildAskUserQuestionSummary(toolInput) {
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  const firstQuestion = questions.find(
    (question) =>
      typeof question?.question === "string" && question.question.trim().length > 0,
  );
  if (firstQuestion) {
    return `AskUserQuestion: ${firstQuestion.question.trim()}`;
  }
  return "AskUserQuestion";
}

async function requestAskUserQuestionApproval(context, toolInput) {
  const approvalId = emitApprovalRequest(
    context,
    "other",
    buildAskUserQuestionSummary(toolInput),
    buildAskUserQuestionDetails(toolInput),
  );

  const permission = await new Promise((resolve) => {
    pendingApprovals.set(approvalId, {
      queryId: context.id,
      kind: "ask_user_question",
      toolInput,
      resolve,
    });
    context.pendingApprovalIds.add(approvalId);
  });

  context.pendingApprovalIds.delete(approvalId);
  pendingApprovals.delete(approvalId);
  return permission;
}

function normalizeAskUserQuestionAnswers(rawAnswers, questions) {
  if (
    typeof rawAnswers !== "object" ||
    rawAnswers === null ||
    Array.isArray(rawAnswers)
  ) {
    throw new Error("Claude AskUserQuestion responses require an `answers` object.");
  }

  const answers = {};
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (typeof question !== "object" || question === null || Array.isArray(question)) {
      continue;
    }

    const questionId =
      typeof question.id === "string" && question.id.trim()
        ? question.id.trim()
        : `question-${index + 1}`;
    const questionText =
      typeof question.question === "string" && question.question.trim()
        ? question.question.trim()
        : typeof question.header === "string" && question.header.trim()
          ? question.header.trim()
          : questionId;
    const answerValue = rawAnswers[questionId];
    const answerList = Array.isArray(answerValue?.answers)
      ? answerValue.answers
          .filter((value) => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];
    answers[questionText] = answerList.join(", ");
  }

  return answers;
}

function resolveAskUserQuestionResponse(response, toolInput) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Claude AskUserQuestion response must be a JSON object.");
  }

  if ("decision" in response) {
    const decision = normalizeApprovalDecision(response.decision);
    if (decision === "accept" || decision === "accept_for_session") {
      throw new Error("Claude AskUserQuestion requires `answers`, not a simple accept.");
    }
    return {
      behavior: "deny",
      message: "Claude AskUserQuestion was declined by the user.",
    };
  }

  if (!Object.prototype.hasOwnProperty.call(response, "answers")) {
    throw new Error("Claude AskUserQuestion response must include an `answers` object.");
  }

  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  return {
    behavior: "allow",
    updatedInput: {
      questions,
      answers: normalizeAskUserQuestionAnswers(response.answers, questions),
    },
  };
}

function emitToolOutputChunks(id, actionId, output) {
  const outputStr = serializeToolOutput(output);
  if (!outputStr) {
    return;
  }

  for (const content of chunkText(outputStr, TOOL_OUTPUT_CHUNK_SIZE)) {
    emit({
      id,
      type: "action_output_delta",
      actionId,
      stream: "stdout",
      content,
    });
  }
}

function buildPermissionHandler({
  context,
  cwd,
  writableRoots,
  sandboxMode,
  allowNetwork,
  approvalPolicy,
}) {
  const normalizedRoots = writableRoots.map((root) => path.resolve(root));
  const permissionMode = resolvePermissionMode(approvalPolicy, allowNetwork);

  return async (toolName, input, options) => {
    const toolInput = input ?? {};
    const toolUseId = options?.toolUseID;

    if (toolName === "AskUserQuestion") {
      const permission = await requestAskUserQuestionApproval(context, toolInput);
      if (permission.behavior === "deny") {
        emitDeniedToolCompletion(context, toolUseId, permission.message);
      }
      return permission;
    }

    if (!allowNetwork && toolName === "WebFetch") {
      const permission = {
        behavior: "deny",
        message: "Network access is disabled for this repository.",
      };
      emitDeniedToolCompletion(context, toolUseId, permission.message);
      return permission;
    }

    if (options?.blockedPath) {
      const permission = {
        behavior: "deny",
        message: `Path outside the allowed workspace scope: ${options.blockedPath}`,
      };
      emitDeniedToolCompletion(context, toolUseId, permission.message);
      return permission;
    }

    if (toolName === "Write" || toolName === "Edit") {
      if (sandboxMode === "read-only") {
        const permission = {
          behavior: "deny",
          message: "File writes are disabled for this Claude thread.",
        };
        emitDeniedToolCompletion(context, toolUseId, permission.message);
        return permission;
      }

      const candidatePaths = collectCandidatePaths(toolName, toolInput, cwd);
      if (candidatePaths.length === 0) {
        const permission = {
          behavior: "deny",
          message: "Unable to verify the target path for this write operation.",
        };
        emitDeniedToolCompletion(context, toolUseId, permission.message);
        return permission;
      }

      if (!candidatePaths.every((candidate) => isWithinAnyRoot(normalizedRoots, candidate))) {
        const permission = {
          behavior: "deny",
          message: "This file path is outside the approved writable roots for the thread.",
        };
        emitDeniedToolCompletion(context, toolUseId, permission.message);
        return permission;
      }
    }

    if (!requiresApproval(permissionMode, toolName)) {
      return { behavior: "allow" };
    }

    const permission = await requestPermissionApproval(
      context,
      toolName,
      toolInput,
      options?.suggestions,
    );
    if (permission.behavior === "deny") {
      emitDeniedToolCompletion(context, toolUseId, permission.message);
    }
    return permission;
  };
}

function normalizeApprovalDecision(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Claude approval responses require an explicit decision.");
  }

  const normalized = value.trim().toLowerCase();
  const compact = normalized.replaceAll("-", "").replaceAll("_", "");
  if (compact === "accept") {
    return "accept";
  }
  if (compact === "decline" || compact === "deny") {
    return "decline";
  }
  if (compact === "acceptforsession") {
    return "accept_for_session";
  }

  throw new Error(
    "Unsupported Claude approval decision. Expected one of: accept, decline, deny, accept_for_session.",
  );
}

function resolveApprovalDecision(response, suggestions = []) {
  const decision = normalizeApprovalDecision(response?.decision);
  if (decision === "accept") {
    return {
      behavior: "allow",
    };
  }
  if (decision === "accept_for_session") {
    return {
      behavior: "allow",
      ...(Array.isArray(suggestions) && suggestions.length > 0
        ? { updatedPermissions: suggestions }
        : {}),
    };
  }
  return {
    behavior: "deny",
    message: "Tool usage denied by the user.",
  };
}

function buildRateLimitUsageSnapshot(message) {
  const rateLimitInfo =
    typeof message?.rate_limit_info === "object" &&
    message.rate_limit_info !== null &&
    !Array.isArray(message.rate_limit_info)
      ? message.rate_limit_info
      : null;
  if (!rateLimitInfo) {
    return null;
  }

  const usage = {
    currentTokens: null,
    maxContextTokens: null,
    contextWindowPercent: null,
    fiveHourPercent:
      rateLimitInfo.rateLimitType === "five_hour" && Number.isFinite(rateLimitInfo.utilization)
        ? Math.max(0, Math.round(rateLimitInfo.utilization * 100))
        : null,
    weeklyPercent:
      String(rateLimitInfo.rateLimitType || "").startsWith("seven_day") &&
      Number.isFinite(rateLimitInfo.utilization)
        ? Math.max(0, Math.round(rateLimitInfo.utilization * 100))
        : null,
    fiveHourResetsAt:
      Number.isFinite(rateLimitInfo.resetsAt) && rateLimitInfo.rateLimitType === "five_hour"
        ? Math.round(rateLimitInfo.resetsAt)
        : null,
    weeklyResetsAt:
      Number.isFinite(rateLimitInfo.resetsAt) &&
      String(rateLimitInfo.rateLimitType || "").startsWith("seven_day")
        ? Math.round(rateLimitInfo.resetsAt)
        : null,
  };

  return Object.values(usage).some((value) => value !== null) ? usage : null;
}

function buildStatusNotice(message) {
  if (message?.type !== "system" || message?.subtype !== "status") {
    return null;
  }

  if (message.status === "compacting") {
    return {
      kind: "claude_status",
      level: "info",
      title: "Claude status",
      message: "Claude is compacting context.",
    };
  }

  return null;
}

function formatAssistantMessageError(message) {
  const errorType =
    typeof message?.error === "string" && message.error.length > 0
      ? message.error
      : "unknown";

  switch (errorType) {
    case "authentication_failed":
      return {
        errorType,
        isAuthError: true,
        message: "Claude authentication failed. Sign in again or refresh your credentials.",
        recoverable: false,
      };
    case "billing_error":
      return {
        errorType,
        isAuthError: false,
        message: "Claude rejected the request because billing or subscription access failed.",
        recoverable: false,
      };
    case "rate_limit":
      return {
        errorType,
        isAuthError: false,
        message: "Claude rate limit reached. Wait for the limit window to reset and retry.",
        recoverable: true,
      };
    case "invalid_request":
      return {
        errorType,
        isAuthError: false,
        message: "Claude rejected the request as invalid.",
        recoverable: false,
      };
    case "server_error":
      return {
        errorType,
        isAuthError: false,
        message: "Claude returned a server error.",
        recoverable: true,
      };
    case "max_output_tokens":
      return {
        errorType,
        isAuthError: false,
        message: "Claude stopped because it reached the maximum output token limit.",
        recoverable: true,
      };
    default:
      return {
        errorType,
        isAuthError: false,
        message: "Claude returned an assistant error.",
        recoverable: false,
      };
  }
}

function updateTokenUsageFromStreamEvent(context, streamEvent) {
  if (!streamEvent || typeof streamEvent !== "object" || Array.isArray(streamEvent)) {
    return;
  }

  if (streamEvent.type === "message_start") {
    updateContextTokenUsage(context, {
      input: streamEvent.message?.usage?.input_tokens,
      output: streamEvent.message?.usage?.output_tokens,
    });
    return;
  }

  if (streamEvent.type === "message_delta") {
    updateContextTokenUsage(context, {
      input: context.tokenUsage?.input ?? 0,
      output: streamEvent.usage?.output_tokens,
    });
    if (typeof streamEvent.delta?.stop_reason === "string") {
      context.stopReason = streamEvent.delta.stop_reason;
    }
  }
}

function normalizeSandboxMode(value) {
  if (value == null || value === "") {
    return "workspace-write";
  }

  if (typeof value !== "string") {
    throw new Error("Claude sandboxMode must be a string.");
  }

  const normalized = value.trim().toLowerCase();
  const compact = normalized.replaceAll("-", "").replaceAll("_", "");
  if (compact === "readonly") {
    return "read-only";
  }
  if (compact === "workspacewrite") {
    return "workspace-write";
  }
  if (compact === "dangerfullaccess") {
    throw new Error(
      "Claude does not support sandboxMode=danger-full-access. Use read-only or workspace-write.",
    );
  }

  throw new Error(
    "Unsupported Claude sandboxMode. Expected one of: read-only, workspace-write.",
  );
}

function normalizeWritableRoots(cwd, writableRoots) {
  const normalizedRoots = Array.isArray(writableRoots)
    ? writableRoots
    .map((root) => (typeof root === "string" && root.trim() ? path.resolve(root) : null))
    .filter(Boolean)
    : [];

  if (normalizedRoots.length > 0) {
    return normalizedRoots;
  }

  return [path.resolve(cwd)];
}

function additionalDirectoriesForSandbox(cwd, sandboxMode, writableRoots) {
  if (sandboxMode !== "workspace-write") {
    return [];
  }

  return writableRoots.filter((root) => root !== path.resolve(cwd));
}

function allowWriteRootsForSandbox(sandboxMode, writableRoots) {
  if (sandboxMode !== "workspace-write") {
    return [];
  }

  return writableRoots;
}

async function handleQuery(req) {
  const { id, params = {} } = req;
  const {
    prompt,
    attachments = [],
    cwd,
    model,
    allowedTools,
    systemPrompt,
    resume,
    sessionId,
    maxTurns,
    planMode,
    approvalPolicy,
    allowNetwork,
    writableRoots = [],
    sandboxMode,
    reasoningEffort,
  } = params;

  const context = createQueryContext(id);
  activeQueries.set(id, context);

  const toolList = allowedTools || [
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    ...(allowNetwork ? ["WebFetch"] : []),
  ];

  const sessionCwd = cwd || process.cwd();
  let actualSessionId = null;
  try {
    const normalizedSandboxMode = normalizeSandboxMode(sandboxMode);
    const normalizedWritableRoots = normalizeWritableRoots(sessionCwd, writableRoots);

    const options = {
      cwd: sessionCwd,
      additionalDirectories: additionalDirectoriesForSandbox(
        sessionCwd,
        normalizedSandboxMode,
        normalizedWritableRoots,
      ),
      permissionMode: planMode ? "plan" : "default",
      allowedTools: toolList,
      canUseTool: buildPermissionHandler({
        context,
        cwd: sessionCwd,
        writableRoots: normalizedWritableRoots,
        sandboxMode: normalizedSandboxMode,
        allowNetwork: Boolean(allowNetwork),
        approvalPolicy,
      }),
      settingSources: ["project"],
      sandbox: {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        filesystem: {
          allowWrite: allowWriteRootsForSandbox(
            normalizedSandboxMode,
            normalizedWritableRoots,
          ),
        },
        ...(allowNetwork
          ? {}
          : {
              network: {
                allowedDomains: [],
                allowLocalBinding: false,
                allowUnixSockets: [],
              },
            }),
      },
      settings: {
        permissions: {
          defaultMode: planMode ? "plan" : "default",
          disableBypassPermissionsMode: "disable",
        },
      },
      includePartialMessages: true,
      hooks: {
      PreToolUse: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const toolName = hookInput?.tool_name || hookInput?.name || "unknown";
              if (toolName === "AskUserQuestion") {
                return {};
              }
              const toolInput = hookInput?.tool_input || hookInput?.input || {};
              const toolUseId =
                hookInput?.tool_use_id || hookInput?.toolUseID || hookInput?.toolUseId;
              if (
                typeof toolUseId === "string" &&
                toolUseId.length > 0 &&
                context.actionIdsByToolUseId.has(toolUseId)
              ) {
                return {};
              }
              const actionId = `claude-action-${++context.actionCounter}`;
              if (typeof toolUseId === "string" && toolUseId.length > 0) {
                context.actionIdsByToolUseId.set(toolUseId, actionId);
              }

              emit({
                id,
                type: "action_started",
                actionId,
                actionType: mapToolNameToActionType(toolName),
                toolName,
                summary: summarizeTool(toolName, toolInput),
                details: toolInput,
              });

              return {};
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const toolName = hookInput?.tool_name || hookInput?.name || "unknown";
              if (toolName === "AskUserQuestion") {
                return {};
              }
              const toolUseId =
                hookInput?.tool_use_id || hookInput?.toolUseID || hookInput?.toolUseId;
              if (
                typeof toolUseId === "string" &&
                context.suppressedToolUseIds.has(toolUseId)
              ) {
                context.suppressedToolUseIds.delete(toolUseId);
                return {};
              }
              const actionId = getActionIdForToolUse(context, toolUseId);
              const output =
                hookInput?.tool_response ??
                hookInput?.tool_result ??
                hookInput?.result;
              emitToolOutputChunks(id, actionId, output);

              emit({
                id,
                type: "action_completed",
                actionId,
                success: true,
                output: serializeToolOutput(output) || undefined,
                durationMs: 0,
              });

              return {};
            },
          ],
        },
      ],
      PostToolUseFailure: [
        {
          matcher: ".*",
          hooks: [
            async (hookInput) => {
              const toolName = hookInput?.tool_name || hookInput?.name || "unknown";
              if (toolName === "AskUserQuestion") {
                return {};
              }
              const toolUseId =
                hookInput?.tool_use_id || hookInput?.toolUseID || hookInput?.toolUseId;
              if (
                typeof toolUseId === "string" &&
                context.suppressedToolUseIds.has(toolUseId)
              ) {
                context.suppressedToolUseIds.delete(toolUseId);
                return {};
              }
              const actionId = getActionIdForToolUse(context, toolUseId);

              emit({
                id,
                type: "action_completed",
                actionId,
                success: false,
                error:
                  hookInput?.error?.message ||
                  hookInput?.error ||
                  "Tool execution failed",
                durationMs: 0,
              });

              return {};
            },
          ],
        },
      ],
      },
    };

    if (model) options.model = model;
    if (systemPrompt) options.systemPrompt = systemPrompt;
    if (resume) options.resume = resume;
    if (sessionId) options.sessionId = sessionId;
    if (maxTurns) options.maxTurns = maxTurns;
    if (reasoningEffort) options.effort = reasoningEffort;

    emit({ id, type: "turn_started" });

    let sawTextDelta = false;
    let terminalStatus = "completed";
    const promptInput = buildPromptInput(
      prompt,
      attachments,
      sessionCwd,
      sessionId || resume || "",
    );
    const query = queryFn({ prompt: promptInput, options });
    context.query = query;

    for await (const message of query) {
      if (context.cancelled) {
        break;
      }

      if (message.type === "system" && message.subtype === "init") {
        actualSessionId = message.session_id;
        setContextSessionId(context, actualSessionId);
        emit({ id, type: "session_init", sessionId: actualSessionId });
      } else if (message.type === "assistant" && typeof message.error === "string") {
        const assistantError = formatAssistantMessageError(message);
        terminalStatus = "failed";
        emit({
          id,
          type: "error",
          message: assistantError.message,
          recoverable: assistantError.recoverable,
          errorType: assistantError.errorType,
          isAuthError: assistantError.isAuthError,
        });
      } else if (message.type === "rate_limit_event") {
        const usage = buildRateLimitUsageSnapshot(message);
        if (usage) {
          emit({
            id,
            type: "usage_limits_updated",
            usage,
          });
        }
      } else if (message.type === "system" && message.subtype === "status") {
        const notice = buildStatusNotice(message);
        if (notice) {
          emit({
            id,
            type: "notice",
            ...notice,
          });
        }
      } else if (message.type === "result") {
        actualSessionId = message.session_id || actualSessionId;
        setContextSessionId(context, actualSessionId);
        updateContextTokenUsage(context, {
          input: message.usage?.input_tokens,
          output: message.usage?.output_tokens,
        });
        if (message.subtype === "success") {
          if (
            typeof message.result === "string" &&
            message.result.length > 0 &&
            !sawTextDelta
          ) {
            emit({ id, type: "text_delta", content: message.result });
          }
        } else {
          terminalStatus = "failed";
          emit({
            id,
            type: "error",
            message: formatSdkResultError(message),
            recoverable: false,
          });
        }
      } else if (message.type === "stream_event") {
        const streamEvent = message.event;
        updateTokenUsageFromStreamEvent(context, streamEvent);

        if (streamEvent?.type === "content_block_start") {
          const block = streamEvent.content_block;
          if (block?.type === "tool_use") {
            const toolUseId = block.id || block.tool_use_id;
            if (
              typeof toolUseId === "string" &&
              toolUseId.length > 0
            ) {
              // Track index→toolUseId for content_block_stop, but do NOT emit
              // action_started here — block.input is empty at this point.
              // PreToolUse will emit action_started with the complete tool input.
              if (Number.isInteger(streamEvent.index)) {
                context.streamToolUseIdsByIndex.set(streamEvent.index, toolUseId);
              }
            }
          }
          continue;
        }

        if (streamEvent?.type === "content_block_stop") {
          // Clean up the index tracking. action_progress_updated is only emitted
          // if PreToolUse already registered the actionId; otherwise the tool
          // hasn't started from Panes' perspective yet and the event is skipped.
          const toolUseId = context.streamToolUseIdsByIndex.get(streamEvent.index);
          if (typeof toolUseId === "string") {
            context.streamToolUseIdsByIndex.delete(streamEvent.index);
          }
          continue;
        }

        if (
          streamEvent?.type === "message_start" ||
          streamEvent?.type === "message_delta" ||
          streamEvent?.type === "message_stop"
        ) {
          continue;
        }

        if (streamEvent?.type !== "content_block_delta") {
          continue;
        }

        const delta = streamEvent.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
          sawTextDelta = true;
          emit({ id, type: "text_delta", content: delta.text });
        } else if (
          delta?.type === "thinking_delta" &&
          typeof delta.thinking === "string" &&
          delta.thinking.length > 0
        ) {
          emit({ id, type: "thinking_delta", content: delta.thinking });
        }
      }
    }

    setContextSessionId(context, actualSessionId);
    emitTurnCompleted(context, context.cancelled ? "interrupted" : terminalStatus);
  } catch (err) {
    emit({
      id,
      type: "error",
      message: err.message || String(err),
      recoverable: false,
    });
    setContextSessionId(context, actualSessionId);
    emitTurnCompleted(context, "failed");
  } finally {
    cleanupPendingApprovalsForQuery(id, "Claude query was canceled.");
    activeQueries.delete(id);
  }
}

function handleCancel(params = {}) {
  const requestId =
    params.requestId || params.request_id || params.id || null;
  if (!requestId) {
    return;
  }

  const context = activeQueries.get(requestId);
  if (!context) {
    return;
  }

  context.cancelled = true;
  cleanupPendingApprovalsForQuery(
    requestId,
    "Claude query was canceled before approval was answered.",
  );
  context.query?.close();
}

function assertClaudeApprovalResponseShape(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Claude approval response must be a JSON object.");
  }

  const keys = Object.keys(response);
  if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(response, "decision")) {
    throw new Error(
      "Claude approval response must include only an explicit decision field.",
    );
  }

  normalizeApprovalDecision(response.decision);
}

function handleApprovalResponse(params = {}) {
  const approvalId = params.approvalId || params.approval_id;
  if (!approvalId) {
    return;
  }

  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    return;
  }

  try {
    const response = params.response || {};
    const permission =
      pending.kind === "ask_user_question"
        ? resolveAskUserQuestionResponse(response, pending.toolInput)
        : (() => {
            assertClaudeApprovalResponseShape(response);
            return resolveApprovalDecision(response, pending.suggestions);
          })();
    pendingApprovals.delete(approvalId);
    const context = activeQueries.get(pending.queryId);
    context?.pendingApprovalIds.delete(approvalId);
    pending.resolve(permission);
  } catch (error) {
    pendingApprovals.delete(approvalId);
    const context = activeQueries.get(pending.queryId);
    context?.pendingApprovalIds.delete(approvalId);
    pending.resolve({
      behavior: "deny",
      message: "Claude approval response was invalid and was denied.",
    });
    emit({
      id: pending.queryId,
      type: "error",
      message: error.message || String(error),
      recoverable: true,
    });
  }
}

function handleShutdown(signal) {
  shuttingDown = true;
  for (const context of activeQueries.values()) {
    context.cancelled = true;
    cleanupPendingApprovalsForQuery(
      context.id,
      `Claude query was interrupted by ${signal}.`,
    );
    context.query?.close?.();
    emitTurnCompleted(context, "interrupted");
  }

  rl.close();
  if (process.stdout.writableEnded) {
    process.exit(0);
  } else {
    process.stdout.end(() => process.exit(0));
  }
}

rl.on("line", (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    emit({ type: "error", message: "invalid JSON input" });
    return;
  }

  if (req.method === "cancel") {
    handleCancel(req.params || {});
    return;
  }

  if (req.method === "approval_response") {
    handleApprovalResponse(req.params || {});
    return;
  }

  if (req.method === "version") {
    emit({ id: req.id, type: "version", version: "1.0.0" });
    return;
  }

  if (req.method === "query") {
    void handleQuery(req);
  }
});

rl.on("close", () => {
  if (!shuttingDown) {
    process.exit(0);
  }
});
process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));
emit({ type: "ready" });
