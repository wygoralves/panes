import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  compareRepoRoots,
  isWithinRoot,
  normalizeAbsolutePath,
} from "./fileRootUtils";
import { useFileStore } from "../stores/fileStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { EditorRevealLocation, Repo } from "../types";

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export interface LinkResolutionContext {
  workspaceRoot: string | null;
  repos: Pick<Repo, "id" | "path">[];
  activeRepoId?: string | null;
}

export interface ResolvedLocalFileLink {
  rootPath: string;
  filePath: string;
  absolutePath: string;
  line?: number;
  column?: number;
}

export interface TextLinkMatch {
  text: string;
  startIndex: number;
  endIndex: number;
  kind: LinkTargetKind;
}

export type LinkTargetKind = "local" | "external" | "other";
export type LinkNavigationResult = "internal" | "external" | "ignored";

const TEXT_LINK_PATTERN = /file:\/\/\/[^\s<>"'`]+|(?:https?:\/\/|mailto:|tel:)[^\s<>"'`]+|(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^\s<>"'`]+/g;
const TRAILING_LINK_PUNCTUATION_RE = /[),.;!?]+$/;
const DISALLOWED_LOCAL_PREFIX_CHAR_RE = /[A-Za-z0-9._~/-]/;

function hasUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value);
}

function tryParseUrl(value: string): URL | null {
  if (!hasUrlScheme(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isLocalAbsolutePath(path: string): boolean {
  return (path.startsWith("/") && !path.startsWith("//")) || isWindowsDrivePath(path) || /^\\\\/.test(path);
}

function stripLocationSuffix(path: string): {
  path: string;
  reveal: EditorRevealLocation | null;
} {
  const lastSegmentMatch = /:(\d+)$/.exec(path);
  if (!lastSegmentMatch) {
    return { path, reveal: null };
  }

  const withoutLastSegment = path.slice(0, -lastSegmentMatch[0].length);
  const lineAndColumnMatch = /:(\d+)$/.exec(withoutLastSegment);
  if (lineAndColumnMatch) {
    const candidatePath = withoutLastSegment.slice(0, -lineAndColumnMatch[0].length);
    if (isLocalAbsolutePath(candidatePath)) {
      return {
        path: candidatePath,
        reveal: {
          line: Number(lineAndColumnMatch[1]),
          column: Number(lastSegmentMatch[1]),
        },
      };
    }
  }

  if (!isLocalAbsolutePath(withoutLastSegment)) {
    return { path, reveal: null };
  }

  return {
    path: withoutLastSegment,
    reveal: {
      line: Number(lastSegmentMatch[1]),
      column: undefined,
    },
  };
}

function parseHashReveal(hash: string): EditorRevealLocation | null {
  const normalized = hash.replace(/^#/, "");
  const match = /^L(\d+)(?:C(\d+))?(?:[-:].*)?$/i.exec(normalized);
  if (!match) {
    return null;
  }
  return {
    line: Number(match[1]),
    column: match[2] ? Number(match[2]) : undefined,
  };
}

function parseLocalAbsolutePathTarget(rawTarget: string): {
  absolutePath: string;
  reveal: EditorRevealLocation | null;
} | null {
  if (!isLocalAbsolutePath(rawTarget)) {
    return null;
  }

  const hashIndex = rawTarget.indexOf("#");
  const basePath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
  const hash = hashIndex >= 0 ? rawTarget.slice(hashIndex) : "";
  const { path, reveal } = stripLocationSuffix(basePath);

  return {
    absolutePath: normalizeAbsolutePath(path),
    reveal: parseHashReveal(hash) ?? reveal,
  };
}

function parseLocalUrlTarget(rawTarget: string): {
  absolutePath: string;
  reveal: EditorRevealLocation | null;
} | null {
  const url = tryParseUrl(rawTarget);
  if (!url) {
    return null;
  }

  if (url.protocol === "file:" || url.hostname === "file") {
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    const { path, reveal } = stripLocationSuffix(decodedPath);
    if (!isLocalAbsolutePath(path) && !/^\/[A-Za-z]:\//.test(path)) {
      return null;
    }
    return {
      absolutePath: normalizeAbsolutePath(path),
      reveal: parseHashReveal(url.hash) ?? reveal,
    };
  }

  return null;
}

export function classifyLinkTarget(rawTarget: string): LinkTargetKind {
  if (parseLocalAbsolutePathTarget(rawTarget) || parseLocalUrlTarget(rawTarget)) {
    return "local";
  }

  const url = tryParseUrl(rawTarget);
  if (url && EXTERNAL_PROTOCOLS.has(url.protocol)) {
    return "external";
  }

  return "other";
}

export function extractTextLinkMatches(text: string): TextLinkMatch[] {
  const matches: TextLinkMatch[] = [];
  for (const match of text.matchAll(TEXT_LINK_PATTERN)) {
    const rawText = match[0];
    const startIndex = match.index ?? 0;
    const trimmedText = rawText.replace(TRAILING_LINK_PUNCTUATION_RE, "");
    if (!trimmedText) {
      continue;
    }

    const kind = classifyLinkTarget(trimmedText);
    if (kind === "other") {
      continue;
    }
    if (
      kind === "local" &&
      startIndex > 0 &&
      DISALLOWED_LOCAL_PREFIX_CHAR_RE.test(text[startIndex - 1] ?? "")
    ) {
      continue;
    }

    matches.push({
      text: trimmedText,
      startIndex,
      endIndex: startIndex + trimmedText.length,
      kind,
    });
  }
  return matches;
}

export function resolveLocalFileLinkTarget(
  rawTarget: string,
  context: LinkResolutionContext,
): ResolvedLocalFileLink | null {
  const localTarget = parseLocalAbsolutePathTarget(rawTarget) ?? parseLocalUrlTarget(rawTarget);
  if (!localTarget) {
    return null;
  }

  const workspaceRoot = context.workspaceRoot ? normalizeAbsolutePath(context.workspaceRoot) : null;
  const candidateRoots = context.repos
    .slice()
    .sort((left, right) => compareRepoRoots(left, right, context.activeRepoId))
    .map((repo) => normalizeAbsolutePath(repo.path));

  if (workspaceRoot) {
    candidateRoots.push(workspaceRoot);
  }

  const matchedRoot = candidateRoots.find((root) => isWithinRoot(localTarget.absolutePath, root));
  if (!matchedRoot) {
    return null;
  }

  const relativePath = localTarget.absolutePath.slice(matchedRoot.length).replace(/^\/+/, "");
  if (!relativePath) {
    return null;
  }

  return {
    rootPath: matchedRoot,
    filePath: relativePath,
    absolutePath: localTarget.absolutePath,
    line: localTarget.reveal?.line,
    column: localTarget.reveal?.column ?? undefined,
  };
}

export async function navigateLinkTarget(
  rawTarget: string,
  options: { shiftKey: boolean },
): Promise<LinkNavigationResult> {
  if (!options.shiftKey) {
    return "ignored";
  }

  const workspaceState = useWorkspaceStore.getState();
  const activeWorkspaceId = workspaceState.activeWorkspaceId;
  const activeWorkspace = activeWorkspaceId
    ? workspaceState.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null;
  const repos = activeWorkspaceId
    ? workspaceState.repos.filter((repo) => repo.workspaceId === activeWorkspaceId)
    : workspaceState.repos;

  const localTarget = resolveLocalFileLinkTarget(rawTarget, {
    workspaceRoot: activeWorkspace?.rootPath ?? null,
    repos,
    activeRepoId: workspaceState.activeRepoId,
  });

  if (localTarget) {
    const reveal = localTarget.line
      ? {
          line: localTarget.line,
          column: localTarget.column,
        }
      : null;

    await useFileStore
      .getState()
      .openFileAtLocation(localTarget.rootPath, localTarget.filePath, reveal);

    if (activeWorkspaceId) {
      await useTerminalStore.getState().setLayoutMode(activeWorkspaceId, "editor");
    }

    return "internal";
  }

  if (classifyLinkTarget(rawTarget) === "external") {
    await openExternal(rawTarget);
    return "external";
  }

  return "ignored";
}
