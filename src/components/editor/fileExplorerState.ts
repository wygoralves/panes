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
