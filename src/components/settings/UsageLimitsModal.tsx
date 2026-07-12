import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useUiStore } from "../../stores/uiStore";
import { UsageLimitsSettings } from "./UsageLimitsSettings";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function UsageLimitsModal() {
  const open = useUiStore((state) => state.usageLimitsModalOpen);
  const close = useUiStore((state) => state.closeUsageLimitsModal);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => close(), [close]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 30);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        handleClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      const previousFocus = previousFocusRef.current;
      const fallback = document.querySelector<HTMLButtonElement>(".sb-settings-btn");
      window.setTimeout(() => {
        if (previousFocus?.isConnected) {
          previousFocus.focus();
        } else {
          fallback?.focus();
        }
      }, 0);
    };
  }, [handleClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ws-modal usage-limits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-limits-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <UsageLimitsSettings
          surface="modal"
          onClose={handleClose}
          closeButtonRef={closeButtonRef}
        />
      </div>
    </div>,
    document.body,
  );
}
