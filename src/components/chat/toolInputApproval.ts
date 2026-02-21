import type { ApprovalResponse } from "../../types";

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
  return method.replace(/[._]/g, "/").toLowerCase();
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
