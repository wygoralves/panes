interface Props {
  label: string;
  active?: boolean;
  className?: string;
}

function projectInitial(label: string): string {
  return Array.from(label.trim())[0]?.toLocaleUpperCase() ?? "P";
}

export function ProjectIcon({ label, active = false, className = "" }: Props) {
  return (
    <span
      className={`sb-project-icon${active ? " sb-project-icon-active" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {projectInitial(label)}
    </span>
  );
}
