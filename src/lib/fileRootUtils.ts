import type { Repo } from "../types";

type RepoRoot = Pick<Repo, "id" | "path">;

export interface RepoOwnership {
  repo: RepoRoot;
  filePath: string;
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function isUncPath(path: string): boolean {
  return /^\\\\/.test(path) || path.startsWith("//");
}

function shouldCompareCaseInsensitive(path: string): boolean {
  const normalized = normalizeAbsolutePath(path);
  return isWindowsDrivePath(normalized) || isUncPath(normalized);
}

function normalizeForComparison(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  return shouldCompareCaseInsensitive(normalized) ? normalized.toLowerCase() : normalized;
}

export function normalizeAbsolutePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = `${normalized[0].toUpperCase()}${normalized.slice(1)}`;
  }

  const isUnc = normalized.startsWith("//");
  normalized = normalized.replace(/\/+/g, "/");
  if (isUnc) {
    normalized = `/${normalized}`;
    normalized = normalized.replace(/^\/+/, "//");
  }

  if (normalized.length > 1 && /\/$/.test(normalized) && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized;
}

export function isWithinRoot(absolutePath: string, rootPath: string): boolean {
  const normalizedPath = normalizeForComparison(absolutePath);
  const normalizedRoot = normalizeForComparison(rootPath);
  if (normalizedPath === normalizedRoot) {
    return true;
  }
  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function compareRepoRoots(
  left: RepoRoot,
  right: RepoRoot,
  activeRepoId: string | null | undefined,
): number {
  const leftPath = normalizeAbsolutePath(left.path);
  const rightPath = normalizeAbsolutePath(right.path);
  if (leftPath.length !== rightPath.length) {
    return rightPath.length - leftPath.length;
  }
  if (activeRepoId) {
    if (left.id === activeRepoId && right.id !== activeRepoId) {
      return -1;
    }
    if (right.id === activeRepoId && left.id !== activeRepoId) {
      return 1;
    }
  }
  return leftPath.localeCompare(rightPath);
}

export function resolveAbsoluteFilePath(rootPath: string, filePath: string): string {
  const normalizedRoot = normalizeAbsolutePath(rootPath);
  const normalizedFilePath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizeAbsolutePath(
    normalizedFilePath ? `${normalizedRoot}/${normalizedFilePath}` : normalizedRoot,
  );
}

export function resolveRelativePathWithinRoot(
  absolutePath: string,
  rootPath: string,
): string | null {
  if (!isWithinRoot(absolutePath, rootPath)) {
    return null;
  }

  const normalizedAbsolutePath = normalizeAbsolutePath(absolutePath);
  const normalizedRootPath = normalizeAbsolutePath(rootPath);
  if (normalizeForComparison(normalizedAbsolutePath) === normalizeForComparison(normalizedRootPath)) {
    return "";
  }

  return normalizedAbsolutePath.slice(normalizedRootPath.length).replace(/^\/+/, "");
}

export function resolveOwningRepoForAbsolutePath(
  absolutePath: string,
  repos: RepoRoot[],
  activeRepoId?: string | null,
): RepoOwnership | null {
  const owningRepo = repos
    .slice()
    .sort((left, right) => compareRepoRoots(left, right, activeRepoId))
    .find((repo) => isWithinRoot(absolutePath, repo.path));

  if (!owningRepo) {
    return null;
  }

  const filePath = resolveRelativePathWithinRoot(absolutePath, owningRepo.path);
  if (filePath === null || filePath.length === 0) {
    return null;
  }

  return {
    repo: owningRepo,
    filePath,
  };
}
