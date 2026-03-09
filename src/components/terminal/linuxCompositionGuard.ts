export interface LinuxTerminalCompositionState {
  active: boolean;
  lastEndedAt: number;
  pendingText: string | null;
  pendingUntil: number;
  recentCommitText: string | null;
  recentCommitUntil: number;
}

const COMPOSITION_WINDOW_MS = 250;
const DUPLICATE_SUPPRESSION_MS = 80;
const DEAD_KEY_ARTIFACT_CLASS = `[\\s"'~^\`´¨\\u0300-\\u036f]`;
const DEAD_KEY_ARTIFACT_ONLY_RE = new RegExp(`^${DEAD_KEY_ARTIFACT_CLASS}+$`, "u");
const DEAD_KEY_LEADING_ARTIFACTS_RE = new RegExp(`^${DEAD_KEY_ARTIFACT_CLASS}+`, "u");

export function createLinuxTerminalCompositionState(): LinuxTerminalCompositionState {
  return {
    active: false,
    lastEndedAt: -Infinity,
    pendingText: null,
    pendingUntil: 0,
    recentCommitText: null,
    recentCommitUntil: 0,
  };
}

export function noteLinuxTerminalCompositionStart(
  state: LinuxTerminalCompositionState,
): void {
  state.active = true;
}

export function noteLinuxTerminalCompositionEnd(
  state: LinuxTerminalCompositionState,
  now: number = Date.now(),
): void {
  state.active = false;
  state.lastEndedAt = now;
}

export function noteLinuxTerminalCompositionText(
  state: LinuxTerminalCompositionState,
  data: string | null | undefined,
  inputType: string | null | undefined,
  now: number = Date.now(),
): void {
  if (!data) {
    return;
  }

  const compositionRelated =
    state.active ||
    inputType === "insertCompositionText" ||
    now - state.lastEndedAt <= COMPOSITION_WINDOW_MS;

  if (!compositionRelated) {
    return;
  }

  state.pendingText = data;
  state.pendingUntil = now + COMPOSITION_WINDOW_MS;
}

export function filterLinuxTerminalCompositionData(
  state: LinuxTerminalCompositionState,
  data: string,
  now: number = Date.now(),
): string | null {
  if (!data) {
    return null;
  }

  if (state.pendingText && now > state.pendingUntil) {
    state.pendingText = null;
    state.pendingUntil = 0;
  }
  if (state.recentCommitText && now > state.recentCommitUntil) {
    state.recentCommitText = null;
    state.recentCommitUntil = 0;
  }

  const pendingText = state.pendingText;
  if (pendingText) {
    const normalized = trimLeadingDeadKeyArtifacts(data);
    if (data === pendingText || normalized === pendingText) {
      commitPendingText(state, pendingText, now);
      return pendingText;
    }
    if (DEAD_KEY_ARTIFACT_ONLY_RE.test(data)) {
      return null;
    }
    const collapsedRepeat = collapseRepeatedPrefix(data, pendingText)
      ?? collapseRepeatedPrefix(normalized, pendingText);
    if (collapsedRepeat) {
      commitPendingText(state, pendingText, now);
      return collapsedRepeat;
    }
    if (normalized.startsWith(pendingText)) {
      commitPendingText(state, pendingText, now);
      return normalized;
    }
  }

  const recentCommitText = state.recentCommitText;
  if (recentCommitText) {
    const normalized = trimLeadingDeadKeyArtifacts(data);
    if (
      data === recentCommitText ||
      normalized === recentCommitText ||
      collapseRepeatedPrefix(data, recentCommitText) === recentCommitText ||
      collapseRepeatedPrefix(normalized, recentCommitText) === recentCommitText
    ) {
      return null;
    }
  }

  return data;
}

function commitPendingText(
  state: LinuxTerminalCompositionState,
  pendingText: string,
  now: number,
): void {
  state.pendingText = null;
  state.pendingUntil = 0;
  state.recentCommitText = pendingText;
  state.recentCommitUntil = now + DUPLICATE_SUPPRESSION_MS;
}

function trimLeadingDeadKeyArtifacts(data: string): string {
  return data.replace(DEAD_KEY_LEADING_ARTIFACTS_RE, "");
}

function collapseRepeatedPrefix(data: string, expected: string): string | null {
  if (!expected || data.length <= expected.length) {
    return null;
  }
  let offset = 0;
  let repeatCount = 0;
  while (data.startsWith(expected, offset)) {
    repeatCount += 1;
    offset += expected.length;
  }
  if (repeatCount < 2) {
    return null;
  }
  return expected + data.slice(offset);
}
