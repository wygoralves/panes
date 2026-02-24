import { describe, expect, it } from "vitest";
import {
  getApprovalServerMethod,
  isRequestUserInputApproval,
  isDynamicToolCallApproval,
  requiresCustomApprovalPayload,
  defaultAdvancedApprovalPayload,
  parseToolInputQuestions,
  defaultToolInputSelections,
  buildToolInputResponseFromSelections,
} from "../src/components/chat/toolInputApproval";

describe("getApprovalServerMethod", () => {
  it("normalizes dots to slashes and lowercases", () => {
    expect(
      getApprovalServerMethod({ _serverMethod: "Item.Tool.RequestUserInput" }),
    ).toBe("item/tool/requestuserinput");
  });

  it("strips underscores within segments", () => {
    expect(
      getApprovalServerMethod({ _serverMethod: "item_tool_call" }),
    ).toBe("itemtoolcall");
  });

  it("normalizes dot-separated underscored segments", () => {
    expect(
      getApprovalServerMethod({ _serverMethod: "item.tool_call.request" }),
    ).toBe("item/toolcall/request");
  });

  it("returns empty string when _serverMethod is missing", () => {
    expect(getApprovalServerMethod({})).toBe("");
    expect(getApprovalServerMethod(undefined)).toBe("");
  });

  it("returns empty string when _serverMethod is not a string", () => {
    expect(getApprovalServerMethod({ _serverMethod: 42 })).toBe("");
    expect(getApprovalServerMethod({ _serverMethod: null })).toBe("");
  });
});

describe("isRequestUserInputApproval", () => {
  it("returns true for request user input method", () => {
    expect(
      isRequestUserInputApproval({ _serverMethod: "item.tool.requestuserinput" }),
    ).toBe(true);
  });

  it("returns false for other methods", () => {
    expect(isRequestUserInputApproval({ _serverMethod: "item.tool.call" })).toBe(false);
    expect(isRequestUserInputApproval({})).toBe(false);
  });
});

describe("isDynamicToolCallApproval", () => {
  it("returns true for tool call method", () => {
    expect(
      isDynamicToolCallApproval({ _serverMethod: "item.tool.call" }),
    ).toBe(true);
  });

  it("returns false for other methods", () => {
    expect(
      isDynamicToolCallApproval({ _serverMethod: "item.tool.requestuserinput" }),
    ).toBe(false);
  });
});

describe("requiresCustomApprovalPayload", () => {
  it("returns true only for dynamic tool call", () => {
    expect(
      requiresCustomApprovalPayload({ _serverMethod: "item.tool.call" }),
    ).toBe(true);
    expect(
      requiresCustomApprovalPayload({ _serverMethod: "item.tool.requestuserinput" }),
    ).toBe(false);
  });
});

describe("defaultAdvancedApprovalPayload", () => {
  it("returns success payload for dynamic tool call", () => {
    const result = defaultAdvancedApprovalPayload({ _serverMethod: "item.tool.call" });
    expect(result).toEqual({ success: true, contentItems: [] });
  });

  it("returns accept decision for other methods", () => {
    const result = defaultAdvancedApprovalPayload({});
    expect(result).toEqual({ decision: "accept" });
  });
});

