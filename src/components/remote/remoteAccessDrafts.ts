import {
  DEFAULT_REMOTE_HOST_BIND_ADDR,
  deriveRemoteConnectHost,
} from "../../lib/remoteConnection";

export function resolveRemoteAccessBindAddrDraft(
  currentDraft: string,
  statusBindAddr: string | null,
  dirty: boolean,
): string {
  if (dirty) {
    return currentDraft;
  }

  return statusBindAddr ?? (currentDraft.trim() || DEFAULT_REMOTE_HOST_BIND_ADDR);
}

export function resolveRemoteAccessConnectHostDraft(
  currentDraft: string,
  bindAddr: string,
  dirty: boolean,
): string {
  if (dirty) {
    return currentDraft;
  }

  return deriveRemoteConnectHost(bindAddr);
}
