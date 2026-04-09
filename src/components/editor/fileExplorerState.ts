import type { FileTreeEntry } from "../../types";

export interface ExplorerLoadSignature {
  generation: number;
  rootPath: string;
}

export function isCurrentExplorerLoad(
  request: ExplorerLoadSignature,
  current: ExplorerLoadSignature,
): boolean {
  return request.generation === current.generation && request.rootPath === current.rootPath;
}

export function isPathEqualOrDescendant(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`);
}

export function pruneContainedPaths(paths: string[]): string[] {
  const uniquePaths = [...new Set(paths)].sort((left, right) => {
    if (left.length !== right.length) {
      return left.length - right.length;
    }
    return left.localeCompare(right);
  });

  const pruned: string[] = [];
  for (const path of uniquePaths) {
    if (pruned.some((candidate) => isPathEqualOrDescendant(path, candidate))) {
      continue;
    }
    pruned.push(path);
  }

  return pruned;
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

function isDeletedPath(path: string, removedPaths: readonly string[]): boolean {
  return removedPaths.some((candidate) => isPathEqualOrDescendant(path, candidate));
}

export function pruneDeletedSetPaths(
  paths: ReadonlySet<string>,
  removedPaths: readonly string[],
): Set<string> {
  const next = new Set<string>();
  for (const path of paths) {
    if (!isDeletedPath(path, removedPaths)) {
      next.add(path);
    }
  }
  return next;
}

export function pruneDeletedMapKeys<T>(
  map: ReadonlyMap<string, T>,
  removedPaths: readonly string[],
): Map<string, T> {
  const next = new Map<string, T>();
  for (const [path, value] of map.entries()) {
    if (!isDeletedPath(path, removedPaths)) {
      next.set(path, value);
    }
  }
  return next;
}

export function isKnownDirectoryPath(
  dirContents: ReadonlyMap<string, FileTreeEntry[]>,
  path: string,
): boolean {
  if (dirContents.has(path)) {
    return true;
  }

  return (
    dirContents.get(parentPath(path))?.some((entry) => entry.path === path && entry.isDir) ??
    false
  );
}

export function remapDescendantPath(
  path: string,
  oldPath: string,
  newPath: string,
): string | null {
  if (!isPathEqualOrDescendant(path, oldPath)) {
    return null;
  }

  if (path === oldPath) {
    return newPath;
  }

  const suffix = path.slice(oldPath.length).replace(/^\/+/, "");
  return suffix ? `${newPath}/${suffix}` : newPath;
}
