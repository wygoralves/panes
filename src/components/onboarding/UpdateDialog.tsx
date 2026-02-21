import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getVersion } from "@tauri-apps/api/app";
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
  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <RefreshCw size={18} className="update-dlg-spin" />
      </div>
      <h3 className="confirm-dialog-title">Checking for updates</h3>
      <p className="confirm-dialog-message">This should only take a moment.</p>
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
  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <ArrowUpCircle size={18} />
      </div>
      <h3 className="confirm-dialog-title">v{version} is available</h3>
      <p className="confirm-dialog-message">
        Download and install to get the latest features and fixes.
      </p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          Not now
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onDownload}>
          <Download size={13} />
          Install update
        </button>
      </div>
    </>
  );
}

function DownloadingState() {
  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <Download size={18} />
      </div>
      <h3 className="confirm-dialog-title">Installing update...</h3>
      <div className="update-dlg-progress">
        <div className="update-dlg-progress-bar" />
      </div>
      <p className="confirm-dialog-message" style={{ fontSize: 11.5 }}>
        Please don't close the app.
      </p>
    </>
  );
}

function ReadyState() {
  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--accent">
        <Check size={18} />
      </div>
      <h3 className="confirm-dialog-title">Restarting...</h3>
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
  return (
    <>
      <div className="update-dlg-icon update-dlg-icon--error">
        <AlertCircle size={18} />
      </div>
      <h3 className="confirm-dialog-title">Update failed</h3>
      <p className="confirm-dialog-message">
        {error || "An unexpected error occurred."}
      </p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          Close
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onRetry}>
          <RefreshCw size={13} />
          Try again
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
        {ver ? `Panes v${ver}` : "Panes"}
      </h3>
      <p className="confirm-dialog-message">You're on the latest version.</p>
      <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost confirm-dialog-btn-cancel" onClick={onClose}>
          Close
        </button>
        <button type="button" className="update-dlg-btn-accent" onClick={onCheck}>
          <RefreshCw size={13} />
          Check again
        </button>
      </div>
    </>
  );
}
