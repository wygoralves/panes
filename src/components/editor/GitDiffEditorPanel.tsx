import { useEffect, useMemo, useRef, useState } from "react";
import { StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CodeMirrorEditor, getActiveEditorView } from "./CodeMirrorEditor";
import {
  buildGitDiffModel,
  getDiffHunkAnchor,
  getDiffHunkLine,
  hunkContainsAnchor,
  pickClosestHunkIndex,
  type DiffHunk,
  type LineHighlightRange,
} from "./gitDiffModel";
import type { EditorTab } from "../../types";

interface DecoratedLineRange {
  fromLine: number;
  toLine: number;
  className: string;
}

function createLineClassExtension(ranges: DecoratedLineRange[]): Extension[] {
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

function createDecorations(state: EditorView["state"], ranges: DecoratedLineRange[]) {
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
            class: range.className,
          },
        }).range(state.doc.line(lineNumber).from),
      );
    }
  }

  return Decoration.set(decorations, true);
}

function buildPassiveDecorationRanges(ranges: LineHighlightRange[]): DecoratedLineRange[] {
  return ranges.map((range) => ({
    fromLine: range.fromLine,
    toLine: range.toLine,
    className: `cm-git-diff-line cm-git-diff-line-${range.kind}`,
  }));
}

function buildActiveDecorationRanges(
  hunk: DiffHunk | null,
  pane: "base" | "modified",
): DecoratedLineRange[] {
  const range = pane === "base" ? hunk?.baseRange : hunk?.modifiedRange;
  if (!range) {
    return [];
  }

  return [
    {
      fromLine: range.fromLine,
      toLine: range.toLine,
      className: `cm-git-diff-line-active cm-git-diff-line-active-pane-${pane}`,
    },
  ];
}

function getPreferredPaneForHunk(hunk: DiffHunk): "base" | "modified" {
  return hunk.modifiedRange ? "modified" : "base";
}

export function getFocusPaneForHunk(
  hunk: DiffHunk,
  readOnlyModified: boolean,
): "base" | "modified" {
  if (!readOnlyModified) {
    return "modified";
  }

  return getPreferredPaneForHunk(hunk);
}

export function getRevealLine(
  hunk: DiffHunk,
  pane: "base" | "modified",
): number {
  return getDiffHunkLine(hunk, pane);
}

