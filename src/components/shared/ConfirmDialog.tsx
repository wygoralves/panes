import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional third action rendered between cancel and confirm. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Which button takes focus on open, so Return runs it. Defaults to confirm. */
  initialFocus?: "confirm" | "secondary";
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  onSecondary,
  initialFocus = "confirm",
  onConfirm,
  onCancel,
  onDismiss,
}: Props) {
  const { t } = useTranslation("common");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);
  const handleDismiss = onDismiss ?? onCancel;
  const resolvedConfirmLabel = confirmLabel ?? t("actions.discard");
  const resolvedCancelLabel = cancelLabel ?? t("actions.cancel");

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const target = initialFocus === "secondary" ? secondaryRef.current : null;
      (target ?? confirmRef.current)?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleDismiss();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, handleDismiss]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="confirm-dialog-backdrop" onMouseDown={handleDismiss}>
      <div
        className="confirm-dialog-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-icon">
          <AlertTriangle size={22} />
        </div>
        <h3 className="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn btn-ghost confirm-dialog-btn-cancel"
            onClick={onCancel}
          >
            {resolvedCancelLabel}
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              ref={secondaryRef}
              type="button"
              className="btn btn-outline confirm-dialog-btn-cancel"
              onClick={onSecondary}
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            ref={confirmRef}
            type="button"
            className="confirm-dialog-btn-danger"
            onClick={onConfirm}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
