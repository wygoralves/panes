import { useEffect, useRef, useState } from "react";

interface Props {
  className: string;
  label: string;
  renameLabel: string;
  onRename: (title: string) => Promise<boolean>;
}

export function InlineThreadTitle({
  className,
  label,
  renameLabel,
  onRename,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [saving, setSaving] = useState(false);
  const [refocusAfterFailure, setRefocusAfterFailure] = useState(false);
  const cancelOnBlurRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // A failed rename keeps the user in the field. Focus has to wait for the
  // re-render that re-enables the input: focusing a disabled input is a no-op,
  // and `saving` only flips after this render commits.
  useEffect(() => {
    if (saving || !refocusAfterFailure) return;
    setRefocusAfterFailure(false);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [refocusAfterFailure, saving]);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [editing, label]);

  function startEditing() {
    if (saving) return;
    setDraft(label);
    setEditing(true);
  }

  async function finishEditing() {
    if (cancelOnBlurRef.current) {
      cancelOnBlurRef.current = false;
      setDraft(label);
      setEditing(false);
      return;
    }

    const normalized = draft.trim();
    if (!normalized || normalized === label.trim()) {
      setDraft(label);
      setEditing(false);
      return;
    }

    setSaving(true);
    const renamed = await onRename(normalized);
    setSaving(false);
    if (renamed) {
      setEditing(false);
    } else {
      setRefocusAfterFailure(true);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${className} sb-thread-title-input`}
        value={draft}
        disabled={saving}
        aria-label={renameLabel}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void finishEditing()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelOnBlurRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <span
      className={className}
      // Titles truncate, so the tooltip has to carry the thread name. The
      // rename hint stays on the input's aria-label.
      title={label}
      onDoubleClick={(event) => {
        event.stopPropagation();
        startEditing();
      }}
    >
      {label}
    </span>
  );
}
