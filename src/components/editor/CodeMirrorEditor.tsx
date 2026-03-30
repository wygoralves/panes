import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo,
} from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import type { EditorRevealRequest } from "../../types";

interface Props {
  tabId: string;
  content: string;
  filePath: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
  extensions?: Extension[];
  pendingReveal?: EditorRevealRequest | null;
  onRevealHandled?: (nonce: string) => void;
}

const EMPTY_EXTENSIONS: Extension[] = [];

const darkVoidTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-1)",
      color: "var(--text-1)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: "13px",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-2)",
      color: "var(--text-3)",
      border: "none",
      borderRight: "1px solid var(--border)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(255, 107, 107, 0.12) !important",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(255, 255, 255, 0.02)",
    },
    ".cm-foldGutter span": {
      color: "var(--text-3)",
      fontSize: "11px",
    },
    ".cm-matchingBracket": {
      backgroundColor: "rgba(255, 107, 107, 0.18)",
      outline: "none",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(251, 191, 36, 0.2)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(251, 191, 36, 0.35)",
    },
    ".cm-panels": {
      background: "var(--bg-2)",
      borderTop: "1px solid var(--border)",
    },
    ".cm-search": {
      padding: "6px 10px",
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      alignItems: "center",
      background: "var(--bg-2)",
      fontSize: "12px",
      fontFamily: '"Sora", system-ui, sans-serif',
    },
    ".cm-search label": {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      color: "var(--text-2)",
      fontSize: "11px",
      cursor: "pointer",
      userSelect: "none",
    },
    ".cm-search input[type=checkbox]": {
      accentColor: "var(--accent)",
      cursor: "pointer",
    },
    ".cm-textfield": {
      padding: "4px 8px",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--border)",
      background: "var(--bg-3)",
      color: "var(--text-1)",
      fontSize: "12px",
      fontFamily: '"JetBrains Mono", monospace',
      minWidth: "140px",
      outline: "none",
      transition: "border-color 120ms ease",
    },
    ".cm-textfield:focus": {
      borderColor: "var(--accent)",
    },
    ".cm-textfield::placeholder": {
      color: "var(--text-3)",
    },
    ".cm-button": {
      padding: "4px 10px",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--border-active)",
      background: "var(--bg-3)",
      color: "var(--text-2)",
      fontSize: "11px",
      cursor: "pointer",
      transition: "all 120ms ease",
      fontFamily: '"Sora", system-ui, sans-serif',
    },
    ".cm-button:hover": {
      background: "var(--bg-4)",
      color: "var(--text-1)",
      borderColor: "var(--border-active)",
    },
    ".cm-button:active": {
      background: "var(--bg-5)",
    },
    ".cm-panel-close": {
      padding: "2px 6px",
      borderRadius: "var(--radius-sm)",
      border: "none",
      background: "transparent",
      color: "var(--text-3)",
      fontSize: "14px",
      cursor: "pointer",
      lineHeight: "1",
      marginLeft: "auto",
      transition: "color 120ms ease, background 120ms ease",
    },
    ".cm-panel-close:hover": {
      background: "rgba(255, 255, 255, 0.06)",
      color: "var(--text-1)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0 8px",
    },
  },
  { dark: true },
);

const darkVoidHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: tags.operator, color: "#89ddff" },
  { tag: tags.special(tags.variableName), color: "#eeffff" },
  { tag: tags.typeName, color: "#ffcb6b" },
  { tag: tags.atom, color: "#f78c6c" },
  { tag: tags.number, color: "#f78c6c" },
  { tag: tags.definition(tags.variableName), color: "#82aaff" },
  { tag: tags.string, color: "#c3e88d" },
  { tag: tags.special(tags.string), color: "#f07178" },
  { tag: tags.comment, color: "#546e7a" },
  { tag: tags.variableName, color: "#eeffff" },
  { tag: tags.tagName, color: "#f07178" },
  { tag: tags.bracket, color: "#89ddff" },
  { tag: tags.meta, color: "#ffcb6b" },
  { tag: tags.attributeName, color: "#c792ea" },
  { tag: tags.propertyName, color: "#82aaff" },
  { tag: tags.className, color: "#ffcb6b" },
  { tag: tags.invalid, color: "#ff5370" },
  { tag: tags.function(tags.variableName), color: "#82aaff" },
  { tag: tags.bool, color: "#f78c6c" },
  { tag: tags.regexp, color: "#89ddff" },
]);

