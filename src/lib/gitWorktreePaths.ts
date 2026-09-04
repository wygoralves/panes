/** Worktrees Panes creates live under the repo so they stay inside the
 * workspace sandbox; the branch name becomes the folder, slashes flattened. */
export const PANES_WORKTREES_DIR = ".panes/worktrees";

export function worktreeFolderNameForBranch(branchName: string): string {
  return branchName.trim().replace(/[/\\]/g, "-");
}

export function defaultWorktreePath(repoPath: string, branchName: string): string {
  const folder = worktreeFolderNameForBranch(branchName);
  if (!folder) return "";
  const root = repoPath.replace(/[/\\]+$/, "");
  // No trailing separator: git reports worktree paths without one, and these
  // strings are compared against it.
  return `${root}/${PANES_WORKTREES_DIR}/${folder}`;
}

/** Last path segment, used to label a worktree without its full path. */
export function worktreeDisplayName(worktreePath: string): string {
  const trimmed = worktreePath.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/);
  return segments[segments.length - 1] || trimmed;
}
