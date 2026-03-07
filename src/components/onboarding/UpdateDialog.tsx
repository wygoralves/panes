import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  ArrowUpCircle,
  Download,
  AlertCircle,
  Check,
} from "lucide-react";
import { useUpdateStore } from "../../stores/updateStore";

interface UpdateDialogProps {
  open: boolean;
  onClose: () => void;
}

const CLOSEABLE_STATES = new Set(["idle", "checking", "available", "error"]);

export function UpdateDialog({ open, onClose }: UpdateDialogProps) {
  const { status, version, error, checkForUpdate, downloadAndInstall, resetToIdle, snooze } =
    useUpdateStore();

  const canClose = CLOSEABLE_STATES.has(status);

  useEffect(() => {
    if (open && (status === "idle" || status === "error")) {
      resetToIdle();
      void checkForUpdate();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && CLOSEABLE_STATES.has(useUpdateStore.getState().status)) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) onClose();
      }}
    >
      <div
        className="confirm-dialog-card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 340 }}
      >
        {status === "checking" && <CheckingState />}
        {status === "available" && (
          <AvailableState
            version={version}
            onClose={() => { snooze(); onClose(); }}
            onDownload={() => void downloadAndInstall()}
          />
        )}
        {status === "downloading" && <DownloadingState />}
        {status === "ready" && <ReadyState />}
        {status === "error" && (
          <ErrorState
            error={error}
            onClose={onClose}
            onRetry={() => void checkForUpdate()}
          />
        )}
        {status === "idle" && (
          <IdleState onClose={onClose} onCheck={() => void checkForUpdate()} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function CheckingState() {
  const { t } = useTranslation("app");

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <RefreshCw size={18} className="update-dlg-spin" />
      </div>
      <h3 className="confirm-dialog-title">{t("updates.checkingTitle")}</h3>
      <p className="confirm-dialog-message">{t("updates.checkingMessage")}</p>
    </>
  );
}

function AvailableState({
  version,
  onClose,
  onDownload,
}: {
  version: string | null;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation("app");

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <ArrowUpCircle size={18} />
      </div>
      <h3 className="confirm-dialog-title">{t("updates.availableTitle", { version })}</h3>
      <p className="confirm-dialog-message">{t("updates.availableMessage")}</p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          {t("updates.notNow")}
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onDownload}>
          <Download size={13} />
          {t("updates.install")}
        </button>
      </div>
    </>
  );
}

function DownloadingState() {
  const { t } = useTranslation("app");

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <Download size={18} />
      </div>
      <h3 className="confirm-dialog-title">{t("updates.installingTitle")}</h3>
      <div className="update-dlg-progress">
        <div className="update-dlg-progress-bar" />
      </div>
      <p className="confirm-dialog-message" style={{ fontSize: 11.5 }}>
        {t("updates.installingMessage")}
      </p>
    </>
  );
}

function ReadyState() {
  const { t } = useTranslation("app");

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <Check size={18} />
      </div>
      <h3 className="confirm-dialog-title">{t("updates.restartingTitle")}</h3>
    </>
  );
}

function ErrorState({
  error,
  onClose,
  onRetry,
}: {
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--error">
        <AlertCircle size={18} />
      </div>
      <h3 className="confirm-dialog-title">{t("app:updates.failedTitle")}</h3>
      <p className="confirm-dialog-message">
        {error || t("app:updates.failedMessage")}
      </p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          {t("common:actions.close")}
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onRetry}>
          <RefreshCw size={13} />
          {t("common:actions.retry")}
        </button>
      </div>
    </>
  );
}

function IdleState({
  onClose,
  onCheck,
}: {
  onClose: () => void;
  onCheck: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const [ver, setVer] = useState<string | null>(null);
  useEffect(() => {
    void getVersion().then(setVer);
  }, []);

  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <Check size={18} />
      </div>
      <h3 className="confirm-dialog-title">
        {ver ? t("app:updates.idleTitleWithVersion", { version: ver }) : t("app:updates.idleTitle")}
      </h3>
      <p className="confirm-dialog-message">{t("app:updates.idleMessage")}</p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          {t("common:actions.close")}
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onCheck}>
          <RefreshCw size={13} />
          {t("app:updates.checkAgain")}
        </button>
      </div>
    </>
  );
}
