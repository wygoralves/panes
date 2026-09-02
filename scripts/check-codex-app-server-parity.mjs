#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

function parseArgs(argv) {
  const args = { schemaDir: null, keepSchema: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--schema-dir") {
      args.schemaDir = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--keep-schema") {
      args.keepSchema = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function requireFile(schemaRoot, file) {
  const path = join(schemaRoot, "v2", file);
  assert(existsSync(path), `Missing Codex app-server schema file: v2/${file}`);
  return path;
}

function requireRootFile(schemaRoot, file) {
  const path = join(schemaRoot, file);
  assert(existsSync(path), `Missing Codex app-server schema file: ${file}`);
  return path;
}

function assertProperties(schemaRoot, file, properties) {
  const schema = loadJson(requireFile(schemaRoot, file));
  for (const property of properties) {
    assert(
      schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, property),
      `v2/${file} is missing property ${property}`,
    );
  }
}

function assertSourceContains(path, tokens) {
  const source = readFileSync(join(repoRoot, path), "utf8");
  for (const token of tokens) {
    assert(source.includes(token), `${path} is missing token ${token}`);
  }
}

function assertSourceMatches(path, patterns) {
  const source = readFileSync(join(repoRoot, path), "utf8");
  for (const [label, pattern] of patterns) {
    assert(pattern.test(source), `${path} is missing expected implementation: ${label}`);
  }
}

function assertDefinitionEnum(schemaRoot, file, definitionName, expectedValues) {
  const schema = loadJson(requireFile(schemaRoot, file));
  const enumValues = schema.definitions?.[definitionName]?.enum;
  assert(Array.isArray(enumValues), `v2/${file} definition ${definitionName} is missing enum`);
  for (const value of expectedValues) {
    assert(
      enumValues.includes(value),
      `v2/${file} definition ${definitionName} is missing enum value ${value}`,
    );
  }
}

function assertNoProperties(schemaRoot, file, properties) {
  const schema = loadJson(requireFile(schemaRoot, file));
  for (const property of properties) {
    assert(
      !(property in (schema.properties ?? {})),
      `v2/${file} still exposes removed property ${property}`,
    );
  }
}

function assertGranularApprovalPolicy(schemaRoot, file) {
  const schema = loadJson(requireFile(schemaRoot, file));
  const variants = schema.definitions?.AskForApproval?.oneOf;
  assert(Array.isArray(variants), `v2/${file} is missing AskForApproval variants`);
  const stringVariant = variants.find((variant) => Array.isArray(variant.enum));
  assert(stringVariant, `v2/${file} AskForApproval is missing the string variant`);
  for (const value of ["untrusted", "on-request", "never"]) {
    assert(stringVariant.enum.includes(value), `v2/${file} AskForApproval is missing ${value}`);
  }
  assert(
    !stringVariant.enum.includes("on-failure"),
    `v2/${file} AskForApproval still exposes on-failure; the granular translation is stale`,
  );
  const granular = variants.find((variant) => variant.properties?.granular);
  assert(granular, `v2/${file} AskForApproval is missing the granular variant`);
  for (const required of ["mcp_elicitations", "rules", "sandbox_approval"]) {
    assert(
      granular.properties.granular.required?.includes(required),
      `v2/${file} granular AskForApproval is missing required ${required}`,
    );
  }
}

function assertPermissionProfileShape(schemaRoot, file) {
  const schema = loadJson(requireFile(schemaRoot, file));
  const variants = schema.definitions?.PermissionProfile?.oneOf;
  assert(Array.isArray(variants), `v2/${file} is missing PermissionProfile variants`);
  const variantByType = new Map();
  for (const variant of variants) {
    const typeEnum = variant.properties?.type?.enum;
    if (Array.isArray(typeEnum) && typeEnum.length === 1) {
      variantByType.set(typeEnum[0], variant);
    }
  }
  assert(variantByType.has("managed"), `v2/${file} PermissionProfile is missing managed`);
  assert(variantByType.has("external"), `v2/${file} PermissionProfile is missing external`);
  assert(variantByType.has("disabled"), `v2/${file} PermissionProfile is missing disabled`);
  for (const required of ["type", "fileSystem", "network"]) {
    assert(
      variantByType.get("managed").required?.includes(required),
      `v2/${file} managed PermissionProfile is missing required ${required}`,
    );
  }
  for (const required of ["type", "network"]) {
    assert(
      variantByType.get("external").required?.includes(required),
      `v2/${file} external PermissionProfile is missing required ${required}`,
    );
  }
}

function assertRootRequestMethods(schemaRoot, expectedMethods) {
  const schema = loadJson(requireRootFile(schemaRoot, "ServerRequest.json"));
  const requestMethods = new Set(
    (schema.oneOf ?? [])
      .flatMap((variant) => variant.properties?.method?.enum ?? [])
      .filter((method) => typeof method === "string"),
  );
  for (const method of expectedMethods) {
    assert(requestMethods.has(method), `ServerRequest.json is missing request method ${method}`);
  }
}

const args = parseArgs(process.argv.slice(2));
let generatedDir = null;
let schemaRoot = args.schemaDir ? resolve(args.schemaDir) : null;

if (!schemaRoot) {
  generatedDir = mkdtempSync(join(tmpdir(), "panes-codex-schema-"));
  execFileSync("codex", ["app-server", "generate-json-schema", "--out", generatedDir], {
    stdio: "pipe",
  });
  schemaRoot = generatedDir;
}

try {
  const requiredFiles = [
    "../ChatgptAuthTokensRefreshParams.json",
    "../ChatgptAuthTokensRefreshResponse.json",
    "../McpServerElicitationRequestParams.json",
    "../McpServerElicitationRequestResponse.json",
    "../PermissionsRequestApprovalParams.json",
    "../PermissionsRequestApprovalResponse.json",
    "../ServerRequest.json",
    "ThreadTurnsListParams.json",
    "ThreadTurnsListResponse.json",
    "ThreadStartParams.json",
    "ThreadResumeParams.json",
    "ThreadForkParams.json",
    "TurnStartParams.json",
    "TurnSteerParams.json",
    "ReviewStartParams.json",
    "ThreadRollbackParams.json",
    "ThreadCompactStartParams.json",
    "FeedbackUploadParams.json",
    "ThreadInjectItemsParams.json",
    "McpResourceReadParams.json",
    "McpServerToolCallParams.json",
    "WarningNotification.json",
    "GuardianWarningNotification.json",
    "ModelVerificationNotification.json",
    "ItemGuardianApprovalReviewStartedNotification.json",
    "ItemGuardianApprovalReviewCompletedNotification.json",
    "FileChangePatchUpdatedNotification.json",
    "CommandExecOutputDeltaNotification.json",
    "ThreadRealtimeStartedNotification.json",
    "ThreadRealtimeTranscriptDeltaNotification.json",
    "ThreadRealtimeTranscriptDoneNotification.json",
    "ThreadRealtimeItemAddedNotification.json",
    "ThreadRealtimeClosedNotification.json",
    "ThreadRealtimeErrorNotification.json",
  ];
  for (const file of requiredFiles) {
    if (file.startsWith("../")) {
      requireRootFile(schemaRoot, file.slice(3));
    } else {
      requireFile(schemaRoot, file);
    }
  }

  assertProperties(schemaRoot, "ThreadTurnsListParams.json", ["threadId", "cursor", "limit"]);
  for (const file of [
    "ThreadStartParams.json",
    "ThreadResumeParams.json",
    "ThreadForkParams.json",
    "TurnStartParams.json",
  ]) {
    assertProperties(schemaRoot, file, ["approvalsReviewer"]);
    assertDefinitionEnum(schemaRoot, file, "ApprovalsReviewer", [
      "user",
      "auto_review",
      "guardian_subagent",
    ]);
    assertNoProperties(schemaRoot, file, ["permissionProfile"]);
    assertGranularApprovalPolicy(schemaRoot, file);
  }

  assertRootRequestMethods(schemaRoot, [
    "account/chatgptAuthTokens/refresh",
    "item/permissions/requestApproval",
    "item/tool/call",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request",
  ]);

  assertSourceContains("src-tauri/src/engines/codex.rs", [
    "THREAD_TURNS_LIST_METHODS",
    "thread/turns/list",
    "codex_wire_approval_policy",
    '"approvalsReviewer"',
    "account/chatgptAuthTokens/refresh",
    "thread/realtime/transcriptdone",
  ]);
  assertSourceMatches("src-tauri/src/engines/codex.rs", [
    [
      "thread turns list is used for transcript import",
      /fetch_paginated_data\([\s\S]{0,800}THREAD_TURNS_LIST_METHODS/,
    ],
  ]);

  assertSourceContains("src-tauri/src/engines/codex_event_mapper.rs", [
    '"warning"',
    '"guardianwarning"',
    '"modelverification"',
    '"itemguardianapprovalreviewstarted"',
    '"itemguardianapprovalreviewcompleted"',
    '"itemfilechangepatchupdated"',
    '"commandexecoutputdelta"',
    '"threadrealtimetranscriptdelta"',
    '"threadrealtimetranscriptdone"',
    '"threadrealtimeitemadded"',
    '"mcpserverelicitationrequest"',
    '"itempermissionsrequestapproval"',
    '"itemtoolcall"',
  ]);
  assertSourceContains("src/components/chat/ChatPanel.tsx", [
    "permissionProfile",
  ]);
  assertSourceContains("src/components/chat/CodexRuntimePicker.tsx", [
    "config.permissionProfile",
    "config.approvalsReviewer",
  ]);

  console.log(`Codex app-server chat parity schema check passed: ${schemaRoot}`);
} finally {
  if (generatedDir && !args.keepSchema) {
    rmSync(generatedDir, { recursive: true, force: true });
  }
}
