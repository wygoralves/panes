import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  /** Identity of the request in focus; the card takes focus when it changes. */
  focusKey: string;
  /** Position of the request in focus within the queue. */
  index: number;
  count: number;
  onIndexChange: (next: number) => void;
  icon: ReactNode;
  title: string;
  tone?: "amber" | "info";
  /** Queue-level actions rendered in the head: allow all, trust. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** Decision row rendered in the foot. */
  footer?: ReactNode;
  /** Enter on the card itself. */
  onPrimary?: () => void;
  /** Shift Enter on the card itself. */
  onSecondary?: () => void;
  /** Cmd or Ctrl Backspace. */
  onDeny?: () => void;
  /** Escape: hand focus back to the composer. */
  onEscape?: () => void;
}

function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * One pending request at a time, lifted above the composer. The rest of the
 * queue peeks out behind the card as stacked edges and is reachable with the
 * stepper or the arrow keys.
 */
export function ApprovalDeck({
  focusKey,
  index,
  count,
  onIndexChange,
  icon,
  title,
  tone = "amber",
  headerActions,
  children,
  footer,
  onPrimary,
  onSecondary,
  onDeny,
  onEscape,
}: Props) {
  const { t } = useTranslation("chat");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const active = document.activeElement;
    // Take focus when a request appears unless the user is mid-typing elsewhere.
    if (!active || active === document.body || card.contains(active)) {
      card.focus({ preventScroll: true });
    }
  }, [focusKey]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (isTextTarget(event.target)) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onIndexChange(index - 1);
      return;
    }
    if (event.key === "ArrowDown" && index < count - 1) {
      event.preventDefault();
      onIndexChange(index + 1);
      return;
    }
    if (event.key === "Backspace" && (event.metaKey || event.ctrlKey) && onDeny) {
      event.preventDefault();
      onDeny();
      return;
    }
    if (event.key === "Enter" && event.target === event.currentTarget) {
      if (event.shiftKey && onSecondary) {
        event.preventDefault();
        onSecondary();
      } else if (!event.shiftKey && onPrimary) {
        event.preventDefault();
        onPrimary();
      }
    }
  }

  return (
    <div className="approval-deck">
      <div
        ref={cardRef}
        className={`approval-deck-card${count > 1 ? " approval-deck-card--stack" : ""}`}
        role="group"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="approval-deck-head">
          <span className={`approval-deck-tile approval-deck-tile--${tone}`}>{icon}</span>
          <span className="approval-deck-title" title={title}>
            {title}
          </span>
          <span className="approval-deck-right">
            {count > 1 && (
              <span className="approval-deck-stepper">
                <button
                  type="button"
                  aria-label={t("panel.approvalDeck.previous")}
                  disabled={index <= 0}
                  onClick={() => onIndexChange(index - 1)}
                >
                  <ChevronUp size={12} />
                </button>
                <span>{t("panel.approvalDeck.position", { index: index + 1, count })}</span>
                <button
                  type="button"
                  aria-label={t("panel.approvalDeck.next")}
                  disabled={index >= count - 1}
                  onClick={() => onIndexChange(index + 1)}
                >
                  <ChevronDown size={12} />
                </button>
              </span>
            )}
            {headerActions}
          </span>
        </div>
        <div className="approval-deck-body">{children}</div>
        {footer && <div className="approval-deck-foot">{footer}</div>}
      </div>
    </div>
  );
}
