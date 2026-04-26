import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { findFileReferenceMatches } from "../../lib/fileReferences";
import {
  handleEditorFileReferenceClick,
  type EditorFileReferenceContext,
} from "../../lib/openEditorFileReference";

interface InlineFileReferenceTextProps extends EditorFileReferenceContext {
  text: string;
}

export function InlineFileReferenceText({
  text,
  workspaceId,
  preferredRepoPath,
  currentCwd,
}: InlineFileReferenceTextProps) {
  const { t } = useTranslation("common");
  const matches = useMemo(() => findFileReferenceMatches(text), [text]);

  if (matches.length === 0) {
    return <>{text}</>;
  }

  const hint = t("fileReferences.shiftClickHint");
  const context = {
    workspaceId,
    preferredRepoPath,
    currentCwd,
  };

  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of matches) {
    if (cursor < match.start) {
      nodes.push(
        <Fragment key={`text:${cursor}`}>
          {text.slice(cursor, match.start)}
        </Fragment>,
      );
    }
    nodes.push(
      <a
        key={`ref:${match.start}`}
        href={match.rawReference}
        title={hint}
        onClick={(event) => handleEditorFileReferenceClick(event, match.rawReference, context)}
        style={{
          color: "var(--accent)",
          textDecoration: "none",
        }}
      >
        {match.rawReference}
      </a>,
    );
    cursor = match.end;
  }

  if (cursor < text.length) {
    nodes.push(
      <Fragment key={`text:${cursor}`}>
        {text.slice(cursor)}
      </Fragment>,
    );
  }

  return <>{nodes}</>;
}
