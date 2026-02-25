import React from "react";
import { FileText, X } from "lucide-react";
import { editorTabs, activeEditorTabId, type MockEditorTab } from "../data/mockData";

/* ── Static Code Content with Syntax Highlighting ── */

function EditorCodeContent({ content, language }: { content: string; language: string }) {
  const lines = content.split("\n");

  const colorizeToken = (token: string): string => {
    // Keywords
    if (/^(import|from|export|function|const|let|var|return|if|else|new|await|async|void|type|interface|default)$/.test(token)) {
      return "#ff7b72";
    }
    // Types / built-ins
    if (/^(string|number|boolean|null|undefined|true|false|React|HTMLElement)$/.test(token)) {
      return "#ffa657";
    }
    // Function names (rough heuristic)
    if (/^[A-Z][a-zA-Z]+$/.test(token)) {
      return "#d2a8ff";
    }
    return "#c9d1d9";
  };

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        background: "var(--code-bg)",
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 12,
        lineHeight: 1.7,
      }}
    >
      {lines.map((line, lineNum) => {
        // Check for comments
        const trimmed = line.trimStart();
        const isComment = trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
        // Check for strings
        const isStringLine = trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`");

        return (
          <div
            key={lineNum}
            style={{
              display: "flex",
              minHeight: 20,
              paddingRight: 12,
            }}
          >
            {/* Line number gutter */}
            <span
              style={{
                width: 48,
                textAlign: "right",
                paddingRight: 16,
                color: "var(--text-3)",
                opacity: 0.35,
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {lineNum + 1}
            </span>
            {/* Code content */}
            <span
              style={{
                flex: 1,
                whiteSpace: "pre",
                color: isComment
                  ? "#484f58"
                  : "#c9d1d9",
                fontStyle: isComment ? "italic" : "normal",
              }}
            >
              {isComment ? (
                line
              ) : (
                line.split(/(\b\w+\b|[^\w\s]+|\s+)/).map((token, i) => {
                  if (!token) return null;
                  if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;

                  // String literals
                  if (/^["'`]/.test(token) || /["'`]$/.test(token)) {
                    return <span key={i} style={{ color: "#a5d6ff" }}>{token}</span>;
                  }
                  // Numbers
                  if (/^\d+$/.test(token)) {
                    return <span key={i} style={{ color: "#79c0ff" }}>{token}</span>;
                  }
                  // Operators
                  if (/^[=<>!+\-*/%&|^~?:;,.()[\]{}]+$/.test(token)) {
                    return <span key={i} style={{ color: "#c9d1d9" }}>{token}</span>;
                  }

                  return (
                    <span key={i} style={{ color: colorizeToken(token) }}>
                      {token}
                    </span>
                  );
                })
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main File Editor Panel ── */

export function PanesFileEditor({
  tabs = editorTabs,
  activeTabId = activeEditorTabId,
}: {
  tabs?: MockEditorTab[];
  activeTabId?: string;
}) {
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      {tabs.length > 0 && (
        <div className="editor-tabs-bar">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`editor-tab ${tab.id === activeTabId ? "active" : ""}`}
            >
              <FileText
                size={12}
                style={{
                  flexShrink: 0,
                  color: tab.id === activeTabId ? "var(--text-2)" : "var(--text-3)",
                }}
              />
              <span className="editor-tab-name">{tab.fileName}</span>
              {tab.isDirty && <span className="editor-tab-dirty">&bull;</span>}
              <button type="button" className="editor-tab-close">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Editor content */}
      {activeTab ? (
        <EditorCodeContent content={activeTab.content} language={activeTab.language} />
      ) : (
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "var(--text-3)",
          }}
        >
          <FileText size={32} style={{ opacity: 0.3 }} />
          <p style={{ fontSize: 13 }}>No files open</p>
        </div>
      )}
    </div>
  );
}
