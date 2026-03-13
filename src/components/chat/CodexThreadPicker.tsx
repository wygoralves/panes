import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, GitBranch, PackageMinus, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CodexThreadPickerProps {
  disabled?: boolean;
  onFork: () => Promise<void>;
  onRollback: (numTurns: number) => Promise<void>;
  onCompact: () => Promise<void>;
}

export function CodexThreadPicker({
  disabled = false,
  onFork,
  onRollback,
  onCompact,
}: CodexThreadPickerProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<"fork" | "rollback" | "compact" | null>(null);
  const [rollbackTurnsText, setRollbackTurnsText] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ bottom: 0, left: 0 });

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

  async function handleFork() {
    setBusyAction("fork");
    setError(null);
    try {
      await onFork();
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRollback() {
    const parsedTurns = Number.parseInt(rollbackTurnsText.trim(), 10);
    if (!Number.isFinite(parsedTurns) || parsedTurns < 1) {
      setError(t("threadPicker.invalidTurns"));
      return;
    }

    setBusyAction("rollback");
    setError(null);
    try {
      await onRollback(parsedTurns);
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCompact() {
    setBusyAction("compact");
    setError(null);
    try {
      await onCompact();
      setOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`chat-toolbar-btn chat-toolbar-btn-bordered${open ? " chat-toolbar-btn-active" : ""}`}
        disabled={disabled || busyAction !== null}
        title={t("threadPicker.title")}
        onClick={() => setOpen((current) => !current)}
      >
        <GitBranch size={12} />
        <span style={{ fontSize: 11 }}>{t("threadPicker.shortTitle")}</span>
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
                <div className="codex-config-title">{t("threadPicker.title")}</div>
                <div className="codex-config-subtitle">
                  {t("threadPicker.subtitle")}
                </div>
              </div>
            </div>

            <div className="codex-config-fields">
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="codex-config-label">{t("threadPicker.forkTitle")}</div>
                <div className="codex-config-note">{t("threadPicker.forkDescription")}</div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleFork()}
                  disabled={busyAction !== null}
                >
                  <GitBranch size={12} />
                  {busyAction === "fork"
                    ? t("threadPicker.working")
                    : t("threadPicker.forkAction")}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="codex-config-label">{t("threadPicker.rollbackTitle")}</div>
                <div className="codex-config-note">
                  {t("threadPicker.rollbackDescription")}
                </div>
                <label className="codex-config-field">
                  <span className="codex-config-note">
                    {t("threadPicker.rollbackTurns")}
                  </span>
                  <input
                    className="codex-config-select"
                    inputMode="numeric"
                    value={rollbackTurnsText}
                    onChange={(event) => setRollbackTurnsText(event.target.value)}
                    disabled={busyAction !== null}
                  />
                </label>
                <div className="codex-config-note">
                  {t("threadPicker.rollbackWarning")}
                </div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleRollback()}
                  disabled={busyAction !== null}
                >
                  <PackageMinus size={12} />
                  {busyAction === "rollback"
                    ? t("threadPicker.working")
                    : t("threadPicker.rollbackAction")}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="codex-config-label">{t("threadPicker.compactTitle")}</div>
                <div className="codex-config-note">
                  {t("threadPicker.compactDescription")}
                </div>
                <button
                  type="button"
                  className="chat-toolbar-btn chat-toolbar-btn-active"
                  onClick={() => void handleCompact()}
                  disabled={busyAction !== null}
                >
                  <Scissors size={12} />
                  {busyAction === "compact"
                    ? t("threadPicker.working")
                    : t("threadPicker.compactAction")}
                </button>
              </div>
            </div>

            {error ? <div className="codex-config-error">{error}</div> : null}
          </div>,
          document.body,
        )}
    </>
  );
}
