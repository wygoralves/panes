import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "../../stores/toastStore";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const;

const EXIT_MS = 200;

function ToastItem({
  id,
  variant,
  message,
  title,
  action,
  duration,
}: {
  id: string;
  variant: "success" | "error" | "warning" | "info";
  message: string;
  title?: string;
  action?: { label: string; onClick: () => void };
  duration: number;
}) {
  const { t } = useTranslation("common");
  const dismissToast = useToastStore((s) => s.dismissToast);
  const exitingRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const itemRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (itemRef.current) itemRef.current.setAttribute("data-exiting", "");
    exitTimerRef.current = setTimeout(() => dismissToast(id), EXIT_MS);
  }, [dismissToast, id]);

  useEffect(() => {
    if (duration > 0) {
      autoTimerRef.current = setTimeout(dismiss, duration);
    }
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [duration, dismiss]);

  const handleAction = useCallback(() => {
    action?.onClick();
    dismiss();
  }, [action, dismiss]);

  const Icon = ICONS[variant];

  return (
    <div
      ref={itemRef}
      className={`toast-item toast-${variant}`}
      role="status"
    >
      <div className="toast-accent" />
      <Icon size={16} className="toast-icon" />
      {title || action ? (
        <div className="toast-content">
          {title && <span className="toast-title">{title}</span>}
          <span className="toast-message">{message}</span>
          {action && (
            <button type="button" className="toast-action" onClick={handleAction}>
              {action.label}
            </button>
          )}
        </div>
      ) : (
        <span className="toast-message">{message}</span>
      )}
      <button className="toast-dismiss" onClick={dismiss} aria-label={t("actions.dismiss")}>
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          id={t.id}
          variant={t.variant}
          message={t.message}
          title={t.title}
          action={t.action}
          duration={t.duration}
        />
      ))}
    </div>,
    document.body,
  );
}
