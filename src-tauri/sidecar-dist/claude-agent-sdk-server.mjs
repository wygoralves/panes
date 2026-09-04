#!/usr/bin/env node
// Bridges the Claude Agent SDK to a stdio-based JSON-line protocol for Panes.

import { readFile } from "node:fs/promises";
import { ChildProcess, execFile } from "node:child_process";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const [nodeMajorVersion, nodeMinorVersion] = process.versions.node
  .split(".")
  .map(Number);
const supportsDisposableChildProcessVersion =
  nodeMajorVersion > 20 ||
  (nodeMajorVersion === 20 && nodeMinorVersion >= 5);
if (
  !supportsDisposableChildProcessVersion ||
  typeof Symbol.dispose !== "symbol" ||
  typeof Symbol.asyncDispose !== "symbol" ||
  typeof ChildProcess.prototype[Symbol.dispose] !== "function"
) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      message: `Claude requires Node.js 20.5 or newer with disposable child process support. Panes resolved Node.js ${process.versions.node}.`,
    }) + "\n",
  );
  process.exit(1);
}

let queryFn;
let sdkVersion = null;
let bundledClaudeCodeVersion = null;
const sdkModuleSpecifier = process.env.CLAUDE_AGENT_SDK_MODULE;
try {
  const sdk = sdkModuleSpecifier
    ? await import(sdkModuleSpecifier)
    : await import("@anthropic-ai/claude-agent-sdk");
  queryFn = sdk.query;

  try {
    const sdkEntryPath = sdkModuleSpecifier
      ? sdkModuleSpecifier.startsWith("file:")
        ? fileURLToPath(sdkModuleSpecifier)
        : sdkModuleSpecifier
      : fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"));
    const sdkPackage = JSON.parse(
      await readFile(path.join(path.dirname(sdkEntryPath), "package.json"), "utf8"),
    );
    sdkVersion = typeof sdkPackage.version === "string" ? sdkPackage.version : null;
    bundledClaudeCodeVersion =
      typeof sdkPackage.claudeCodeVersion === "string"
        ? sdkPackage.claudeCodeVersion
        : null;
  } catch {
    // Runtime metadata is diagnostic only. Model discovery can continue without it.
  }
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
const taskSnapshotsBySessionId = new Map();
let shuttingDown = false;
const claudeCodeExecutable = process.env.PANES_CLAUDE_CODE_EXECUTABLE?.trim() || null;
// Extra CLI flags configured for this provider instance, as a JSON array of
// tokens. They are mapped onto the SDK `extraArgs` option: `--flag value`
// pairs become { flag: value } and bare flags become { flag: null }.
const claudeExtraArgs = parseExtraArgs(process.env.PANES_CLAUDE_EXTRA_ARGS);

function parseExtraArgs(raw) {
  if (!raw) return null;
  let tokens;
  try {
    tokens = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(tokens)) return null;
  const extraArgs = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = String(tokens[index] ?? "");
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    if (equals > 2) {
      extraArgs[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const next = tokens[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      extraArgs[token.slice(2)] = next;
      index += 1;
    } else {
      extraArgs[token.slice(2)] = null;
    }
  }
  return Object.keys(extraArgs).length > 0 ? extraArgs : null;
}
const execFileAsync = promisify(execFile);
const claudeUsageUrl =
  process.env.PANES_CLAUDE_USAGE_URL?.trim() || "https://api.anthropic.com/api/oauth/usage";
const claudeUsageFetchDisabled = ["1", "true", "yes"].includes(
  String(process.env.PANES_DISABLE_CLAUDE_USAGE_FETCH || "").toLowerCase(),
);
const CLAUDE_USAGE_CACHE_TTL_MS = 60_000;
let claudeUsageCache = null;
const MAX_ATTACHMENTS_PER_TURN = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 40_000;
const TOOL_OUTPUT_CHUNK_SIZE = 8_192;
const TASK_TOOL_NAMES = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TodoWrite",
]);
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

async function buildUserMessageContent(prompt, attachments, cwd) {
  const attachmentList = Array.isArray(attachments) ? attachments : [];
  if (attachmentList.length > MAX_ATTACHMENTS_PER_TURN) {
    throw new Error(
      `You can attach at most ${MAX_ATTACHMENTS_PER_TURN} files per Claude turn.`,
    );
  }

  const content = [];
  if (typeof prompt === "string" && prompt.length > 0) {
    content.push({ type: "text", text: prompt });
  }

  for (const attachment of attachmentList) {
    content.push(await buildAttachmentContentBlock(attachment, cwd));
  }

  if (content.length === 0) {
    throw new Error(
      "Claude turn must include either a prompt or at least one supported attachment.",
    );
  }

  return content;
}