function getLanguageExtension(filePath: string): Extension | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  switch (ext) {
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "rs":
      return rust();
    case "py":
      return python();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "md":
    case "mdx":
    case "markdown":
      return markdown();
    case "sql":
      return sql();
    case "yaml":
    case "yml":
      return yaml();
    default:
      return null;
  }
}

// ── Module-level EditorView cache ──────────────────────────────────
// Preserves cursor position, scroll state, and undo history across tab switches.
// Same pattern as TerminalPanel's session cache.

const MAX_CACHED_EDITORS = 20;
const MAX_CACHED_EDITOR_BYTES = 10 * 1024 * 1024;

interface CachedEditor {
  view: EditorView;
  filePath: string;
  onChangeRef: { current: (content: string) => void };
  extraExtensionsCompartment: Compartment;
  readOnlyCompartment: Compartment;
  lastAccess: number;
  docBytes: number;
}

const editorCache = new Map<string, CachedEditor>();

function estimateDocumentBytes(content: string): number {
  return content.length * 2;
}

function evictLruEditors(excludeTabId: string): void {
  let totalBytes = 0;
  for (const cached of editorCache.values()) {
    totalBytes += cached.docBytes;
  }

  if (editorCache.size <= MAX_CACHED_EDITORS && totalBytes <= MAX_CACHED_EDITOR_BYTES) return;

  const entries = [...editorCache.entries()]
    .filter(([id]) => id !== excludeTabId)
    .filter(([, cached]) => !cached.view.dom.isConnected)
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  let index = 0;
  while (
    index < entries.length &&
    (editorCache.size > MAX_CACHED_EDITORS || totalBytes > MAX_CACHED_EDITOR_BYTES)
  ) {
    const [id, cached] = entries[index];
    cached.view.destroy();
    editorCache.delete(id);
    totalBytes -= cached.docBytes;
    index += 1;
  }
}

export function destroyCachedEditor(tabId: string): void {
  const cached = editorCache.get(tabId);
  if (cached) {
    cached.view.destroy();
    editorCache.delete(tabId);
  }
}

export function getActiveEditorView(tabId: string): EditorView | undefined {
  return editorCache.get(tabId)?.view;
}

export function getFocusedEditorView(): EditorView | undefined {
  const activeElement = globalThis.document?.activeElement;
  for (const cached of editorCache.values()) {
    if (cached.view.hasFocus || (activeElement instanceof Node && cached.view.dom.contains(activeElement))) {
      return cached.view;
    }
  }
  return undefined;
}

export function runFocusedEditorHistoryAction(action: "undo" | "redo"): boolean {
  const view = getFocusedEditorView();
  if (!view) {
    return false;
  }

  return action === "undo" ? undo(view) : redo(view);
}

export { openSearchPanel } from "@codemirror/search";

