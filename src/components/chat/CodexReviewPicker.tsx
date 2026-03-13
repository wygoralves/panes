import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CodexReviewDelivery, CodexReviewTarget } from "../../types";

interface CodexReviewPickerProps {
  disabled?: boolean;
  defaultBaseBranch?: string | null;
  onStartReview: (request: {
    target: CodexReviewTarget;
    delivery: CodexReviewDelivery;
  }) => Promise<void>;
}

type ReviewTargetMode =
  | "uncommittedChanges"
  | "baseBranch"
  | "commit"
  | "custom";

export function CodexReviewPicker({
  disabled = false,
  defaultBaseBranch,
  onStartReview,
}: CodexReviewPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetMode, setTargetMode] =
    useState<ReviewTargetMode>("uncommittedChanges");
  const [delivery, setDelivery] = useState<CodexReviewDelivery>("inline");
  const [baseBranch, setBaseBranch] = useState(defaultBaseBranch ?? "");
  const [commitSha, setCommitSha] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

  useEffect(() => {
    setBaseBranch(defaultBaseBranch ?? "");
  }, [defaultBaseBranch]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 420));
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left,
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleStartReview() {
    let target: CodexReviewTarget;

    if (targetMode === "uncommittedChanges") {
      target = { type: "uncommittedChanges" };
    } else if (targetMode === "baseBranch") {
      const branch = baseBranch.trim();
      if (!branch) {
        setError(t("reviewPicker.errors.branchRequired"));
        return;
      }
      target = { type: "baseBranch", branch };
    } else if (targetMode === "commit") {
      const sha = commitSha.trim();
      if (!sha) {
        setError(t("reviewPicker.errors.commitRequired"));
        return;
      }
      target = { type: "commit", sha };
    } else {
      const instructions = customInstructions.trim();
      if (!instructions) {
        setError(t("reviewPicker.errors.instructionsRequired"));
        return;
      }
      target = { type: "custom", instructions };
    }

    setBusy(true);
    setError(null);
    try {
      await onStartReview({ target, delivery });
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`chat-toolbar-btn chat-toolbar-btn-bordered${open ? " chat-toolbar-btn-active" : ""}`}
        disabled={disabled || busy}
        title={t("reviewPicker.title")}
        onClick={() => setOpen((current) => !current)}
      >
        <Search size={12} />
        <span style={{ fontSize: 11 }}>{t("reviewPicker.shortTitle")}</span>
        <ChevronDown size={12} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="codex-config-popover"
            style={{
              position: "fixed",
              zIndex: 1300,
              bottom: pos.bottom,
              left: pos.left,
              width: "min(400px, calc(100vw - 16px))",
            }}
          >
            <div className="codex-config-header">
              <div>
                <div className="codex-config-title">{t("reviewPicker.title")}</div>
                <div className="codex-config-subtitle">
                  {t("reviewPicker.subtitle")}
                </div>
              </div>
            </div>

            <div className="codex-config-fields">
              <label className="codex-config-field">
                <span className="codex-config-label">
                  {t("reviewPicker.targetLabel")}
                </span>
                <select
                  className="codex-config-select"
                  value={targetMode}
                  onChange={(event) =>
                    setTargetMode(event.target.value as ReviewTargetMode)
                  }
                  disabled={busy}
                >
                  <option value="uncommittedChanges">
                    {t("reviewPicker.targets.uncommittedChanges")}
                  </option>
                  <option value="baseBranch">
                    {t("reviewPicker.targets.baseBranch")}
                  </option>
                  <option value="commit">
                    {t("reviewPicker.targets.commit")}
                  </option>
                  <option value="custom">
                    {t("reviewPicker.targets.custom")}
                  </option>
                </select>
              </label>

              <label className="codex-config-field">
                <span className="codex-config-label">
                  {t("reviewPicker.deliveryLabel")}
                </span>
                <select
                  className="codex-config-select"
                  value={delivery}
                  onChange={(event) =>
                    setDelivery(event.target.value as CodexReviewDelivery)
                  }
                  disabled={busy}
                >
                  <option value="inline">
                    {t("reviewPicker.delivery.inline")}
                  </option>
                  <option value="detached">
                    {t("reviewPicker.delivery.detached")}
                  </option>
                </select>
              </label>

              {targetMode === "uncommittedChanges" ? (
                <div className="codex-config-note">
                  {t("reviewPicker.targetDescriptions.uncommittedChanges")}
                </div>
              ) : null}

              {targetMode === "baseBranch" ? (
                <label className="codex-config-field">
                  <span className="codex-config-note">
                    {t("reviewPicker.branchLabel")}
                  </span>
                  <input
                    className="codex-config-select"
                    value={baseBranch}
                    onChange={(event) => setBaseBranch(event.target.value)}
                    placeholder={t("reviewPicker.branchPlaceholder")}
                    disabled={busy}
                  />
                  <span className="codex-config-note">
                    {t("reviewPicker.targetDescriptions.baseBranch")}
                  </span>
                </label>
              ) : null}

              {targetMode === "commit" ? (
                <label className="codex-config-field">
                  <span className="codex-config-note">
                    {t("reviewPicker.commitLabel")}
                  </span>
                  <input
                    className="codex-config-select"
                    value={commitSha}
                    onChange={(event) => setCommitSha(event.target.value)}
                    placeholder={t("reviewPicker.commitPlaceholder")}
                    disabled={busy}
                  />
                  <span className="codex-config-note">
                    {t("reviewPicker.targetDescriptions.commit")}
                  </span>
                </label>
              ) : null}

              {targetMode === "custom" ? (
                <label className="codex-config-field">
                  <span className="codex-config-note">
                    {t("reviewPicker.instructionsLabel")}
                  </span>
                  <textarea
                    className="codex-config-input"
                    value={customInstructions}
                    onChange={(event) => setCustomInstructions(event.target.value)}
                    placeholder={t("reviewPicker.instructionsPlaceholder")}
                    rows={4}
                    disabled={busy}
                    spellCheck={false}
                    style={{ resize: "vertical" }}
                  />
                  <span className="codex-config-note">
                    {t("reviewPicker.targetDescriptions.custom")}
                  </span>
                </label>
              ) : null}

              <div className="codex-config-note">
                {delivery === "detached"
                  ? t("reviewPicker.deliveryDescriptions.detached")
                  : t("reviewPicker.deliveryDescriptions.inline")}
              </div>

              <button
                type="button"
                className="chat-toolbar-btn chat-toolbar-btn-active"
                onClick={() => void handleStartReview()}
                disabled={busy}
              >
                <Search size={12} />
                {busy ? t("reviewPicker.working") : t("reviewPicker.startAction")}
              </button>
            </div>

            {error ? <div className="codex-config-error">{error}</div> : null}
          </div>,
          document.body,
        )}
    </>
  );
}
