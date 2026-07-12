import type { CSSProperties, SVGProps } from "react";
import lockupOnDark from "../../assets/brand/panes-lockup-on-dark.svg";
import lockupOnLight from "../../assets/brand/panes-lockup-on-light.svg";

interface PanesMarkProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
  title?: string;
  accent?: string;
}

export function PanesMark({
  size = 20,
  title,
  accent = "var(--accent)",
  style,
  ...props
}: PanesMarkProps) {
  const mergedStyle: CSSProperties = {
    color: "var(--text-1)",
    flexShrink: 0,
    ...style,
  };

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={mergedStyle}
      {...props}
    >
      <rect
        x="8"
        y="8"
        width="48"
        height="48"
        rx="12"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        d="M26 10V54M28 27H54"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect x="34" y="34" width="14" height="14" rx="5" fill={accent} />
    </svg>
  );
}

export function PanesLockup({ width = 136, title = "Panes" }: { width?: number; title?: string }) {
  return (
    <span className="panes-brand-lockup" style={{ width }} role="img" aria-label={title}>
      <img className="panes-brand-lockup-dark" src={lockupOnDark} alt="" />
      <img className="panes-brand-lockup-light" src={lockupOnLight} alt="" />
    </span>
  );
}

export function PanesWordmark({ width = 91, title = "Panes" }: { width?: number; title?: string }) {
  const fullLockupWidth = width * (276 / 182);
  const wordmarkOffset = width * (84 / 182);
  const height = width * (64 / 182);

  return (
    <span
      className="panes-brand-wordmark"
      style={{ width, height }}
      role="img"
      aria-label={title}
    >
      <img
        className="panes-brand-lockup-dark"
        src={lockupOnDark}
        alt=""
        style={{ width: fullLockupWidth, transform: `translateX(-${wordmarkOffset}px)` }}
      />
      <img
        className="panes-brand-lockup-light"
        src={lockupOnLight}
        alt=""
        style={{ width: fullLockupWidth, transform: `translateX(-${wordmarkOffset}px)` }}
      />
    </span>
  );
}