describe("parseToolInputQuestions", () => {
  it("returns empty array when questions is not an array", () => {
    expect(parseToolInputQuestions({})).toEqual([]);
    expect(parseToolInputQuestions({ questions: "not an array" })).toEqual([]);
    expect(parseToolInputQuestions({ questions: null })).toEqual([]);
  });

  it("parses well-formed questions with string options", () => {
    const details = {
      questions: [
        {
          id: "q1",
          header: "Auth",
          question: "Which auth method?",
          options: ["OAuth", "JWT", "Basic (Recommended)"],
        },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("q1");
    expect(result[0].header).toBe("Auth");
    expect(result[0].question).toBe("Which auth method?");
    expect(result[0].options).toHaveLength(3);
    expect(result[0].options[2].recommended).toBe(true);
    expect(result[0].options[0].recommended).toBe(false);
  });

  it("parses object options with label, description, recommended", () => {
    const details = {
      questions: [
        {
          id: "q1",
          question: "Pick one",
          options: [
            { label: "A", description: "Option A", recommended: true },
            { value: "B", description: "Option B" },
          ],
        },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result[0].options).toHaveLength(2);
    expect(result[0].options[0]).toEqual({
      label: "A",
      description: "Option A",
      recommended: true,
    });
    expect(result[0].options[1]).toEqual({
      label: "B",
      description: "Option B",
      recommended: false,
    });
  });

  it("generates sequential ids when missing", () => {
    const details = {
      questions: [
        { question: "First?" },
        { question: "Second?" },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result[0].id).toBe("question-1");
    expect(result[1].id).toBe("question-2");
  });

  it("skips questions with no question text", () => {
    const details = {
      questions: [
        { id: "q1" },
        { id: "q2", question: "  " },
        { id: "q3", question: "Valid?" },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("q3");
  });

  it("uses header as question text fallback", () => {
    const details = {
      questions: [{ id: "q1", header: "Framework" }],
    };

    const result = parseToolInputQuestions(details);
    expect(result[0].question).toBe("Framework");
  });

  it("skips non-object entries in questions array", () => {
    const details = {
      questions: [null, "string", 42, { question: "Valid?" }],
    };

    const result = parseToolInputQuestions(details);
    expect(result).toHaveLength(1);
  });

  it("filters out empty string options", () => {
    const details = {
      questions: [
        { question: "Choose", options: ["", "  ", "Valid"] },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result[0].options).toHaveLength(1);
    expect(result[0].options[0].label).toBe("Valid");
  });

  it("filters out invalid object options", () => {
    const details = {
      questions: [
        {
          question: "Choose",
          options: [null, { label: "" }, { label: "Good" }],
        },
      ],
    };

    const result = parseToolInputQuestions(details);
    expect(result[0].options).toHaveLength(1);
    expect(result[0].options[0].label).toBe("Good");
  });
});

describe("defaultToolInputSelections", () => {
  it("picks recommended option when available", () => {
    const questions = [
      {
        id: "q1",
        question: "Pick",
        options: [
          { label: "A" },
          { label: "B", recommended: true },
        ],
      },
    ];

    expect(defaultToolInputSelections(questions)).toEqual({ q1: "B" });
  });

  it("falls back to first option when no recommended", () => {
    const questions = [
      {
        id: "q1",
        question: "Pick",
        options: [{ label: "First" }, { label: "Second" }],
      },
    ];

    expect(defaultToolInputSelections(questions)).toEqual({ q1: "First" });
  });

  it("returns empty object for questions with no options", () => {
    const questions = [
      { id: "q1", question: "Pick", options: [] },
    ];

    expect(defaultToolInputSelections(questions)).toEqual({});
  });
});

describe("buildToolInputResponseFromSelections", () => {
  it("builds response from selected answers", () => {
    const questions = [
      {
        id: "q1",
        question: "Pick",
        options: [{ label: "A" }, { label: "B" }],
      },
      {
        id: "q2",
        question: "Choose",
        options: [{ label: "X" }, { label: "Y" }],
      },
    ];

    const selections = { q1: "B", q2: "X" };
    const result = buildToolInputResponseFromSelections(questions, selections);

    expect(result).toEqual({
      answers: {
        q1: { answers: ["B"] },
        q2: { answers: ["X"] },
      },
    });
  });

  it("prefers custom answer over selected answer", () => {
    const questions = [
      { id: "q1", question: "Pick", options: [{ label: "A" }] },
    ];

    const selections = { q1: "A" };
    const custom = { q1: "Custom answer" };
    const result = buildToolInputResponseFromSelections(questions, selections, custom);

    expect(result).toEqual({
      answers: { q1: { answers: ["Custom answer"] } },
    });
  });

  it("falls back to default answer when no selection", () => {
    const questions = [
      {
        id: "q1",
        question: "Pick",
        options: [{ label: "Default", recommended: true }],
      },
    ];

    const result = buildToolInputResponseFromSelections(questions, {});
    expect(result).toEqual({
      answers: { q1: { answers: ["Default"] } },
    });
  });

  it("ignores blank custom answers", () => {
    const questions = [
      { id: "q1", question: "Pick", options: [{ label: "A" }] },
    ];

    const selections = { q1: "A" };
    const custom = { q1: "   " };
    const result = buildToolInputResponseFromSelections(questions, selections, custom);

    expect(result).toEqual({
      answers: { q1: { answers: ["A"] } },
    });
  });
});
