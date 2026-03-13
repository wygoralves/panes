import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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

function formatOptionLabel(label: string): string {
  return label.replace(/\s*\((recommended|recomendado)\)\s*$/i, "").trim();
}

export function ToolInputQuestionnaire({ details, onSubmit }: Props) {
  const { t } = useTranslation("chat");
  const questions = useMemo(() => parseToolInputQuestions(details), [details]);
  const questionSignature = useMemo(() => buildQuestionSignature(questions), [questions]);
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string>>(() =>
    defaultToolInputSelections(questions),
  );
  const [customByQuestion, setCustomByQuestion] = useState<Record<string, string>>({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  useEffect(() => {
    setSelectedByQuestion(defaultToolInputSelections(questions));
    setCustomByQuestion({});
    setCurrentQuestionIndex(0);
  }, [questionSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- questions identity changes with signature

  if (!questions.length) {
    return null;
  }

  const currentQuestion = questions[Math.min(currentQuestionIndex, questions.length - 1)];
  const currentSelectedAnswer = selectedByQuestion[currentQuestion.id] ?? "";
  const currentCustomAnswer = customByQuestion[currentQuestion.id] ?? "";
  const isLastQuestion = currentQuestionIndex >= questions.length - 1;
  const canAdvance =
    currentCustomAnswer.trim().length > 0 || currentSelectedAnswer.trim().length > 0;

  function handleAdvance() {
    if (!canAdvance) {
      return;
    }

    if (!isLastQuestion) {
      setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
      return;
    }

    onSubmit(
      buildToolInputResponseFromSelections(
        questions,
        selectedByQuestion,
        customByQuestion,
      ),
    );
  }

  return (
    <div className="chat-tool-input-panel">
      <div className="chat-tool-input-step">
        <span className="chat-tool-input-step-count">
          {t("messageBlocks.toolInput.questionCounter", {
            current: currentQuestionIndex + 1,
            total: questions.length,
          })}
        </span>
        {currentQuestion.header ? (
          <span className="chat-tool-input-step-label">{currentQuestion.header}</span>
        ) : null}
      </div>

      <div className="chat-tool-input-question">{currentQuestion.question}</div>

      {currentQuestion.options.length > 0 && (
        <div className="chat-tool-input-options">
          {currentQuestion.options.map((option) => {
            const selected = currentSelectedAnswer === option.label;
            return (
              <button
                key={option.label}
                type="button"
                className={`chat-tool-input-option${selected ? " chat-tool-input-option-active" : ""}`}
                onClick={() =>
                  setSelectedByQuestion((current) => ({
                    ...current,
                    [currentQuestion.id]: option.label,
                  }))
                }
                title={option.description}
              >
                <span>{formatOptionLabel(option.label)}</span>
                {option.recommended ? (
                  <span className="chat-tool-input-option-badge">
                    {t("messageBlocks.toolInput.recommended")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="chat-tool-input-editor">
        <textarea
          value={currentCustomAnswer}
          onChange={(event) =>
            setCustomByQuestion((current) => ({
              ...current,
              [currentQuestion.id]: event.target.value,
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleAdvance();
            }
          }}
          placeholder={
            currentQuestion.options.length > 0
              ? t("messageBlocks.toolInput.customAnswerPlaceholderOptional")
              : t("messageBlocks.toolInput.customAnswerPlaceholder")
          }
          className="chat-tool-input-textarea"
          rows={3}
        />
      </div>

      <div className="chat-tool-input-actions">
        {currentQuestionIndex > 0 ? (
          <button
            type="button"
            className="chat-tool-input-btn-secondary"
            onClick={() => setCurrentQuestionIndex((current) => Math.max(current - 1, 0))}
          >
            {t("messageBlocks.toolInput.previousQuestion")}
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          className="chat-tool-input-btn-primary"
          onClick={handleAdvance}
          disabled={!canAdvance}
        >
          {isLastQuestion
            ? t("messageBlocks.toolInput.sendAnswers")
            : t("messageBlocks.toolInput.nextQuestion")}
        </button>
      </div>
    </div>
  );
}
