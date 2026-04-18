import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Clock,
  GitBranch,
  Globe,
  Loader2,
  Mic,
} from "lucide-react";

export type Language = "auto" | "en" | "pt";
export type Sources = "mic" | "system" | "both";

interface Props {
  title: string;
  onTitleChange: (value: string) => void;
  titleDisabled: boolean;
  whenLabel: string;
  durationLabel: string | null;
  repo: string | null;
  language: Language;
  onLanguageChange: (v: Language) => void;
  sources: Sources;
  onSourcesChange: (v: Sources) => void;
  isSaving: boolean;
  settingsLocked: boolean;
  onNewMeeting?: () => void;
  newMeetingDisabled?: boolean;
}

export function DocHeader({
  title,
  onTitleChange,
  titleDisabled,
  whenLabel,
  durationLabel,
  repo,
  language,
  onLanguageChange,
  sources,
  onSourcesChange,
  isSaving,
  settingsLocked,
  onNewMeeting,
  newMeetingDisabled,
}: Props) {
  const { t } = useTranslation("app");
  return (
    <div className="mr-doc-header">
      <div className="mr-doc-title-row">
        <input
          className="mr-doc-title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t("meetings.titlePlaceholder")}
          disabled={titleDisabled}
        />
        {isSaving ? (
          <span className="mr-saving">
            <Loader2 size={10} className="animate-spin" />
            {t("meetings.saving")}
          </span>
        ) : null}
        {onNewMeeting ? (
          <div className="mr-doc-header-actions">
            <button
              type="button"
              className="mr-header-record-btn"
              onClick={onNewMeeting}
              disabled={newMeetingDisabled}
              title={t("meetings.newMeetingHint")}
            >
              <span className="mr-header-rec-dot" />
              {t("meetings.recordNewMeeting")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="mr-doc-meta-row">
        <span className="mr-meta">
          <Calendar size={12} strokeWidth={1.5} />
          <strong>{whenLabel}</strong>
        </span>
        {durationLabel ? (
          <span className="mr-meta">
            <Clock size={12} strokeWidth={1.5} />
            <strong>{durationLabel}</strong>
          </span>
        ) : null}
        {repo ? (
          <span className="mr-chip mr-chip-repo" title={repo}>
            <GitBranch size={10} strokeWidth={1.75} />
            {repo}
          </span>
        ) : null}
        <LanguageChip
          value={language}
          onChange={onLanguageChange}
          disabled={settingsLocked}
        />
        <SourcesChip
          value={sources}
          onChange={onSourcesChange}
          disabled={settingsLocked}
        />
      </div>
    </div>
  );
}

function LanguageChip({
  value,
  onChange,
  disabled,
}: {
  value: Language;
  onChange: (v: Language) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("app");
  const options: { v: Language; label: string }[] = [
    { v: "auto", label: t("meetings.languageAuto") },
    { v: "en", label: "EN" },
    { v: "pt", label: "PT" },
  ];
  const active = options.find((o) => o.v === value) ?? options[0];
  return (
    <PopoverChip
      disabled={disabled}
      className="mr-chip-lang"
      icon={<Globe size={10} strokeWidth={1.75} />}
      label={active.label}
      render={(close) => (
        <>
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              className={`mr-chip-popover-item${value === o.v ? " on" : ""}`}
              onClick={() => {
                onChange(o.v);
                close();
              }}
            >
              {o.label}
            </button>
          ))}
        </>
      )}
    />
  );
}

function SourcesChip({
  value,
  onChange,
  disabled,
}: {
  value: Sources;
  onChange: (v: Sources) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("app");
  const options: { v: Sources; label: string }[] = [
    { v: "both", label: t("meetings.sourceBoth") },
    { v: "mic", label: t("meetings.sourceMic") },
    { v: "system", label: t("meetings.sourceSystem") },
  ];
  const active = options.find((o) => o.v === value) ?? options[0];
  return (
    <PopoverChip
      disabled={disabled}
      icon={<Mic size={10} strokeWidth={1.75} />}
      label={active.label}
      render={(close) => (
        <>
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              className={`mr-chip-popover-item${value === o.v ? " on" : ""}`}
              onClick={() => {
                onChange(o.v);
                close();
              }}
            >
              {o.label}
            </button>
          ))}
        </>
      )}
    />
  );
}

function PopoverChip({
  icon,
  label,
  className,
  disabled,
  render,
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
  disabled: boolean;
  render: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="mr-chip-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`mr-chip mr-chip-button${className ? ` ${className}` : ""}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
      </button>
      {open ? (
        <div className="mr-chip-popover">{render(() => setOpen(false))}</div>
      ) : null}
    </span>
  );
}
