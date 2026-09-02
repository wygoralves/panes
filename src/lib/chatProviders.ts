import type { ChatProviderInstance } from "../types";

/** Default config directory for an extra provider instance. */
export function defaultChatProviderHomePath(kind: string, slug: string): string {
  return `~/.${kind}-${slug}`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * The shell command that signs a provider instance in, run from a terminal
 * so the CLI can open its browser flow with this instance's config directory.
 */
export function chatProviderSignInCommand(provider: ChatProviderInstance): string {
  const env: string[] = [];
  const homeKey = provider.kind === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  if (provider.homePath) {
    env.push(`${homeKey}=${shellQuote(provider.homePath)}`);
  }
  for (const [name, value] of Object.entries(provider.env)) {
    if (name === homeKey && provider.homePath) continue;
    env.push(`${name}=${shellQuote(value)}`);
  }
  const binary = provider.binaryPath ? shellQuote(provider.binaryPath) : provider.kind;
  const login = provider.kind === "codex" ? "login" : "auth login";
  return [...env, binary, login].join(" ");
}
