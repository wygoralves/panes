export const DEFAULT_REMOTE_HOST_BIND_ADDR = "127.0.0.1:4050";

export interface RemoteBindAddressParts {
  host: string;
  port: string;
  wildcard: boolean;
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function normalizeHostForUrl(host: string): string {
  const normalized = stripIpv6Brackets(host.trim());
  if (!normalized) {
    return normalized;
  }
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

export function parseRemoteBindAddr(bindAddr: string): RemoteBindAddressParts | null {
  const value = bindAddr.trim();
  if (!value) {
    return null;
  }

  if (value.startsWith("[")) {
    const endBracket = value.indexOf("]");
    if (endBracket <= 0 || value[endBracket + 1] !== ":") {
      return null;
    }

    const host = value.slice(1, endBracket).trim();
    const port = value.slice(endBracket + 2).trim();
    if (!host || !/^\d+$/.test(port)) {
      return null;
    }

    return {
      host,
      port,
      wildcard: host === "::",
    };
  }

  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return null;
  }

  const host = value.slice(0, separatorIndex).trim();
  const port = value.slice(separatorIndex + 1).trim();
  if (!host || !/^\d+$/.test(port) || host.includes(":")) {
    return null;
  }

  return {
    host,
    port,
    wildcard: host === "0.0.0.0",
  };
}

export function deriveRemoteConnectHost(
  bindAddr: string,
  connectHost?: string | null,
): string {
  const parsed = parseRemoteBindAddr(bindAddr);
  if (!parsed) {
    return "";
  }

  if (!parsed.wildcard) {
    return parsed.host;
  }

  const preferredHost = stripIpv6Brackets(connectHost?.trim() ?? "");
  return preferredHost;
}

export function buildRemoteConnectUrl(
  bindAddr: string,
  connectHost?: string | null,
): string {
  const parsed = parseRemoteBindAddr(bindAddr);
  if (!parsed) {
    return "";
  }

  const host = deriveRemoteConnectHost(bindAddr, connectHost);
  if (!host) {
    return "";
  }

  return `ws://${normalizeHostForUrl(host)}:${parsed.port}`;
}

export function buildRemoteWebUrl(
  bindAddr: string,
  connectHost?: string | null,
  path = "/remote",
): string {
  const parsed = parseRemoteBindAddr(bindAddr);
  if (!parsed) {
    return "";
  }

  const host = deriveRemoteConnectHost(bindAddr, connectHost);
  if (!host) {
    return "";
  }

  return `http://${normalizeHostForUrl(host)}:${parsed.port}${path}`;
}

export function buildRemoteBrowserLink(
  webBindAddr: string,
  remoteBindAddr: string,
  token: string,
  connectHost?: string | null,
): string {
  const baseUrl = buildRemoteWebUrl(webBindAddr, connectHost);
  const remoteUrl = buildRemoteConnectUrl(remoteBindAddr, connectHost);
  const trimmedToken = token.trim();
  if (!baseUrl || !remoteUrl || !trimmedToken) {
    return "";
  }

  const hash = new URLSearchParams({
    remoteUrl,
    token: trimmedToken,
  });
  return `${baseUrl}#${hash.toString()}`;
}

export function buildRemoteConnectionDetails(
  bindAddr: string,
  token: string,
  connectHost?: string | null,
): string {
  const lines = [`Token: ${token.trim()}`];
  const url = buildRemoteConnectUrl(bindAddr, connectHost);
  if (url) {
    lines.unshift(`URL: ${url}`);
  }
  return lines.join("\n");
}