function centerLineInView(view: EditorView, lineNumber: number) {
  const maxLine = view.state.doc.lines;
  const safeLine = Math.min(Math.max(1, lineNumber), maxLine);
  const position = view.state.doc.line(safeLine).from;
  view.dispatch({
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  });
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
  const programmaticScrollRef = useRef(false);
  const scrollUnlockFrameRef = useRef<number | null>(null);
  const scrollUnlockNestedFrameRef = useRef<number | null>(null);
  const activeHunkAnchorRef = useRef<ReturnType<typeof getDiffHunkAnchor> | null>(null);
  const [activeHunkIndex, setActiveHunkIndex] = useState<number | null>(null);

  function scheduleScrollUnlock() {
    if (scrollUnlockFrameRef.current !== null) {
      cancelAnimationFrame(scrollUnlockFrameRef.current);
    }
    if (scrollUnlockNestedFrameRef.current !== null) {
      cancelAnimationFrame(scrollUnlockNestedFrameRef.current);
    }

    scrollUnlockFrameRef.current = requestAnimationFrame(() => {
      scrollUnlockNestedFrameRef.current = requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        scrollUnlockFrameRef.current = null;
        scrollUnlockNestedFrameRef.current = null;
      });
    });
  }

  function revealHunk(hunk: DiffHunk) {
    const baseView = getActiveEditorView(baseEditorId);
    const modifiedView = getActiveEditorView(modifiedEditorId);
    if (!baseView || !modifiedView) {
      return;
    }

    programmaticScrollRef.current = true;
    centerLineInView(baseView, getRevealLine(hunk, "base"));
    centerLineInView(modifiedView, getRevealLine(hunk, "modified"));

    const focusPane = getFocusPaneForHunk(hunk, readOnlyModified);
    if (focusPane === "modified") {
      modifiedView.focus();
    } else {
      baseView.focus();
    }

    scheduleScrollUnlock();
  }

  function goToHunk(index: number) {
    if (!context) {
      return;
    }

    const clampedIndex = Math.min(Math.max(0, index), diffModel.hunks.length - 1);
    const hunk = diffModel.hunks[clampedIndex];
    if (!hunk) {
      return;
    }

    activeHunkAnchorRef.current = getDiffHunkAnchor(hunk);
    setActiveHunkIndex(clampedIndex);
    revealHunk(hunk);
  }

  const diffModel = useMemo(
    () =>
      context
        ? buildGitDiffModel(context.baseContent, tab.content)
        : { highlights: { base: [], modified: [] }, hunks: [] },
    [context, tab.content],
  );
  const activeHunk =
    activeHunkIndex !== null ? diffModel.hunks[activeHunkIndex] ?? null : null;
  const hasHunks = diffModel.hunks.length > 0;
  const displayedActiveHunkIndex = hasHunks ? (activeHunkIndex ?? 0) : null;
  const previousDisabled =
    !hasHunks || displayedActiveHunkIndex === null || displayedActiveHunkIndex <= 0;
  const nextDisabled =
    !hasHunks
    || displayedActiveHunkIndex === null
    || displayedActiveHunkIndex >= diffModel.hunks.length - 1;

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
        if (programmaticScrollRef.current || syncing === side) {
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

  useEffect(() => {
    if (diffModel.hunks.length === 0) {
      setActiveHunkIndex(null);
      activeHunkAnchorRef.current = null;
      return;
    }

    const nextIndex = pickClosestHunkIndex(diffModel.hunks, activeHunkAnchorRef.current);
    if (nextIndex === null) {
      setActiveHunkIndex(null);
      return;
    }

    const nextHunk = diffModel.hunks[nextIndex];
    const shouldReveal =
      !activeHunkAnchorRef.current
      || !hunkContainsAnchor(nextHunk, activeHunkAnchorRef.current);

    setActiveHunkIndex((currentIndex) => (currentIndex === nextIndex ? currentIndex : nextIndex));

    if (shouldReveal) {
      const frame = requestAnimationFrame(() => {
        revealHunk(nextHunk);
      });
      return () => cancelAnimationFrame(frame);
    }

    return undefined;
  }, [diffModel.hunks, baseEditorId, modifiedEditorId]);

  useEffect(() => {
    activeHunkAnchorRef.current = activeHunk ? getDiffHunkAnchor(activeHunk) : null;
  }, [activeHunk]);

  useEffect(() => {
    return () => {
      if (scrollUnlockFrameRef.current !== null) {
        cancelAnimationFrame(scrollUnlockFrameRef.current);
      }
      if (scrollUnlockNestedFrameRef.current !== null) {
        cancelAnimationFrame(scrollUnlockNestedFrameRef.current);
      }
      programmaticScrollRef.current = false;
    };
  }, []);

  const goToPreviousHunk = () => {
    if (diffModel.hunks.length === 0) {
      return;
    }
    if (activeHunkIndex === null) {
      goToHunk(0);
      return;
    }
    if (activeHunkIndex <= 0) {
      return;
    }
    goToHunk(activeHunkIndex - 1);
  };
  const goToNextHunk = () => {
    if (diffModel.hunks.length === 0) {
      return;
    }
    if (activeHunkIndex === null) {
      goToHunk(0);
      return;
    }
    if (activeHunkIndex >= diffModel.hunks.length - 1) {
      return;
    }
    goToHunk(activeHunkIndex + 1);
  };

  const baseExtensions = useMemo(() => {
    const passive = createLineClassExtension(
      buildPassiveDecorationRanges(diffModel.highlights.base),
    );
    const active = createLineClassExtension(
      buildActiveDecorationRanges(activeHunk, "base"),
    );
    const shortcuts = keymap.of([
      {
        key: "Shift-F7",
        run: () => {
          goToPreviousHunk();
          return diffModel.hunks.length > 0;
        },
      },
      {
        key: "F7",
        run: () => {
          goToNextHunk();
          return diffModel.hunks.length > 0;
        },
      },
    ]);

    return [...passive, ...active, shortcuts];
  }, [
    diffModel.highlights.base,
    diffModel.hunks.length,
    activeHunk,
    activeHunkIndex,
    previousDisabled,
    nextDisabled,
  ]);
  const modifiedExtensions = useMemo(() => {
    const passive = createLineClassExtension(
      buildPassiveDecorationRanges(diffModel.highlights.modified),
    );
    const active = createLineClassExtension(
      buildActiveDecorationRanges(activeHunk, "modified"),
    );
    const shortcuts = keymap.of([
      {
        key: "Shift-F7",
        run: () => {
          goToPreviousHunk();
          return diffModel.hunks.length > 0;
        },
      },
      {
        key: "F7",
        run: () => {
          goToNextHunk();
          return diffModel.hunks.length > 0;
        },
      },
    ]);

    return [...passive, ...active, shortcuts];
  }, [
    diffModel.highlights.modified,
    diffModel.hunks.length,
    activeHunk,
    activeHunkIndex,
    previousDisabled,
    nextDisabled,
  ]);

  if (!context) {
    return (
      <div className="git-editor-empty-state">
        <p>{t("editor.gitDiff.unavailable")}</p>
      </div>
    );
  }

  const secondaryBadges = [
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
            <div className="git-diff-editor-pane-label">
              <span>{context.modifiedLabel}</span>
              {secondaryBadges.map((badge) => (
                <span key={badge} className="git-diff-editor-badge">
                  {badge}
                </span>
              ))}
            </div>
            {hasHunks && displayedActiveHunkIndex !== null ? (
              <div className="git-diff-editor-nav">
                <button
                  type="button"
                  className="git-diff-editor-nav-button"
                  onClick={goToPreviousHunk}
                  disabled={previousDisabled}
                  title={t("editor.gitDiff.previousDiff")}
                  aria-label={t("editor.gitDiff.previousDiff")}
                >
                  <ChevronUp size={12} />
                </button>
                <span className="git-diff-editor-nav-counter" aria-live="polite">
                  {t("editor.gitDiff.diffCounter", {
                    current: displayedActiveHunkIndex + 1,
                    total: diffModel.hunks.length,
                  })}
                </span>
                <button
                  type="button"
                  className="git-diff-editor-nav-button"
                  onClick={goToNextHunk}
                  disabled={nextDisabled}
                  title={t("editor.gitDiff.nextDiff")}
                  aria-label={t("editor.gitDiff.nextDiff")}
                >
                  <ChevronDown size={12} />
                </button>
              </div>
            ) : (
              <span className="git-diff-editor-pane-state">
                {readOnlyModified
                  ? t("editor.gitDiff.readOnly")
                  : t("editor.gitDiff.editable")}
              </span>
            )}
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
