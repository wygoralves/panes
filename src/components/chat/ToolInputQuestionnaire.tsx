import { useEffect, useMemo, useState } from "react";
import type { ApprovalResponse } from "../../types";
import {
  buildToolInputResponseFromSelections,
  defaultToolInputSelections,
  parseToolInputQuestions,
} from "./toolInputApproval";

interface Props {
  details: Record<string, unknown>;
  onSubmit: (response: ApprovalResponse) => void;
}

function buildQuestionSignature(questions: ReturnType<typeof parseToolInputQuestions>): string {
  return questions
    .map((question) => {
      const optionsSignature = question.options.map((option) => option.label).join(",");
      return `${question.id}:${question.question}:${optionsSignature}`;
    })
    .join("|");
}

export function ToolInputQuestionnaire({ details, onSubmit }: Props) {
  const questions = useMemo(() => parseToolInputQuestions(details), [details]);
  const questionSignature = useMemo(() => buildQuestionSignature(questions), [questions]);
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string>>(() =>
    defaultToolInputSelections(questions)
  );
  const [customByQuestion, setCustomByQuestion] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelectedByQuestion(defaultToolInputSelections(questions));
    setCustomByQuestion({});
  }, [questionSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- questions identity changes with signature

  if (!questions.length) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {questions.map((question) => (
        <div
          key={question.id}
          style={{
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-3)",
            padding: "8px 10px",
          }}
        >
          {question.header && (
            <div style={{ fontSize: 10.5, color: "var(--text-3)", marginBottom: 4 }}>
              {question.header}
            </div>
          )}

          <div style={{ fontSize: 12.5, color: "var(--text-1)", marginBottom: 8 }}>
            {question.question}
          </div>

          {question.options.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {question.options.map((option) => {
                const selected = selectedByQuestion[question.id] === option.label;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className="btn-ghost"
                    onClick={() =>
                      setSelectedByQuestion((current) => ({
                        ...current,
                        [question.id]: option.label,
                      }))
                    }
                    style={{
                      padding: "5px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                      border: selected
                        ? "1px solid var(--success)"
                        : "1px solid var(--border)",
                      background: selected ? "rgba(52, 211, 153, 0.12)" : "var(--bg-2)",
                    }}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}

          <input
            type="text"
            value={customByQuestion[question.id] ?? ""}
            onChange={(event) =>
              setCustomByQuestion((current) => ({
                ...current,
                [question.id]: event.target.value,
              }))
            }
            placeholder="Other answer (optional)"
            style={{
              marginTop: 8,
              width: "100%",
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-2)",
              color: "var(--text-1)",
              fontSize: 12,
            }}
          />
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn-primary"
          onClick={() =>
            onSubmit(
              buildToolInputResponseFromSelections(
                questions,
                selectedByQuestion,
                customByQuestion
              )
            )
          }
          style={{ padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
        >
          Send answers
        </button>
      </div>
    </div>
  );
}

