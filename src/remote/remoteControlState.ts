export interface RemoteControlDesiredState {
  workspace: boolean;
  thread: boolean;
}

export interface RemoteControlRequestResult {
  workspaceAcquired: boolean;
  threadAcquired: boolean;
  errors: string[];
}

type ControlScope = keyof RemoteControlDesiredState;

interface RequestRemoteControlLeasesArgs {
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  ensureWorkspaceControl: (workspaceId: string | null) => Promise<boolean>;
  ensureThreadControl: (threadId: string | null) => Promise<boolean>;
}

export function createInitialRemoteControlDesiredState(): RemoteControlDesiredState {
  return {
    workspace: true,
    thread: true,
  };
}

export function createDisabledRemoteControlDesiredState(): RemoteControlDesiredState {
  return {
    workspace: false,
    thread: false,
  };
}

export function setRemoteControlScopeDesired(
  state: RemoteControlDesiredState,
  scope: ControlScope,
  desired: boolean,
): RemoteControlDesiredState {
  return {
    ...state,
    [scope]: desired,
  };
}

export function resolveRemoteControlLevel(
  hasWorkspaceControl: boolean,
  hasThreadControl: boolean,
): "workspace" | "thread" | "viewer" {
  if (hasWorkspaceControl) {
    return "workspace";
  }
  if (hasThreadControl) {
    return "thread";
  }
  return "viewer";
}

export async function requestRemoteControlLeases({
  activeWorkspaceId,
  activeThreadId,
  ensureWorkspaceControl,
  ensureThreadControl,
}: RequestRemoteControlLeasesArgs): Promise<RemoteControlRequestResult> {
  const result: RemoteControlRequestResult = {
    workspaceAcquired: false,
    threadAcquired: false,
    errors: [],
  };

  if (activeWorkspaceId) {
    try {
      result.workspaceAcquired = await ensureWorkspaceControl(activeWorkspaceId);
    } catch (error) {
      result.errors.push(String(error));
    }
  }

  if (activeThreadId) {
    try {
      result.threadAcquired = await ensureThreadControl(activeThreadId);
    } catch (error) {
      result.errors.push(String(error));
    }
  }

  return result;
}
