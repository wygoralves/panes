import type { GitStatus, Repo } from "../types";

interface ResolveCommandPaletteGitStatusOptions {
  repoPath: string | null;
  activeRepoPath: string | null;
  activeStatus?: GitStatus;
  loadStatus: (repoPath: string) => Promise<GitStatus>;
}

export function isRepoScopedGitCommandAvailable(
  activeRepoPath: string | null,
  repos: Repo[],
): boolean {
  return Boolean(activeRepoPath) || hasMultipleActiveGitRepos(repos);
}

export function getActiveGitRepos(repos: Repo[]): Repo[] {
  return repos.filter((repo) => repo.isActive);
}

export function hasMultipleActiveGitRepos(repos: Repo[]): boolean {
  return getActiveGitRepos(repos).length > 1;
}

export async function resolveCommandPaletteGitStatus({
  repoPath,
  activeRepoPath,
  activeStatus,
  loadStatus,
}: ResolveCommandPaletteGitStatusOptions): Promise<GitStatus | undefined> {
  if (!repoPath) {
    return undefined;
  }

  if (repoPath === activeRepoPath && activeStatus) {
    return activeStatus;
  }

  return loadStatus(repoPath);
}

export function shouldPersistPickedRepoSelection(commandId: string): boolean {
  return commandId === "git-discard-all";
}
