import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useHarnessStore } from "../../stores/harnessStore";
import { toast } from "../../stores/toastStore";
import { getHarnessIcon } from "../shared/HarnessLogos";
import type { HarnessInfo } from "../../types";

const SUGGESTED_FLAGS: Record<string, string> = {
  codex: "--yolo",
  "claude-code": "--dangerously-skip-permissions",
};

interface Props {
  harness: HarnessInfo;
  onClose: () => void;
}

export function HarnessLaunchSettingsModal({ harness, onClose }: Props) {
  const { t } = useTranslation("app");
  const savedArgs = useHarnessStore((s) => s.launchArgs[harness.id] ?? "");
  const saveLaunchArgs = useHarnessStore((s) => s.saveLaunchArgs);
  const [value, setValue] = useState(savedArgs);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const ok = await saveLaunchArgs(harness.id, value);
    setSaving(false);
    if (ok) {
      toast.success(t("harnesses.launchSettings.saved"));
      onClose();
    } else {
      toast.error(t("harnesses.launchSettings.saveFailed"));
    }
  }, [harness.id, onClose, saveLaunchArgs, t, value]);

  const trimmed = value.trim();
  const preview = trimmed ? `${harness.command} ${trimmed}` : harness.command;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ws-modal" style={{ width: "min(460px, calc(100vw - 40px))" }}>
        <div className="ws-header">
          <div className="ws-header-icon">{getHarnessIcon(harness.id, 18)}</div>
          <div className="ws-header-text">
            <h2 className="ws-header-title">{t("harnesses.launchSettings.title")}</h2>
            <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>
              {t("harnesses.launchSettings.description", { name: harness.name })}
            </p>
          </div>
          <button
            type="button"
            className="ws-close"
            onClick={onClose}
            aria-label={t("harnesses.launchSettings.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="ws-divider" />

        <div className="ws-body">
          <label className="hp-args-field">
            <span>{t("harnesses.launchSettings.argsLabel")}</span>
            <input
              className="hp-args-input"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !saving) void handleSave();
              }}
              placeholder={SUGGESTED_FLAGS[harness.id] ?? t("harnesses.launchSettings.argsPlaceholder")}
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="hp-args-preview">
            <span>{t("harnesses.launchSettings.preview")}</span>
            <code>{preview}</code>
          </div>
        </div>

        <div className="ws-footer">
          <span className="ws-footer-meta" />
          <div className="ws-footer-actions">
            <button type="button" className="ws-prop-btn" onClick={onClose}>
              {t("harnesses.launchSettings.cancel")}
            </button>
            <button
              type="button"
              className="ws-prop-btn ws-prop-btn-accent"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {t("harnesses.launchSettings.save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