// Shape follows SDKUserMessage in sdk.d.ts. The SDK writes a string prompt as
// a single text block, so the initial message mirrors that exactly.
async function buildUserMessage(prompt, attachments, cwd, sessionIdHint, extra = {}) {
  return {
    type: "user",
    message: {
      role: "user",
      content: await buildUserMessageContent(prompt, attachments, cwd),
    },
    parent_tool_use_id: null,
    session_id: sessionIdHint || "",
    ...extra,
  };
}

// The query prompt is a pushable async iterable so more user messages can be
// written to the running CLI while a turn is in flight (mid-turn steering).
// The SDK forwards each pushed message to the CLI stdin as it arrives and
// closes stdin once the iterable ends.
function createInputStream() {
  // Entries are { message, requestId }: requestId names the steer request that
  // queued the message, so a dropped message can be answered.
  const queue = [];
  const waiters = [];
  let ended = false;

  const settleWaiters = () => {
    while (waiters.length > 0 && (queue.length > 0 || ended)) {
      const waiter = waiters.shift();
      if (queue.length > 0) {
        waiter({ value: queue.shift().message, done: false });
      } else {
        waiter({ value: undefined, done: true });
      }
    }
  };

  return {
    get ended() {
      return ended;
    },
    push(message, requestId = null) {
      if (ended) {
        return false;
      }
      queue.push({ message, requestId });
      settleWaiters();
      return true;
    },
    // Discards every message the query has not read yet and reports the steer
    // requests that were still waiting in the queue.
    dropQueued() {
      const dropped = queue.splice(0);
      settleWaiters();
      return dropped
        .map((entry) => entry.requestId)
        .filter((requestId) => typeof requestId === "string" && requestId.length > 0);
    },
    end() {
      if (ended) {
        return;
      }
      ended = true;
      settleWaiters();
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift().message, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return: () => {
          ended = true;
          settleWaiters();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
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

function requiresApproval(permissionMode, toolName, allowedTools) {
  // Task bookkeeping never touches the filesystem, so it skips approval, but
  // only while it is actually part of the thread's effective allowlist.
  if (TASK_TOOL_NAMES.has(toolName) && allowedTools?.has(toolName)) {
    return false;
  }
  if (permissionMode === "trusted") {
    return false;
  }
  if (permissionMode === "restricted") {
    return true;
  }
  return !["Read", "Glob", "Grep", "ExitPlanMode", "EnterPlanMode"].includes(toolName);
}

function createQueryContext(id, sessionIdHint = null) {
  const cachedTasks =
    typeof sessionIdHint === "string"
      ? taskSnapshotsBySessionId.get(sessionIdHint)
      : null;
  const context = {
    id,
    query: null,
    input: null,
    cwd: null,
    cancelTimer: null,
    actionCounter: 0,
    actionIdsByToolUseId: new Map(),
    streamToolUseIdsByIndex: new Map(),
    suppressedToolUseIds: new Set(),
    pendingApprovalIds: new Set(),
    cancelled: false,
    // Cancel requests waiting for this query to stop, answered once it has.
    cancelAckIds: [],
    cancelSettled: false,
    turnCompleted: false,
    sessionId: sessionIdHint,
    // The session this query was started for, kept even after the CLI reports
    // its own session id, so a follow-up turn can find a query still stopping.
    sessionKeyHint: sessionIdHint,
    tasks: new Map(cachedTasks || []),
    taskCounter: 0,
    tokenUsage: null,
    stopReason: null,
  };
  // Resolves once the query has stopped for good, so the next turn on the same
  // session can wait for it instead of overlapping it.
  context.finished = new Promise((resolve) => {
    context.markFinished = resolve;
  });
  return context;
}

function setContextSessionId(context, sessionId) {
  if (typeof sessionId === "string" && sessionId.length > 0) {
    context.sessionId = sessionId;
    const cachedTasks = taskSnapshotsBySessionId.get(sessionId);
    if (context.tasks.size === 0 && cachedTasks) {
      context.tasks = new Map(cachedTasks);
    }
  }
}

function parseTaskToolOutput(output) {
  if (output == null) {
    return null;
  }
  if (typeof output === "object") {
    if (Array.isArray(output.content)) {
      const text = output.content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n");
      if (text) {
        return parseTaskToolOutput(text);
      }
    }
    return output;
  }
  if (typeof output !== "string") {
    return null;
  }
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

function normalizeTaskStatus(status) {
  if (status === "inProgress" || status === "in-progress") {
    return "in_progress";
  }
  if (["pending", "in_progress", "completed"].includes(status)) {
    return status;
  }
  return "pending";
}

function taskIdFromValue(value, fallback) {
  const direct = value?.id ?? value?.taskId ?? value?.task_id;
  if (direct != null && String(direct).trim()) {
    return String(direct);
  }
  if (typeof value === "string") {
    const match =
      value.match(/\btask\s*#\s*([A-Za-z0-9_-]+)/i) ||
      value.match(/\btask\s+([0-9][A-Za-z0-9_-]*)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return fallback;
}

function normalizeTask(value, fallbackId) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const title = value.subject ?? value.title ?? value.content;
  if (typeof title !== "string" || !title.trim()) {
    return null;
  }
  return {
    id: taskIdFromValue(value, fallbackId),
    title: title.trim(),
    status: normalizeTaskStatus(value.status),
    activeForm:
      typeof value.activeForm === "string"
        ? value.activeForm
        : typeof value.active_form === "string"
          ? value.active_form
          : null,
    description: typeof value.description === "string" ? value.description : null,
    owner: typeof value.owner === "string" ? value.owner : null,
    blockedBy: Array.isArray(value.blockedBy ?? value.blocked_by)
      ? (value.blockedBy ?? value.blocked_by).map(String)
      : [],
  };
}

function rememberTaskSnapshot(context) {
  if (!context.sessionId) {
    return;
  }
  taskSnapshotsBySessionId.set(context.sessionId, new Map(context.tasks));
  while (taskSnapshotsBySessionId.size > 128) {
    taskSnapshotsBySessionId.delete(taskSnapshotsBySessionId.keys().next().value);
  }
}

function emitTaskSnapshot(context) {
  rememberTaskSnapshot(context);
  emit({
    id: context.id,
    type: "task_list_updated",
    source: "claude",
    explanation: null,
    tasks: [...context.tasks.values()],
  });
}

function extractTaskList(output) {
  const parsed = parseTaskToolOutput(output);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed?.tasks)) {
    return parsed.tasks;
  }
  if (Array.isArray(parsed?.todos)) {
    return parsed.todos;
  }
  return null;
}

function applyTaskToolCompletion(context, toolName, input, output) {
  const parsedOutput = parseTaskToolOutput(output);
  const inputValue = input && typeof input === "object" ? input : {};

  if (toolName === "TodoWrite") {
    context.tasks.clear();
    const todos = Array.isArray(inputValue.todos) ? inputValue.todos : [];
    todos.forEach((todo, index) => {
      const task = normalizeTask(todo, `todo-${index}`);
      if (task) context.tasks.set(task.id, task);
    });
    emitTaskSnapshot(context);
    return;
  }

  if (toolName === "TaskList") {
    const tasks = extractTaskList(parsedOutput);
    if (tasks) {
      context.tasks.clear();
      tasks.forEach((value, index) => {
        const task = normalizeTask(value, `task-${index}`);
        if (task) context.tasks.set(task.id, task);
      });
      emitTaskSnapshot(context);
    }
    return;
  }

  if (toolName === "TaskGet") {
    const taskValue = parsedOutput?.task ?? parsedOutput;
    const task = normalizeTask(
      taskValue,
      taskIdFromValue(inputValue, `task-${++context.taskCounter}`),
    );
    if (task) {
      context.tasks.set(task.id, task);
      emitTaskSnapshot(context);
    }
    return;
  }

  if (toolName === "TaskCreate") {
    const taskId = taskIdFromValue(
      parsedOutput?.task ?? parsedOutput,
      `task-${++context.taskCounter}`,
    );
    const task = normalizeTask(
      { ...inputValue, ...(parsedOutput?.task || {}), id: taskId },
      taskId,
    );
    if (task) {
      context.tasks.set(task.id, task);
      emitTaskSnapshot(context);
    }
    return;
  }

  if (toolName === "TaskUpdate") {
    const taskId = taskIdFromValue(inputValue, null);
    if (!taskId) {
      return;
    }
    if (inputValue.status === "deleted") {
      context.tasks.delete(taskId);
      emitTaskSnapshot(context);
      return;
    }
    const status = normalizeTaskStatus(inputValue.status);
    // An update for a task Panes never saw created has no title to show, and
    // a synthesized one would persist as a real task.
    const existing = context.tasks.get(taskId);
    if (!existing) {
      return;
    }
    const blockedBy = new Set(existing.blockedBy);
    for (const id of inputValue.addBlockedBy ?? inputValue.add_blocked_by ?? []) {
      blockedBy.add(String(id));
    }
    for (const id of inputValue.removeBlockedBy ?? inputValue.remove_blocked_by ?? []) {
      blockedBy.delete(String(id));
    }
    context.tasks.set(taskId, {
      ...existing,
      title: inputValue.subject ?? inputValue.title ?? existing.title,
      status: inputValue.status ? status : existing.status,
      activeForm:
        inputValue.activeForm ?? inputValue.active_form ?? existing.activeForm,
      description: inputValue.description ?? existing.description,
      owner: inputValue.owner ?? existing.owner,
      blockedBy: [...blockedBy],
    });
    emitTaskSnapshot(context);
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
  allowedTools = [],
}) {
  const normalizedRoots = writableRoots.map((root) => path.resolve(root));
  const permissionMode = resolvePermissionMode(approvalPolicy, allowNetwork);
  const allowedToolNames = new Set(allowedTools);

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

    if (!requiresApproval(permissionMode, toolName, allowedToolNames)) {
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

  const rateLimitType = String(rateLimitInfo.rateLimitType || "");
  const utilization = Number.isFinite(rateLimitInfo.utilization)
    ? Math.max(0, Math.round(rateLimitInfo.utilization * 100))
    : null;
  const resetsAt = Number.isFinite(rateLimitInfo.resetsAt)
    ? Math.round(rateLimitInfo.resetsAt)
    : null;
  const isFableWeeklyLimit =
    rateLimitType === "seven_day_overage_included" || rateLimitType === "seven_day_fable";

  const usage = {
    currentTokens: null,
    maxContextTokens: null,
    contextWindowPercent: null,
    fiveHourPercent: rateLimitType === "five_hour" ? utilization : null,
    weeklyPercent: rateLimitType === "seven_day" ? utilization : null,
    fableWeeklyPercent: isFableWeeklyLimit ? utilization : null,
    opusWeeklyPercent: rateLimitType === "seven_day_opus" ? utilization : null,
    sonnetWeeklyPercent: rateLimitType === "seven_day_sonnet" ? utilization : null,
    fiveHourResetsAt: rateLimitType === "five_hour" ? resetsAt : null,
    weeklyResetsAt: rateLimitType === "seven_day" ? resetsAt : null,
    fableWeeklyResetsAt: isFableWeeklyLimit ? resetsAt : null,
    opusWeeklyResetsAt: rateLimitType === "seven_day_opus" ? resetsAt : null,
    sonnetWeeklyResetsAt: rateLimitType === "seven_day_sonnet" ? resetsAt : null,
  };

  return Object.values(usage).some((value) => value !== null) ? usage : null;
}

function toUsagePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function toUnixTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.round(timestamp / 1000) : null;
}

function readUsageWindow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const percent = toUsagePercent(value.utilization ?? value.percent ?? value.used_percentage);
  if (percent === null) {
    return null;
  }
  return {
    percent,
    resetsAt: toUnixTimestamp(value.resets_at ?? value.resetsAt),
  };
}

function buildUsageApiSnapshot(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const snapshot = {
    currentTokens: null,
    maxContextTokens: null,
    contextWindowPercent: null,
    fiveHourPercent: null,
    weeklyPercent: null,
    fableWeeklyPercent: null,
    opusWeeklyPercent: null,
    sonnetWeeklyPercent: null,
    fiveHourResetsAt: null,
    weeklyResetsAt: null,
    fableWeeklyResetsAt: null,
    opusWeeklyResetsAt: null,
    sonnetWeeklyResetsAt: null,
  };

  const assignWindow = (prefix, window) => {
    if (!window) return;
    snapshot[`${prefix}Percent`] = window.percent;
    snapshot[`${prefix}ResetsAt`] = window.resetsAt;
  };

  assignWindow("fiveHour", readUsageWindow(payload.five_hour));
  assignWindow("weekly", readUsageWindow(payload.seven_day));
  assignWindow(
    "fableWeekly",
    readUsageWindow(payload.seven_day_overage_included ?? payload.seven_day_fable),
  );
  assignWindow("opusWeekly", readUsageWindow(payload.seven_day_opus));
  assignWindow("sonnetWeekly", readUsageWindow(payload.seven_day_sonnet));

  if (Array.isArray(payload.limits)) {
    for (const limit of payload.limits) {
      const window = readUsageWindow(limit);
      if (!window) continue;
      if (limit.kind === "session") {
        assignWindow("fiveHour", window);
        continue;
      }
      if (limit.kind === "weekly_all") {
        assignWindow("weekly", window);
        continue;
      }
      if (limit.kind !== "weekly_scoped") continue;

      const modelName = String(
        limit.scope?.model?.display_name || limit.scope?.model?.id || "",
      ).toLowerCase();
      if (modelName.includes("fable")) {
        assignWindow("fableWeekly", window);
      } else if (modelName.includes("opus")) {
        assignWindow("opusWeekly", window);
      } else if (modelName.includes("sonnet")) {
        assignWindow("sonnetWeekly", window);
      }
    }
  }

  return Object.values(snapshot).some((value) => value !== null) ? snapshot : null;
}

/**
 * Keychain service names that may hold this instance's OAuth credentials.
 * Claude Code stores the default install under "Claude Code-credentials" and
 * a custom CLAUDE_CONFIG_DIR under the same name suffixed with the first eight
 * hex characters of sha256 over the raw directory value, so an instance must
 * never fall back to the default item or it reports another account's limits.
 */
export function claudeCredentialKeychainServices(configDirectory, homeDirectory) {
  const raw = configDirectory?.trim();
  if (!raw) {
    return ["Claude Code-credentials"];
  }
  const candidates = new Set([raw]);
  if (homeDirectory) {
    if (raw.startsWith("~/")) candidates.add(path.join(homeDirectory, raw.slice(2)));
    if (raw.startsWith(homeDirectory + "/")) candidates.add("~" + raw.slice(homeDirectory.length));
  }
  const trimmed = raw.replace(/\/+$/, "");
  if (trimmed && trimmed !== raw) candidates.add(trimmed);
  return [...candidates].map(
    (value) => `Claude Code-credentials-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`,
  );
}

async function readClaudeOauthAccessToken() {
  const environmentToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (environmentToken) {
    return environmentToken;
  }

  const homeDirectory = process.env.HOME || process.env.USERPROFILE || "";
  const configDirectoryEnv = process.env.CLAUDE_CONFIG_DIR?.trim() || "";

  if (process.platform === "darwin") {
    for (const service of claudeCredentialKeychainServices(configDirectoryEnv, homeDirectory)) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/security",
          ["find-generic-password", "-s", service, "-w"],
          { encoding: "utf8", timeout: 2_000, maxBuffer: 1024 * 1024 },
        );
        const credentials = JSON.parse(stdout);
        const token = credentials?.claudeAiOauth?.accessToken;
        if (typeof token === "string" && token.trim().length > 0) {
          return token.trim();
        }
      } catch {
        // Try the next service name, then the credentials file.
      }
    }
  }

  try {
    if (!homeDirectory && !configDirectoryEnv) return null;
    const configDirectory = configDirectoryEnv
      ? configDirectoryEnv.startsWith("~/")
        ? path.join(homeDirectory, configDirectoryEnv.slice(2))
        : configDirectoryEnv
      : path.join(homeDirectory, ".claude");
    const credentials = JSON.parse(
      await readFile(path.join(configDirectory, ".credentials.json"), "utf8"),
    );
    const token = credentials?.claudeAiOauth?.accessToken;
    return typeof token === "string" && token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
}

async function fetchClaudeUsageSnapshot() {
  if (claudeUsageFetchDisabled) {
    return null;
  }
  const now = Date.now();
  if (claudeUsageCache && claudeUsageCache.expiresAt > now) {
    return claudeUsageCache.snapshot;
  }

  const token = await readClaudeOauthAccessToken();
  if (!token) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(claudeUsageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const snapshot = buildUsageApiSnapshot(await response.json());
    if (snapshot) {
      claudeUsageCache = {
        expiresAt: now + CLAUDE_USAGE_CACHE_TTL_MS,
        snapshot,
      };
    }
    return snapshot;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function inferClaudeContextWindowTokens(model) {
  const normalized = String(model || "").toLowerCase();
  const millionTokenMatch = normalized.match(/\[(\d+)m\]/);
  if (millionTokenMatch) {
    return Number(millionTokenMatch[1]) * 1_000_000;
  }
  return 200_000;
}

function buildContextUsageSnapshot(streamEvent, model) {
  if (streamEvent?.type !== "message_start") {
    return null;
  }

  const rawUsage = streamEvent.message?.usage;
  if (!rawUsage || typeof rawUsage !== "object" || Array.isArray(rawUsage)) {
    return null;
  }

  const inputTokenFields = [
    rawUsage.input_tokens,
    rawUsage.cache_creation_input_tokens,
    rawUsage.cache_read_input_tokens,
  ];
  const currentTokens = inputTokenFields.reduce((total, value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? total + Math.max(0, numeric) : total;
  }, 0);
  if (currentTokens <= 0) {
    return null;
  }

  const maxContextTokens = inferClaudeContextWindowTokens(model);
  const remainingPercent = Math.max(
    0,
    Math.min(100, Math.round(((maxContextTokens - currentTokens) / maxContextTokens) * 100)),
  );

  return {
    currentTokens: null,
    maxContextTokens: null,
    contextWindowPercent: remainingPercent,
    fiveHourPercent: null,
    weeklyPercent: null,
    fableWeeklyPercent: null,
    opusWeeklyPercent: null,
    sonnetWeeklyPercent: null,
    fiveHourResetsAt: null,
    weeklyResetsAt: null,
    fableWeeklyResetsAt: null,
    opusWeeklyResetsAt: null,
    sonnetWeeklyResetsAt: null,
  };
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
    case "overloaded":
      return {
        errorType,
        isAuthError: false,
        message: "Claude is temporarily overloaded. Retry in a moment.",
        recoverable: true,
      };
    case "model_not_found":
      return {
        errorType,
        isAuthError: false,
        message: "The selected Claude model is not available for this account.",
        recoverable: false,
      };
    case "oauth_org_not_allowed":
      return {
        errorType,
        isAuthError: true,
        message: "This Claude organization does not allow this sign-in. Switch accounts or sign in again.",
        recoverable: false,
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

function applyClaudeRuntime(options) {
  if (claudeCodeExecutable) {
    options.pathToClaudeCodeExecutable = claudeCodeExecutable;
  }
  return options;
}

async function* holdModelDiscoveryOpen() {
  await new Promise(() => {});
}

async function handleListModels(req) {
  const { id, params = {} } = req;
  const options = applyClaudeRuntime({
    cwd: params.cwd || process.cwd(),
    settingSources: [],
  });
  const query = queryFn({ prompt: holdModelDiscoveryOpen(), options });

  try {
    const models = await query.supportedModels();
    emit({
      id,
      type: "models",
      models: Array.isArray(models) ? models : [],
      runtimeSource: claudeCodeExecutable ? "system" : "bundled",
      runtimeExecutable: claudeCodeExecutable || undefined,
      sdkVersion: sdkVersion || undefined,
      bundledClaudeCodeVersion: bundledClaudeCodeVersion || undefined,
    });
  } catch (error) {
    emit({
      id,
      type: "error",
      message: `Failed to discover Claude models: ${error.message || String(error)}`,
      recoverable: true,
    });
  } finally {
    query.close?.();
  }
}

async function handleUsageLimits(req) {
  const usage = await fetchClaudeUsageSnapshot();
  if (usage) {
    emit({ id: req.id, type: "usage_limits_updated", usage });
    return;
  }
  emit({
    id: req.id,
    type: "error",
    message: "Claude usage limits are unavailable for the current account.",
    recoverable: true,
  });
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

  const sessionKey = sessionId || resume || null;
  const context = createQueryContext(id, sessionKey);
  // Registered before the wait below so a stop that lands while the previous
  // query is still winding down still finds this turn.
  activeQueries.set(id, context);

  // Task tools belong to the default tool set only. A caller that supplied an
  // explicit allowlist gets exactly that list, so Panes never widens a thread
  // past what the policy asked for.
  const toolList = Array.isArray(allowedTools)
    ? [...new Set(allowedTools)]
    : [
        ...new Set([
          "Read",
          "Write",
          "Edit",
          "Bash",
          "Glob",
          "Grep",
          ...(allowNetwork ? ["WebFetch"] : []),
          ...TASK_TOOL_NAMES,
        ]),
      ];

  const sessionCwd = cwd || process.cwd();
  let actualSessionId = null;
  try {
    const normalizedSandboxMode = normalizeSandboxMode(sandboxMode);
    const normalizedWritableRoots = normalizeWritableRoots(sessionCwd, writableRoots);

    const options = applyClaudeRuntime({
      cwd: sessionCwd,
      additionalDirectories: additionalDirectoriesForSandbox(
        sessionCwd,
        normalizedSandboxMode,
        normalizedWritableRoots,
      ),
      permissionMode: planMode ? "plan" : "default",
      // Never pass `allowedTools` to the SDK: bare tool names there auto-approve
      // the tool and shadow `canUseTool`, so Panes' approval flow would be
      // skipped (warning CLAUDE_SDK_CAN_USE_TOOL_SHADOWED). An explicit
      // allowlist restricts the tool set through `tools` instead.
      ...(Array.isArray(allowedTools) ? { tools: toolList } : {}),
      env: {
        ...process.env,
        CLAUDE_CODE_ENABLE_TODO_TOOLS: "1",
      },
      canUseTool: buildPermissionHandler({
        context,
        cwd: sessionCwd,
        writableRoots: normalizedWritableRoots,
        sandboxMode: normalizedSandboxMode,
        allowNetwork: Boolean(allowNetwork),
        approvalPolicy,
        allowedTools: toolList,
      }),
      // settingSources is intentionally omitted so user, project and local
      // settings all load, matching the Claude Code CLI default.
      sandbox: {
        enabled: true,
        failIfUnavailable: false,
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
              if (TASK_TOOL_NAMES.has(toolName)) {
                return {};
              }
              if (toolName === "ExitPlanMode" || toolName === "EnterPlanMode") {
                return {
                  decision: "block",
                  reason: `${toolName} handled by Panes. The plan is ready and will be presented to the user for review.`,
                };
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
              if (TASK_TOOL_NAMES.has(toolName)) {
                const toolInput = hookInput?.tool_input || hookInput?.input || {};
                const output =
                  hookInput?.tool_response ??
                  hookInput?.tool_result ??
                  hookInput?.result;
                applyTaskToolCompletion(context, toolName, toolInput, output);
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
              if (TASK_TOOL_NAMES.has(toolName)) {
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
    });

    if (model) options.model = model;
    if (claudeExtraArgs) options.extraArgs = claudeExtraArgs;
    // Without a systemPrompt option the SDK runs with an empty system prompt.
    // Use the Claude Code preset so results match the Claude Code app, and
    // append any caller-supplied instructions on top of it.
    options.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      ...(systemPrompt ? { append: systemPrompt } : {}),
    };
    if (resume) options.resume = resume;
    if (sessionId) options.sessionId = sessionId;
    if (maxTurns) options.maxTurns = maxTurns;
    if (reasoningEffort) options.effort = reasoningEffort;

    emit({ id, type: "turn_started" });

    let sawTextDelta = false;
    let terminalStatus = "completed";
    context.cwd = sessionCwd;
    const input = createInputStream();
    context.input = input;
    input.push(
      await buildUserMessage(prompt, attachments, sessionCwd, sessionId || resume || ""),
    );

    // A stop on the previous turn can still be winding down, and the old CLI
    // owns the session until it does, so this turn waits before starting.
    // Anything steered meanwhile queues on the input above.
    await waitForStoppingQueries(sessionKey);
    if (context.cancelled) {
      // Stop landed before this turn reached the CLI, so nothing runs.
      input.end();
      emitTurnCompleted(context, "interrupted");
      return;
    }

    const query = queryFn({ prompt: input, options });
    context.query = query;
    if (context.cancelled) {
      // Cancel landed while the first message was still being assembled.
      input.end();
      void interruptQuery(context);
    }
    void fetchClaudeUsageSnapshot().then((usage) => {
      if (usage && activeQueries.has(id)) {
        emit({ id, type: "usage_limits_updated", usage });
      }
    });

    for await (const message of query) {
      if (context.cancelled) {
        // After an interrupt the CLI still delivers the aborted turn's result;
        // keep its session id and usage, drop everything else. A hard close
        // ends the stream instead, and the cancel timer covers a CLI that
        // never answers the interrupt.
        if (message.type === "result") {
          actualSessionId = message.session_id || actualSessionId;
          setContextSessionId(context, actualSessionId);
          updateContextTokenUsage(context, {
            input: message.usage?.input_tokens,
            output: message.usage?.output_tokens,
          });
          break;
        }
        continue;
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
      } else if (message.type === "system" && message.subtype === "api_retry") {
        const attempt = Number(message.attempt) || 0;
        const maxRetries = Number(message.max_retries) || 0;
        const delayMs = Number(message.retry_delay_ms) || 0;
        emit({
          id,
          type: "notice",
          kind: "claude_status",
          level: "info",
          title: "Claude status",
          message:
            `Claude API request failed${message.error ? ` (${message.error})` : ""}; ` +
            `retrying ${attempt}/${maxRetries}` +
            (delayMs > 0 ? ` in ${Math.round(delayMs / 1000)}s` : "") +
            ".",
        });
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
        // The turn is over: closing the input stream lets the SDK end the
        // CLI stdin so the process exits the way a single-shot query does.
        input.end();
      } else if (message.type === "stream_event") {
        const streamEvent = message.event;
        updateTokenUsageFromStreamEvent(context, streamEvent);
        const contextUsage = buildContextUsageSnapshot(streamEvent, model);
        if (contextUsage) {
          emit({
            id,
            type: "usage_limits_updated",
            usage: contextUsage,
          });
        }

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
    if (context.cancelTimer) {
      clearTimeout(context.cancelTimer);
      context.cancelTimer = null;
    }
    context.input?.end();
    cleanupPendingApprovalsForQuery(id, "Claude query was canceled.");
    activeQueries.delete(id);
    // Idempotent on a query that already finished; on a cancelled one it
    // terminates the CLI so nothing queued behind the interrupt runs.
    try {
      context.query?.close?.();
    } catch {
      // The query is gone either way.
    }
    // The query yielded its last message, so the request is over: answer the
    // cancel that was waiting on it and release the next turn.
    settleCancelledQuery(context, false);
  }
}

const DEFAULT_CANCEL_CLOSE_GRACE_MS = 5_000;

function cancelCloseGraceMs() {
  const raw = Number.parseInt(process.env.PANES_CLAUDE_CANCEL_GRACE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CANCEL_CLOSE_GRACE_MS;
}

// Answers every cancel request waiting on this query and releases the turns
// queued behind it. `closed` reports that the grace period expired and the
// query was closed instead of ending on its own final result.
function settleCancelledQuery(context, closed) {
  if (context.cancelSettled) {
    context.markFinished?.();
    return;
  }
  context.cancelSettled = true;
  for (const ackId of context.cancelAckIds.splice(0)) {
    emit({
      ...(ackId ? { id: ackId } : {}),
      type: "cancel_result",
      requestId: context.id,
      ok: true,
      closed,
    });
  }
  context.markFinished?.();
}

function queryMatchesSession(context, sessionKey) {
  if (!sessionKey) {
    return false;
  }
  return context.sessionId === sessionKey || context.sessionKeyHint === sessionKey;
}

// A turn started right after a stop must not overlap the query it replaces:
// the old CLI still owns the session until it yields its final result.
async function waitForStoppingQueries(sessionKey) {
  const stopping = [...activeQueries.values()].filter(
    (context) => context.cancelled && queryMatchesSession(context, sessionKey),
  );
  if (stopping.length === 0) {
    return;
  }
  const graceMs = cancelCloseGraceMs() * 2;
  await Promise.race([
    Promise.all(stopping.map((context) => context.finished)),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      timer.unref?.();
    }),
  ]);
}

async function interruptQuery(context) {
  const query = context.query;
  if (!query) {
    return;
  }
  if (typeof query.interrupt === "function") {
    try {
      // Interrupt lets the CLI finish the turn cleanly (transcript persisted,
      // result emitted) instead of killing the process outright.
      await query.interrupt();
      return;
    } catch {
      // Fall through to a hard close.
    }
  }
  try {
    query.close?.();
  } catch {
    // Nothing else to release.
  }
}

function handleCancel(params = {}, envelopeId = null) {
  const requestId =
    params.requestId || params.request_id || params.id || null;
  if (!requestId) {
    return;
  }

  const context = activeQueries.get(requestId);
  if (!context) {
    // Nothing left to stop, so the caller is free to start the next turn.
    emit({
      ...(envelopeId ? { id: envelopeId } : {}),
      type: "cancel_result",
      requestId,
      ok: true,
      closed: false,
    });
    return;
  }

  context.cancelled = true;
  context.cancelAckIds.push(envelopeId);
  cleanupPendingApprovalsForQuery(
    requestId,
    "Claude query was canceled before approval was answered.",
  );
  // Steer messages the query never read must not run after a stop, and the
  // requests that queued them are told so instead of being dropped in silence.
  const droppedSteerIds = context.input?.dropQueued() ?? [];
  for (const steerId of droppedSteerIds) {
    emit({
      id: steerId,
      type: "error",
      message: `Claude query ${requestId} was canceled before this message was delivered.`,
      recoverable: true,
    });
  }
  context.input?.end();
  if (!context.cancelTimer) {
    context.cancelTimer = setTimeout(() => {
      context.cancelTimer = null;
      if (activeQueries.get(requestId) === context) {
        try {
          context.query?.close?.();
        } catch {
          // The process is already gone.
        }
        // The query outlived its grace period, so the request is over as far as
        // this sidecar is concerned.
        activeQueries.delete(requestId);
      }
      settleCancelledQuery(context, true);
    }, cancelCloseGraceMs());
    context.cancelTimer.unref?.();
  }
  void interruptQuery(context);
}

function findSteerableQuery(requestId) {
  if (!requestId) {
    throw new Error("Claude steer requests require a requestId.");
  }
  const context = activeQueries.get(requestId);
  if (!context || context.cancelled || context.turnCompleted || !context.input) {
    throw new Error(`No active Claude query for request ${requestId}.`);
  }
  if (context.input.ended) {
    throw new Error(`Claude query ${requestId} is no longer accepting input.`);
  }
  return context;
}

// Pushes a user message into the running turn. `priority: "next"` makes the
// CLI fold it into the current turn at the next tool round (a queued command)
// instead of starting a new turn after this one ("later") or aborting the
// running turn first ("now").
async function pushSteerMessage(context, prompt, attachments, steerRequestId = null) {
  const message = await buildUserMessage(
    prompt,
    attachments,
    context.cwd || process.cwd(),
    context.sessionId || "",
    { priority: "next", uuid: randomUUID() },
  );
  if (!context.input.push(message, steerRequestId)) {
    throw new Error(`Claude query ${context.id} is no longer accepting input.`);
  }
}

async function handleSteer(req) {
  const { id, params = {} } = req;
  try {
    const context = findSteerableQuery(
      params.requestId || params.request_id || null,
    );
    await pushSteerMessage(context, params.prompt, params.attachments, id);
    emit({ id, type: "steer_result", ok: true });
  } catch (error) {
    emit({ id, type: "error", message: error.message || String(error) });
  }
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
    context.input?.end();
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
    handleCancel(req.params || {}, typeof req.id === "string" ? req.id : null);
    return;
  }

  if (req.method === "approval_response") {
    handleApprovalResponse(req.params || {});
    return;
  }

  if (req.method === "steer") {
    void handleSteer(req);
    return;
  }

  if (req.method === "version") {
    emit({
      id: req.id,
      type: "version",
      version: "1.1.0",
      runtimeSource: claudeCodeExecutable ? "system" : "bundled",
      runtimeExecutable: claudeCodeExecutable || undefined,
      sdkVersion: sdkVersion || undefined,
      bundledClaudeCodeVersion: bundledClaudeCodeVersion || undefined,
    });
    return;
  }

  if (req.method === "list_models") {
    void handleListModels(req);
    return;
  }

  if (req.method === "get_usage_limits") {
    void handleUsageLimits(req);
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
