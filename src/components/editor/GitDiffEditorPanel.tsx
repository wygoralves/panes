import { useEffect, useMemo } from "react";
import { EditorState, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { diffLines } from "diff";
import { useTranslation } from "react-i18next";
import { CodeMirrorEditor, getActiveEditorView } from "./CodeMirrorEditor";
import type { EditorTab } from "../../types";

type LineHighlightKind = "added" | "removed";

interface LineHighlightRange {
  fromLine: number;
  toLine: number;
  kind: LineHighlightKind;
}

export interface DiffHighlightResult {
  base: LineHighlightRange[];
  modified: LineHighlightRange[];
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalized = content.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function pushRange(
  target: LineHighlightRange[],
  fromLine: number,
  toLine: number,
  kind: LineHighlightKind,
) {
  if (toLine < fromLine) {
    return;
  }

  const previous = target[target.length - 1];
  if (previous && previous.kind === kind && previous.toLine + 1 >= fromLine) {
    previous.toLine = Math.max(previous.toLine, toLine);
    return;
  }

  target.push({ fromLine, toLine, kind });
}

function countChunkLines(value: string, fallbackCount?: number): number {
  if (fallbackCount !== undefined) {
    return fallbackCount;
  }
  return splitLines(value).length;
}

export function buildLineHighlights(
  baseContent: string,
  modifiedContent: string,
): DiffHighlightResult {
  const base: LineHighlightRange[] = [];
  const modified: LineHighlightRange[] = [];
  let baseLine = 1;
  let modifiedLine = 1;

  for (const chunk of diffLines(baseContent, modifiedContent)) {
    const lineCount = countChunkLines(chunk.value, chunk.count);
    if (lineCount === 0) {
      continue;
    }

    if (chunk.added) {
      pushRange(modified, modifiedLine, modifiedLine + lineCount - 1, "added");
      modifiedLine += lineCount;
      continue;
    }

    if (chunk.removed) {
      pushRange(base, baseLine, baseLine + lineCount - 1, "removed");
      baseLine += lineCount;
      continue;
    }

    baseLine += lineCount;
    modifiedLine += lineCount;
  }

  return { base, modified };
}

function createLineHighlightExtension(ranges: LineHighlightRange[]): Extension[] {
  if (ranges.length === 0) {
    return [];
  }

  const field = StateField.define({
    create(state) {
      return createDecorations(state, ranges);
    },
    update(value, transaction) {
      return transaction.docChanged ? createDecorations(transaction.state, ranges) : value;
    },
    provide: (fieldValue) => EditorView.decorations.from(fieldValue),
  });

  return [field];
}

function createDecorations(
  state: EditorState,
  ranges: LineHighlightRange[],
) {
  const decorations = [];
  const maxLine = state.doc.lines;

  for (const range of ranges) {
    if (maxLine === 0) {
      continue;
    }

    const fromLine = Math.min(Math.max(1, range.fromLine), maxLine);
    const toLine = Math.min(Math.max(fromLine, range.toLine), maxLine);

    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      decorations.push(
        Decoration.line({
          attributes: {
            class: `cm-git-diff-line cm-git-diff-line-${range.kind}`,
          },
        }).range(state.doc.line(lineNumber).from),
      );
    }
  }

  return Decoration.set(decorations, true);
}

function getChangeTypeLabel(
  changeType: string,
  t: (key: string) => string,
): string {
  switch (changeType) {
    case "added":
      return t("editor.gitDiff.changeTypes.added");
    case "deleted":
      return t("editor.gitDiff.changeTypes.deleted");
    case "renamed":
      return t("editor.gitDiff.changeTypes.renamed");
    case "untracked":
      return t("editor.gitDiff.changeTypes.untracked");
    case "conflicted":
      return t("editor.gitDiff.changeTypes.conflicted");
    default:
      return t("editor.gitDiff.changeTypes.modified");
  }
}

export function GitDiffEditorPanel({
  tab,
  onChange,
}: {
  tab: EditorTab;
  onChange: (content: string) => void;
}) {
  const { t } = useTranslation("app");
  const context = tab.gitContext;
  const baseEditorId = `${tab.id}:git-base`;
  const modifiedEditorId = `${tab.id}:git-modified`;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const baseView = getActiveEditorView(baseEditorId);
      const modifiedView = getActiveEditorView(modifiedEditorId);
      if (!baseView || !modifiedView) {
        return;
      }

      let syncing: "base" | "modified" | null = null;

      const syncScroll = (
        source: EditorView,
        target: EditorView,
        side: "base" | "modified",
      ) => {
        if (syncing === side) {
          return;
        }
        syncing = side;
        target.scrollDOM.scrollTop = source.scrollDOM.scrollTop;
        requestAnimationFrame(() => {
          syncing = null;
        });
      };

      const onBaseScroll = () => syncScroll(baseView, modifiedView, "base");
      const onModifiedScroll = () => syncScroll(modifiedView, baseView, "modified");

      baseView.scrollDOM.addEventListener("scroll", onBaseScroll);
      modifiedView.scrollDOM.addEventListener("scroll", onModifiedScroll);

      cleanup = () => {
        baseView.scrollDOM.removeEventListener("scroll", onBaseScroll);
        modifiedView.scrollDOM.removeEventListener("scroll", onModifiedScroll);
      };
    });

    return () => {
      cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [baseEditorId, modifiedEditorId]);

  const highlights = useMemo(
    () =>
      context
        ? buildLineHighlights(context.baseContent, tab.content)
        : { base: [], modified: [] },
    [context, tab.content],
  );
  const baseExtensions = useMemo(
    () => createLineHighlightExtension(highlights.base),
    [highlights.base],
  );
  const modifiedExtensions = useMemo(
    () => createLineHighlightExtension(highlights.modified),
    [highlights.modified],
  );

  if (!context) {
    return (
      <div className="git-editor-empty-state">
        <p>{t("editor.gitDiff.unavailable")}</p>
      </div>
    );
  }

  const statusBadges = [
    getChangeTypeLabel(context.changeType, t),
    context.source === "changes" && context.hasStagedChanges
      ? t("editor.gitDiff.alsoStaged")
      : null,
    context.source === "staged" && context.hasUnstagedChanges
      ? t("editor.gitDiff.workingTreeEditable")
      : null,
  ].filter((value): value is string => Boolean(value));

  if (context.isBinary) {
    return (
      <div className="git-editor-empty-state">
        <p>{t("editor.gitDiff.binaryUnavailable")}</p>
      </div>
    );
  }

  const readOnlyModified =
    context.isEditable === undefined
      ? context.changeType === "deleted"
      : !context.isEditable;
  const calloutMessage =
    context.changeType === "deleted"
      ? t("editor.gitDiff.deletedNotice")
      : context.changeType === "conflicted" && readOnlyModified
        ? t("editor.gitDiff.conflictedNotice")
        : null;

  return (
    <div className="git-diff-editor-panel">
      <div className="git-diff-editor-header">
        <div className="git-diff-editor-labels">
          {statusBadges.map((badge) => (
            <span key={badge} className="git-diff-editor-badge">
              {badge}
            </span>
          ))}
        </div>
        {readOnlyModified ? (
          <span className="git-diff-editor-note">
            {t("editor.gitDiff.readOnlyModified")}
          </span>
        ) : null}
      </div>

      {calloutMessage ? (
        <div className="git-diff-editor-callout">
          {calloutMessage}
        </div>
      ) : null}

      <div className="git-diff-editor-grid">
        <section className="git-diff-editor-pane">
          <header className="git-diff-editor-pane-header">
            <span>{context.baseLabel}</span>
          </header>
          <div className="git-diff-editor-pane-body">
            <CodeMirrorEditor
              tabId={baseEditorId}
              content={context.baseContent}
              filePath={tab.filePath}
              onChange={() => {}}
              readOnly
              extensions={baseExtensions}
            />
          </div>
        </section>

        <section className="git-diff-editor-pane">
          <header className="git-diff-editor-pane-header">
            <span>{context.modifiedLabel}</span>
            <span className="git-diff-editor-pane-state">
              {readOnlyModified
                ? t("editor.gitDiff.readOnly")
                : t("editor.gitDiff.editable")}
            </span>
          </header>
          <div className="git-diff-editor-pane-body">
            <CodeMirrorEditor
              tabId={modifiedEditorId}
              content={tab.content}
              filePath={tab.filePath}
              onChange={onChange}
              readOnly={readOnlyModified}
              extensions={modifiedExtensions}
            />
            {context.changeType === "deleted" ? (
              <div className="git-diff-editor-overlay">
                {t("editor.gitDiff.deletedReadOnly")}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
