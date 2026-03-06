import type { ApprovalResponse, DynamicToolCallResponse, NetworkPolicyAmendment } from "../../types";

export interface ToolInputOption {
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface ToolInputQuestion {
  id: string;
  header?: string;
  question: string;
  options: ToolInputOption[];
}

const REQUEST_USER_INPUT_METHOD = "item/tool/requestuserinput";
const DYNAMIC_TOOL_CALL_METHOD = "item/tool/call";

function normalizeServerMethod(method: string): string {
  return method
    .replace(/\./g, "/")
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/[_-]/g, ""))
    .join("/");
}

export function getApprovalServerMethod(details?: Record<string, unknown>): string {
  const serverMethod = typeof details?._serverMethod === "string" ? details._serverMethod : "";
  return normalizeServerMethod(serverMethod);
}

export function isRequestUserInputApproval(details?: Record<string, unknown>): boolean {
  return getApprovalServerMethod(details) === REQUEST_USER_INPUT_METHOD;
}

export function isDynamicToolCallApproval(details?: Record<string, unknown>): boolean {
  return getApprovalServerMethod(details) === DYNAMIC_TOOL_CALL_METHOD;
}

export function requiresCustomApprovalPayload(details?: Record<string, unknown>): boolean {
  return isDynamicToolCallApproval(details);
}

export function defaultAdvancedApprovalPayload(
  details?: Record<string, unknown>
): ApprovalResponse {
  if (isDynamicToolCallApproval(details)) {
    return {
      success: true,
      contentItems: [],
    };
  }

  return { decision: "accept" };
}

function readDetailsValue(
  details: Record<string, unknown> | undefined,
  camelKey: string,
  snakeKey: string,
): unknown {
  if (!details) {
    return undefined;
  }

  if (camelKey in details) {
    return details[camelKey];
  }

  return details[snakeKey];
}

export function parseApprovalCommand(details?: Record<string, unknown>): string | undefined {
  const value = readDetailsValue(details, "command", "command");
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const parts = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  return undefined;
}

export function parseApprovalReason(details?: Record<string, unknown>): string | undefined {
  const value = readDetailsValue(details, "reason", "reason");
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseProposedExecpolicyAmendment(
  details?: Record<string, unknown>
): string[] {
  const value = readDetailsValue(
    details,
    "proposedExecpolicyAmendment",
    "proposed_execpolicy_amendment",
  );
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

export function parseProposedNetworkPolicyAmendments(
  details?: Record<string, unknown>
): NetworkPolicyAmendment[] {
  const value = readDetailsValue(
    details,
    "proposedNetworkPolicyAmendments",
    "proposed_network_policy_amendments",
  );
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const amendment = entry as Record<string, unknown>;
      const host = typeof amendment.host === "string" ? amendment.host.trim() : "";
      const action = amendment.action;
      if (!host || (action !== "allow" && action !== "deny")) {
        return null;
      }

      return {
        host,
        action,
      } satisfies NetworkPolicyAmendment;
    })
    .filter((entry): entry is NetworkPolicyAmendment => Boolean(entry));
}

export function parseDynamicToolCallName(details?: Record<string, unknown>): string | undefined {
  const tool =
    typeof details?.tool === "string"
      ? details.tool.trim()
      : typeof details?.name === "string"
        ? details.name.trim()
        : "";
  return tool.length > 0 ? tool : undefined;
}

export function parseDynamicToolCallArguments(
  details?: Record<string, unknown>
): Record<string, unknown> | null {
  const value = details?.arguments;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function buildDynamicToolCallResponse(
  text: string,
  success: boolean,
  imageUrl?: string
): DynamicToolCallResponse {
  const contentItems: DynamicToolCallResponse["contentItems"] = [];
  const normalizedText = text.trim();
  const normalizedImageUrl = imageUrl?.trim();

  if (normalizedText) {
    contentItems.push({
      type: "inputText",
      text: normalizedText,
    });
  }

  if (normalizedImageUrl) {
    contentItems.push({
      type: "inputImage",
      imageUrl: normalizedImageUrl,
    });
  }

  return {
    success,
    contentItems,
  };
}

function parseOption(raw: unknown): ToolInputOption | null {
  if (typeof raw === "string") {
    const label = raw.trim();
    if (!label) {
      return null;
    }
    return {
      label,
      recommended: /\(recommended\)/i.test(label),
    };
  }

  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const optionObj = raw as Record<string, unknown>;
  const labelValue = optionObj.label ?? optionObj.value;
  const label = typeof labelValue === "string" ? labelValue.trim() : "";
  if (!label) {
    return null;
  }

  const description =
    typeof optionObj.description === "string" ? optionObj.description.trim() : undefined;
  const recommendedFlag = optionObj.recommended === true;
  return {
    label,
    description: description || undefined,
    recommended: recommendedFlag || /\(recommended\)/i.test(label),
  };
}

export function parseToolInputQuestions(details: Record<string, unknown>): ToolInputQuestion[] {
  const rawQuestions = details.questions;
  if (!Array.isArray(rawQuestions)) {
    return [];
  }

  const questions: ToolInputQuestion[] = [];
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const raw = rawQuestions[index];
    if (typeof raw !== "object" || raw === null) {
      continue;
    }

    const questionObj = raw as Record<string, unknown>;
    const idCandidate = questionObj.id;
    const questionId =
      typeof idCandidate === "string" && idCandidate.trim()
        ? idCandidate.trim()
        : `question-${index + 1}`;

    const header =
      typeof questionObj.header === "string" && questionObj.header.trim()
        ? questionObj.header.trim()
        : undefined;
    const questionText =
      typeof questionObj.question === "string" && questionObj.question.trim()
        ? questionObj.question.trim()
        : header ?? "";

    if (!questionText) {
      continue;
    }

    const options = Array.isArray(questionObj.options)
      ? questionObj.options
          .map(parseOption)
          .filter((option): option is ToolInputOption => Boolean(option))
      : [];

    questions.push({
      id: questionId,
      header,
      question: questionText,
      options,
    });
  }

  return questions;
}

function defaultAnswerForQuestion(question: ToolInputQuestion): string {
  const recommended = question.options.find((option) => option.recommended);
  if (recommended) {
    return recommended.label;
  }
  return question.options[0]?.label ?? "";
}

export function defaultToolInputSelections(
  questions: ToolInputQuestion[]
): Record<string, string> {
  const selections: Record<string, string> = {};
  for (const question of questions) {
    const answer = defaultAnswerForQuestion(question);
    if (answer) {
      selections[question.id] = answer;
    }
  }
  return selections;
}

export function buildToolInputResponseFromSelections(
  questions: ToolInputQuestion[],
  selectedByQuestion: Record<string, string>,
  customByQuestion?: Record<string, string>
): ApprovalResponse {
  const answers: Record<string, { answers: string[] }> = {};

  for (const question of questions) {
    const customAnswer = customByQuestion?.[question.id]?.trim();
    const selectedAnswer = selectedByQuestion[question.id]?.trim();
    const fallbackAnswer = defaultAnswerForQuestion(question).trim();
    const finalAnswer = customAnswer || selectedAnswer || fallbackAnswer;

    answers[question.id] = { answers: finalAnswer ? [finalAnswer] : [] };
  }

  return { answers };
}
