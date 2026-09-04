/** Client-side guard mirroring git's `check-ref-format` for the common cases,
 * so the create form can explain a bad name before the CLI rejects it. */
export function isValidBranchName(name: string): boolean {
  if (!name) return false;
  if (/\s/.test(name)) return false;
  if (name.includes("..") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".lock") || name.startsWith("-") || name.includes("@{")) return false;
  if (name.split("/").some((segment) => segment.startsWith(".") || segment.length === 0)) {
    return false;
  }
  return !/[~^:?*[\\]/.test(name);
}

/** `origin/feature` checks out as `feature` locally, matching what
 * `git checkout --track` derives. */
export function localNameForRemoteBranch(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/** Git rejects ASCII whitespace in ref names, so a typed "new branch" becomes
 * "new-branch" instead of failing. Other invalid characters still surface
 * through `isValidBranchName` so the user sees why. */
export function sanitizeNewBranchName(rawName: string): string {
  return rawName.trim().replace(/[ \t\n\r\f\v]+/g, "-");
}

export interface BranchSelectionTarget {
  /** Directory the checkout runs in, when one is needed. */
  checkoutCwd: string;
  /** Worktree the thread should bind to afterwards; null means the main checkout. */
  nextWorktreePath: string | null;
  /** The branch already lives in a worktree, so no checkout is needed. */
  reuseExistingWorktree: boolean;
}

/** Where selecting a branch should land. A branch checked out in another
 * worktree cannot be checked out twice, so the thread moves there instead.
 * Selecting the repo's default branch from a worktree returns to the main
 * checkout, which is where that branch normally lives. */
export function resolveBranchSelectionTarget(input: {
  repoPath: string;
  activeWorktreePath: string | null;
  branch: { name: string; isRemote: boolean; worktreePath: string | null };
  defaultBranch: string | null;
}): BranchSelectionTarget {
  const { repoPath, activeWorktreePath, branch, defaultBranch } = input;

  if (branch.worktreePath) {
    const isMain = branch.worktreePath === repoPath;
    return {
      checkoutCwd: branch.worktreePath,
      nextWorktreePath: isMain ? null : branch.worktreePath,
      reuseExistingWorktree: true,
    };
  }

  const localName = branch.isRemote ? localNameForRemoteBranch(branch.name) : branch.name;
  const nextWorktreePath =
    activeWorktreePath !== null && defaultBranch !== null && localName === defaultBranch
      ? null
      : activeWorktreePath;

  return {
    checkoutCwd: nextWorktreePath ?? repoPath,
    nextWorktreePath,
    reuseExistingWorktree: false,
  };
}
