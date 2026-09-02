import { useTranslation } from "react-i18next";
import { useElapsedLabel } from "./useElapsedLabel";
import type { ThreadDisplayStatus } from "./statusGrouping";

interface Props {
  status: ThreadDisplayStatus;
  /** Turn start for the working counter. Ignored by every other status. */
  startedAt?: string | null;
  className?: string;
}

const LABEL_KEY_BY_STATUS: Record<ThreadDisplayStatus, string | null> = {
  working: "app:sidebar.statusLabelWorking",
  approval: "app:sidebar.statusLabelApproval",
  failed: "app:sidebar.statusLabelFailed",
  done: "app:sidebar.statusLabelDone",
  ready: null,
};

/** The row's status in words. "ready" is the resting state and renders
 * nothing, so the list stays quiet for threads that need nothing. */
export function ThreadStatusLabel({ status, startedAt = null, className = "" }: Props) {
  const { t } = useTranslation(["app"]);
  const elapsedLabel = useElapsedLabel(status === "working" ? startedAt : null);
  const labelKey = LABEL_KEY_BY_STATUS[status];

  if (!labelKey) return null;

  const label = t(labelKey);

  return (
    <span
      className={`sb-status-label${className ? ` ${className}` : ""}`}
      data-status={status}
      title={label}
    >
      {label}
      {elapsedLabel ? <span className="sb-status-elapsed">{elapsedLabel}</span> : null}
    </span>
  );
}
