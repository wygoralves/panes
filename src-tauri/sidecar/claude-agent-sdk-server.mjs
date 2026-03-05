#!/usr/bin/env node
// Bridges the Claude Agent SDK to a stdio-based JSON-line protocol for Panes.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

let queryFn;
try {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  queryFn = sdk.query;
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      type: "error",
      message: `Failed to load @anthropic-ai/claude-agent-sdk: ${err.message}. Install it with: pnpm add @anthropic-ai/claude-agent-sdk`,
    }) + "\n",
  );
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
const activeQueries = new Map();
const pendingApprovals = new Map();
const MAX_ATTACHMENTS_PER_TURN = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 40_000;
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

function resolveTrustMode(approvalPolicy, allowNetwork) {
  if (approvalPolicy === "untrusted") {
    return "restricted";
  }
  return allowNetwork ? "trusted" : "standard";
}

function requiresApproval(trustMode, toolName) {
  if (trustMode === "trusted") {
    return false;
  }
  if (trustMode === "restricted") {
    return true;
  }
  return !["Read", "Glob", "Grep"].includes(toolName);
}

function createQueryContext(id) {
  return {
    id,
    query: null,
    actionCounter: 0,
    pendingActionIds: [],
    pendingApprovalIds: new Set(),
    cancelled: false,
  };
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

async function requestApproval(context, toolName, toolInput) {
  const approvalId = `${context.id}:approval:${context.pendingApprovalIds.size + 1}:${Date.now()}`;
  emit({
    id: context.id,
    type: "approval_requested",
    approvalId,
    actionType: mapToolNameToActionType(toolName),
    summary: summarizeTool(toolName, toolInput),
    details: toolInput ?? {},
  });

  const permission = await new Promise((resolve) => {
    pendingApprovals.set(approvalId, {
      queryId: context.id,
      resolve,
    });
    context.pendingApprovalIds.add(approvalId);
  });

  context.pendingApprovalIds.delete(approvalId);
  pendingApprovals.delete(approvalId);
  return permission;
}

function buildPermissionHandler({
  context,
  cwd,
  writableRoots,
  allowNetwork,
  approvalPolicy,
}) {
  const normalizedRoots = writableRoots.map((root) => path.resolve(root));
  const trustMode = resolveTrustMode(approvalPolicy, allowNetwork);

  return async (toolName, input, options) => {
    const toolInput = input ?? {};

    if (!allowNetwork && toolName === "WebFetch") {
      return {
        behavior: "deny",
        message: "Network access is disabled for this repository.",
      };
    }

    if (options?.blockedPath) {
      return {
        behavior: "deny",
        message: `Path outside the allowed workspace scope: ${options.blockedPath}`,
      };
    }

    if (toolName === "Write" || toolName === "Edit") {
      const candidatePaths = collectCandidatePaths(toolName, toolInput, cwd);
      if (
        candidatePaths.length > 0 &&
        !candidatePaths.every((candidate) => isWithinAnyRoot(normalizedRoots, candidate))
      ) {
        return {
          behavior: "deny",
          message: "This file path is outside the approved writable roots for the thread.",
        };
      }
    }

    if (!requiresApproval(trustMode, toolName)) {
      return { behavior: "allow" };
    }

    return requestApproval(context, toolName, toolInput);
  };
}

function resolveApprovalDecision(response) {
  const decision =
    typeof response?.decision === "string" ? response.decision : "";
  if (decision === "accept" || decision === "accept_for_session") {
    return {
      behavior: "allow",
    };
  }

  return {
    behavior: "deny",
    message: "Tool usage denied by the user.",
  };
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
  const normalizedWritableRoots = writableRoots.length > 0
    ? writableRoots.map((root) => path.resolve(root))
    : [sessionCwd];

  const options = {
    cwd: sessionCwd,
    additionalDirectories: normalizedWritableRoots.filter(
      (root) => root !== path.resolve(sessionCwd),
    ),
    permissionMode: planMode ? "plan" : "dontAsk",
    allowedTools: toolList,
    canUseTool: buildPermissionHandler({
      context,
      cwd: sessionCwd,
      writableRoots: normalizedWritableRoots,
      allowNetwork: Boolean(allowNetwork),
      approvalPolicy,
    }),
    settingSources: ["project"],
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        allowWrite: normalizedWritableRoots,
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
        defaultMode: planMode ? "plan" : "dontAsk",
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
              const actionId = `claude-action-${++context.actionCounter}`;
              const toolName = hookInput?.tool_name || hookInput?.name || "unknown";
              const toolInput = hookInput?.tool_input || hookInput?.input || {};
              context.pendingActionIds.push(actionId);

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
              const actionId =
                context.pendingActionIds.pop() ||
                `claude-action-${context.actionCounter}`;
              const output = hookInput?.tool_result || hookInput?.result;
              const outputStr =
                typeof output === "string"
                  ? output.slice(0, 4000)
                  : output != null
                    ? JSON.stringify(output).slice(0, 4000)
                    : undefined;

              emit({
                id,
                type: "action_completed",
                actionId,
                success: true,
                output: outputStr,
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
              const actionId =
                context.pendingActionIds.pop() ||
                `claude-action-${context.actionCounter}`;

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

  try {
    emit({ id, type: "turn_started" });

    let actualSessionId = null;
    let sawTextDelta = false;
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
        emit({ id, type: "session_init", sessionId: actualSessionId });
      } else if (message.type === "stream_event") {
        const streamEvent = message.event;
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
      } else if ("result" in message && typeof message.result === "string" && message.result.length > 0 && !sawTextDelta) {
        emit({ id, type: "text_delta", content: message.result });
      }
    }

    emit({
      id,
      type: "turn_completed",
      status: context.cancelled ? "interrupted" : "completed",
      sessionId: actualSessionId,
    });
  } catch (err) {
    emit({
      id,
      type: "error",
      message: err.message || String(err),
      recoverable: false,
    });
    emit({ id, type: "turn_completed", status: "failed", sessionId: null });
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

function handleApprovalResponse(params = {}) {
  const approvalId = params.approvalId || params.approval_id;
  if (!approvalId) {
    return;
  }

  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    return;
  }

  pendingApprovals.delete(approvalId);
  const context = activeQueries.get(pending.queryId);
  context?.pendingApprovalIds.delete(approvalId);
  pending.resolve(resolveApprovalDecision(params.response || {}));
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

rl.on("close", () => process.exit(0));
emit({ type: "ready" });