export function CodeMirrorEditor({
  tabId,
  content,
  filePath,
  onChange,
  readOnly = false,
  extensions: rawExtensions,
  pendingReveal = null,
  onRevealHandled,
}: Props) {
  const extensions = rawExtensions ?? EMPTY_EXTENSIONS;
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const isExternalUpdate = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let cached = editorCache.get(tabId);

    if (cached && cached.filePath === filePath) {
      // Reattach existing view to the new container
      cached.onChangeRef = onChangeRef;
      cached.lastAccess = Date.now();
      containerRef.current.appendChild(cached.view.dom);
      return () => {
        // Detach without destroying — view stays in cache
        cached!.view.dom.remove();
      };
    }

    // Destroy stale cached entry if filePath changed (shouldn't happen, but safety)
    if (cached) {
      cached.view.destroy();
      editorCache.delete(tabId);
    }

    // Create new editor
    const lang = getLanguageExtension(filePath);
    const changeRef = onChangeRef;
    const externalRef = isExternalUpdate;
    const extraExtensionsCompartment = new Compartment();
    const readOnlyCompartment = new Compartment();

    const editorExtensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      darkVoidTheme,
      syntaxHighlighting(darkVoidHighlight),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      search(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...searchKeymap,
        indentWithTab,
        {
          key: "Mod-h",
          run: (view) => {
            openSearchPanel(view);
            requestAnimationFrame(() => {
              const replaceInput = view.dom.querySelector<HTMLInputElement>("[name=replace]");
              replaceInput?.focus();
            });
            return true;
          },
        },
      ]),
      extraExtensionsCompartment.of(extensions),
      readOnlyCompartment.of(readOnly ? EditorState.readOnly.of(true) : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const cached = editorCache.get(tabId);
          if (cached) {
            cached.docBytes = update.state.doc.length * 2;
          }
          evictLruEditors(tabId);

          if (!externalRef.current) {
            const nextContent = update.state.doc.toString();
            changeRef.current(nextContent);
          }
        }
      }),
    ];

    if (lang) editorExtensions.push(lang);

    const state = EditorState.create({ doc: content, extensions: editorExtensions });
    const view = new EditorView({ state, parent: containerRef.current });

    editorCache.set(tabId, {
      view,
      filePath,
      onChangeRef: changeRef,
      extraExtensionsCompartment,
      readOnlyCompartment,
      lastAccess: Date.now(),
      docBytes: estimateDocumentBytes(content),
    });
    evictLruEditors(tabId);

    return () => {
      // Detach without destroying — view stays in cache
      view.dom.remove();
    };
    // `content` is intentionally excluded — initial doc is set at creation time,
    // and subsequent external content syncs are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, filePath, readOnly]);

  // Sync external content changes (e.g. reload after save)
  useEffect(() => {
    const cached = editorCache.get(tabId);
    if (!cached) return;
    const current = cached.view.state.doc.toString();
    if (current !== content) {
      isExternalUpdate.current = true;
      cached.view.dispatch({
        changes: { from: 0, to: current.length, insert: content },
      });
      isExternalUpdate.current = false;
    }
  }, [tabId, content]);

  useEffect(() => {
    const cached = editorCache.get(tabId);
    if (!cached) return;
    cached.view.dispatch({
      effects: cached.extraExtensionsCompartment.reconfigure(extensions),
    });
  }, [tabId, extensions]);

  useEffect(() => {
    const cached = editorCache.get(tabId);
    if (!cached) return;
    cached.view.dispatch({
      effects: cached.readOnlyCompartment.reconfigure(
        readOnly ? EditorState.readOnly.of(true) : [],
      ),
    });
  }, [tabId, readOnly]);

  useEffect(() => {
    if (!pendingReveal) {
      return;
    }

    const cached = editorCache.get(tabId);
    if (!cached) {
      return;
    }

    const doc = cached.view.state.doc;
    if (doc.lines === 0) {
      onRevealHandled?.(pendingReveal.nonce);
      return;
    }

    const lineNumber = Math.max(1, Math.min(pendingReveal.line, doc.lines));
    const line = doc.line(lineNumber);
    const maxColumn = line.to - line.from + 1;
    const column = pendingReveal.column == null
      ? 1
      : Math.max(1, Math.min(pendingReveal.column, maxColumn));
    const position = line.from + column - 1;

    cached.view.dispatch({
      selection: EditorSelection.cursor(position),
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    cached.view.focus();
    onRevealHandled?.(pendingReveal.nonce);
  }, [onRevealHandled, pendingReveal, tabId]);

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-1)",
      }}
    />
  );
}
