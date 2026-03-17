export interface RemoteBootstrapState {
  mode: "desktop" | "remote";
  url: string;
  token: string;
  autoConnect: boolean;
}

interface RemoteBootstrapLocation {
  pathname: string;
  search: string;
  hash: string;
}

export const REMOTE_ATTACH_PATH = "/remote";

export function parseRemoteBootstrapState(
  location: RemoteBootstrapLocation,
  persistedUrl: string,
): RemoteBootstrapState {
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const url = search.get("remoteUrl") ?? hash.get("remoteUrl") ?? persistedUrl;
  const token = hash.get("token") ?? search.get("token") ?? "";
  const mode =
    location.pathname === REMOTE_ATTACH_PATH ||
    search.get("remote") === "1" ||
    search.has("remoteUrl")
      ? "remote"
      : "desktop";

  return {
    mode,
    url,
    token,
    autoConnect: Boolean(url && token),
  };
}

export function buildRemoteAttachCleanUrl(location: RemoteBootstrapLocation): string {
  const search = new URLSearchParams(location.search);
  search.delete("remote");
  search.delete("remoteUrl");
  search.delete("token");

  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  hash.delete("remoteUrl");
  hash.delete("token");

  const nextSearch = search.toString();
  const nextHash = hash.toString();

  return `${REMOTE_ATTACH_PATH}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
}
