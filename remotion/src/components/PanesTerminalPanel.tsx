import React from "react";
import { Plus, X, SquareTerminal, Folder, Columns2, Rows2 } from "lucide-react";
import { terminalSessions, terminalLines } from "../data/mockData";

/* ── Terminal line renderer ── */

interface LinePart {
  text: string;
  color: string;
  bold?: boolean;
}

interface TerminalLine {
  text: string;
  color: string;
  parts?: LinePart[];
}

function TerminalLineView({ line }: { line: TerminalLine }) {
  if (line.parts) {
    return (
      <div style={{ minHeight: 19, lineHeight: "19px" }}>
        {line.parts.map((part, i) => (
          <span
            key={i}
            style={{
              color: part.color,
              fontWeight: part.bold ? 700 : 400,
            }}
          >
            {part.text}
          </span>
        ))}
      </div>
    );
  }

  if (!line.text) {
    return <div style={{ minHeight: 19, lineHeight: "19px" }}>&nbsp;</div>;
  }

  return (
    <div
      style={{
        color: line.color || "#f5f5f5",
        minHeight: 19,
        lineHeight: "19px",
      }}
    >
      {line.text}
    </div>
  );
}

/* ── Main Terminal Panel — 1:1 replica of TerminalPanel.tsx visual chrome ── */

export function PanesTerminalPanel({
  sessions = terminalSessions,
  lines = terminalLines as TerminalLine[],
  cwd = "~/projects/panes",
}: {
  sessions?: typeof terminalSessions;
  lines?: TerminalLine[];
  cwd?: string;
}) {
  return (
    <div className="terminal-panel-root">
      {/* ── Tab bar ── */}
      <div className="terminal-tabs-bar">
        <div className="terminal-tabs-list">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`terminal-tab${session.active ? " terminal-tab-active" : ""}`}
            >
              <SquareTerminal size={12} />
              <span className="terminal-tab-label">{session.label}</span>
              <button
                type="button"
                className="terminal-tab-close"
              >
                <X size={10} />
              </button>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button type="button" className="terminal-add-btn" title="New terminal">
            <Plus size={13} />
          </button>
          <button type="button" className="terminal-add-btn" title="Split right">
            <Columns2 size={13} />
          </button>
          <button type="button" className="terminal-add-btn" title="Split down">
            <Rows2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Terminal output ── */}
      <div className="terminal-body">
        <div className="terminal-viewport-stack">
          <div
            className="terminal-viewport"
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 12,
              lineHeight: "19px",
              color: "#f5f5f5",
              background: "#050505",
              padding: "8px 10px",
            }}
          >
            {lines.map((line, i) => (
              <TerminalLineView key={i} line={line} />
            ))}
          </div>
        </div>

        {/* ── Meta bar — inside terminal-body per original ── */}
        <div className="terminal-meta-bar" title={cwd}>
          <Folder size={10} style={{ opacity: 0.5, flexShrink: 0 }} />
          <span className="terminal-meta-bar-path">{cwd}</span>
        </div>
      </div>
    </div>
  );
}
