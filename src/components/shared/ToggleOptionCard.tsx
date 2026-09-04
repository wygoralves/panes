import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/** Card-sized switch: icon, title, one-line description, and a mini toggle.
 * Shared by the terminal launch menu and the composer branch picker. */
export function ToggleOptionCard({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled = false,
}: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`tnd-option-card${checked ? " tnd-option-card-active" : ""}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      disabled={disabled}
    >
      <div className="tnd-option-icon">{icon}</div>
      <div className="tnd-option-text">
        <span className="tnd-option-title">{title}</span>
        {description && <span className="tnd-option-desc">{description}</span>}
      </div>
      <div className={`tnd-option-toggle${checked ? " tnd-option-toggle-on" : ""}`}>
        <div className="tnd-option-toggle-dot" />
      </div>
    </button>
  );
}
