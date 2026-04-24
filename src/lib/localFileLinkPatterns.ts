import type { EditorRevealLocation } from "../types";

export interface ParsedLocalPathTarget {
  path: string;
  reveal: EditorRevealLocation | null;
}

const KNOWN_ROOT_FILE_EXTENSIONS = new Set([
  "astro",
  "bash",
  "c",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cts",
  "cxx",
  "dockerfile",
  "env",
  "fish",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "less",
  "lock",
  "lua",
  "m",
  "md",
  "mdx",
  "mjs",
  "mm",
  "mts",
  "php",
  "plist",
  "prisma",
  "properties",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const KNOWN_EXTENSIONLESS_FILENAMES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".node-version",
  ".npmrc",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc",
  ".python-version",
  ".ruby-version",
  "AGENTS",
  "CHANGELOG",
  "Dockerfile",
  "LICENSE",
  "Makefile",
  "NOTICE",
  "README",
]);

export const TEXT_LINK_PATTERN = /file:\/\/\/[^\s<>"'`]+|(?:https?:\/\/|mailto:|tel:)[^\s<>"'`]+|(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^\s<>"'`]+|(?:\.\/)?[A-Za-z0-9._~@%+=-][A-Za-z0-9._~@%+=/\\-]*(?::\d+(?::\d+)?)?(?:#L\d+(?:C\d+)?)?/gi;
export const TRAILING_LINK_PUNCTUATION_RE = /[\]),.;!?]+$/;
export const DISALLOWED_LOCAL_PREFIX_CHAR_RE = /[A-Za-z0-9._~@/-]/;

export function hasUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z\d+.-]*:/.test(value);
}

export function tryParseUrl(value: string): URL | null {
  if (!hasUrlScheme(value)) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

export function isLocalAbsolutePath(path: string): boolean {
  return (path.startsWith("/") && !path.startsWith("//")) || isWindowsDrivePath(path) || /^\\\\/.test(path);
}

export function trimLinkText(value: string): string {
  return value.replace(TRAILING_LINK_PUNCTUATION_RE, "");
}

export function parseHashReveal(hash: string): EditorRevealLocation | null {
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

function stripLocationSuffix(
  path: string,
  isPathCandidate: (candidate: string) => boolean,
): ParsedLocalPathTarget {
  const lastSegmentMatch = /:(\d+)$/.exec(path);
  if (!lastSegmentMatch) {
    return { path, reveal: null };
  }

  const withoutLastSegment = path.slice(0, -lastSegmentMatch[0].length);
  const lineAndColumnMatch = /:(\d+)$/.exec(withoutLastSegment);
  if (lineAndColumnMatch) {
    const candidatePath = withoutLastSegment.slice(0, -lineAndColumnMatch[0].length);
    if (isPathCandidate(candidatePath)) {
      return {
        path: candidatePath,
        reveal: {
          line: Number(lineAndColumnMatch[1]),
          column: Number(lastSegmentMatch[1]),
        },
      };
    }
  }

  if (!isPathCandidate(withoutLastSegment)) {
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

export function parseLocalAbsolutePathTarget(rawTarget: string): ParsedLocalPathTarget | null {
  if (!isLocalAbsolutePath(rawTarget)) {
    return null;
  }

  const hashIndex = rawTarget.indexOf("#");
  const basePath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
  const hash = hashIndex >= 0 ? rawTarget.slice(hashIndex) : "";
  const parsed = stripLocationSuffix(basePath, isLocalAbsolutePath);

  return {
    path: parsed.path,
    reveal: parseHashReveal(hash) ?? parsed.reveal,
  };
}

export function parseLocalUrlTarget(rawTarget: string): ParsedLocalPathTarget | null {
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
    const parsed = stripLocationSuffix(decodedPath, (path) =>
      isLocalAbsolutePath(path) || /^\/[A-Za-z]:\//.test(path),
    );
    if (!isLocalAbsolutePath(parsed.path) && !/^\/[A-Za-z]:\//.test(parsed.path)) {
      return null;
    }
    return {
      path: parsed.path,
      reveal: parseHashReveal(url.hash) ?? parsed.reveal,
    };
  }

  return null;
}

function basenameForPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

function hasDirectorySegment(path: string): boolean {
  return path.replace(/\\/g, "/").includes("/");
}

function isLikelyFileName(fileName: string, hasDirectory: boolean): boolean {
  if (!fileName || fileName === "." || fileName === "..") {
    return false;
  }
  if (KNOWN_EXTENSIONLESS_FILENAMES.has(fileName) || /^\.env(?:\.|$)/.test(fileName)) {
    return true;
  }
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return false;
  }
  const extension = fileName.slice(dotIndex + 1).toLowerCase();
  return hasDirectory || KNOWN_ROOT_FILE_EXTENSIONS.has(extension);
}

function normalizeRelativePath(path: string): string | null {
  if (!path || hasUrlScheme(path) || isLocalAbsolutePath(path) || path.startsWith("#")) {
    return null;
  }

  let normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized === "..") {
    return null;
  }

  normalized = normalized.replace(/\/+/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    segments.some((segment) => (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.includes(":")
    ))
  ) {
    return null;
  }

  const fileName = basenameForPath(normalized);
  if (!isLikelyFileName(fileName, hasDirectorySegment(normalized))) {
    return null;
  }

  return normalized;
}

export function parseLocalRelativePathTarget(rawTarget: string): ParsedLocalPathTarget | null {
  if (!rawTarget || rawTarget.startsWith("//")) {
    return null;
  }

  const hashIndex = rawTarget.indexOf("#");
  const basePath = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget;
  const hash = hashIndex >= 0 ? rawTarget.slice(hashIndex) : "";
  const parsed = stripLocationSuffix(basePath, (path) => normalizeRelativePath(path) !== null);
  const normalizedPath = normalizeRelativePath(parsed.path);
  if (!normalizedPath) {
    return null;
  }

  return {
    path: normalizedPath,
    reveal: parseHashReveal(hash) ?? parsed.reveal,
  };
}

export function isLocalFileLinkSyntax(rawTarget: string): boolean {
  return Boolean(
    parseLocalAbsolutePathTarget(rawTarget) ||
      parseLocalUrlTarget(rawTarget) ||
      parseLocalRelativePathTarget(rawTarget),
  );
}
