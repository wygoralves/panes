import type { GitFileStatus } from "../../types";

export type ChangeSection = "changes" | "staged";

export interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: GitFileStatus[];
}

export interface DirectoryRow {
  type: "dir";
  key: string;
  name: string;
  path: string;
  depth: number;
  collapsed: boolean;
}

export interface FileRow {
  type: "file";
  key: string;
  file: GitFileStatus;
  name: string;
  path: string;
  depth: number;
}

export type TreeRow = DirectoryRow | FileRow;

export function buildDirectoryFileMap(
  files: GitFileStatus[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length <= 1) {
      continue;
    }

    let currentPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      currentPath = currentPath
        ? `${currentPath}/${parts[index]}`
        : parts[index];
      const currentFiles = map.get(currentPath);
      if (currentFiles) {
        currentFiles.push(file.path);
      } else {
        map.set(currentPath, [file.path]);
      }
    }
  }

  return map;
}

export function buildTreeRows(
  files: GitFileStatus[],
  section: ChangeSection,
  collapsedDirs: Record<string, boolean>,
): TreeRow[] {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const segPath = current.path ? `${current.path}/${seg}` : seg;
      let next = current.dirs.get(seg);
      if (!next) {
        next = { name: seg, path: segPath, dirs: new Map(), files: [] };
        current.dirs.set(seg, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  const rows: TreeRow[] = [];

  function visit(node: TreeNode, depth: number) {
    const sortedDirs = Array.from(node.dirs.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    const sortedFiles = [...node.files].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    for (const dir of sortedDirs) {
      const collapseKey = `${section}:${dir.path}`;
      const collapsed = Boolean(collapsedDirs[collapseKey]);
      rows.push({
        type: "dir",
        key: collapseKey,
        name: dir.name,
        path: dir.path,
        depth,
        collapsed,
      });
      if (!collapsed) visit(dir, depth + 1);
    }

    for (const file of sortedFiles) {
      rows.push({
        type: "file",
        key: `${section}:file:${file.path}`,
        file,
        name: file.path.split("/").pop() ?? file.path,
        path: file.path,
        depth,
      });
    }
  }

  visit(root, 0);
  return rows;
}

export function getStatusLabel(status?: string): string {
  if (!status) return "";
  if (status === "added" || status === "untracked") return "A";
  if (status === "deleted") return "D";
  if (status === "modified") return "M";
  if (status === "renamed") return "R";
  if (status === "conflicted") return "C";
  return status[0]?.toUpperCase() ?? "?";
}

export function getStatusClass(status?: string): string {
  if (!status) return "";
  if (status === "added" || status === "untracked") return "git-status-added";
  if (status === "deleted") return "git-status-deleted";
  if (status === "modified") return "git-status-modified";
  if (status === "renamed") return "git-status-renamed";
  if (status === "conflicted") return "git-status-conflicted";
  return "git-status-untracked";
}
