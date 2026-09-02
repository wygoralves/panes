import type { ChatProviderInstance } from "../types";

/** Default config directory for an extra provider instance. */
export function defaultChatProviderHomePath(kind: string, slug: string): string {
  return `~/.${kind}-${slug}`;
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * Quotes a path for the shell while letting a leading `~/` resolve to the
 * home directory. Inside double quotes the shell leaves `~` alone, and a
 * literal `~` directory would then be created in the terminal's cwd.
 */
function shellQuotePath(value: string): string {
  if (value === "~") return '"$HOME"';
  if (value.startsWith("~/")) {
    return `"$HOME/${value.slice(2).replace(/(["\\$`])/g, "\\$1")}"`;
  }
  return shellQuote(value);
}

/**
 * The shell command that signs a provider instance in, run from a terminal
 * so the CLI can open its browser flow with this instance's config directory.
 */
export function chatProviderSignInCommand(provider: ChatProviderInstance): string {
  const env: string[] = [];
  const homeKey = provider.kind === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
  if (provider.homePath) {
    env.push(`${homeKey}=${shellQuotePath(provider.homePath)}`);
  }
  for (const [name, value] of Object.entries(provider.env)) {
    if (name === homeKey && provider.homePath) continue;
    env.push(`${name}=${shellQuote(value)}`);
  }
  const binary = provider.binaryPath ? shellQuotePath(provider.binaryPath) : provider.kind;
  const login = provider.kind === "codex" ? "login" : "auth login";
  return [...env, binary, login].join(" ");
}
