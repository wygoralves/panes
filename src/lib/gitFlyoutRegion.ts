import { createContext } from "react";

export const GIT_FLYOUT_REGION_ATTRIBUTE = "data-git-flyout-region";
const GIT_FLYOUT_REGION_SELECTOR = `[${GIT_FLYOUT_REGION_ATTRIBUTE}="true"]`;

export interface GitFlyoutContextValue {
  openFlyout: () => void;
  scheduleClose: (delay?: number) => void;
  isTargetWithinRegion: (target: EventTarget | null) => boolean;
}

export const GitFlyoutContext = createContext<GitFlyoutContextValue | null>(null);

export function isTargetWithinGitFlyoutRegion(
  target: EventTarget | null,
  roots: Array<HTMLElement | null | undefined>,
): boolean {
  if (!(target instanceof Node)) {
    return false;
  }

  for (const root of roots) {
    if (root?.contains(target)) {
      return true;
    }
  }

  const element = target instanceof Element ? target : target.parentElement;
  return Boolean(element?.closest(GIT_FLYOUT_REGION_SELECTOR));
}

export function closeGitFlyoutIfFocusLeft(
  context: GitFlyoutContextValue | null,
  nextTarget: EventTarget | null,
): void {
  if (!context || context.isTargetWithinRegion(nextTarget)) {
    return;
  }

  context.scheduleClose();
}
