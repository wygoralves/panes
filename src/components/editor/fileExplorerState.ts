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
