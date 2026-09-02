export const ENGINE_KINDS = ["codex", "claude", "opencode"] as const;

export type EngineKind = (typeof ENGINE_KINDS)[number];

export const CHAT_PROVIDER_KINDS = ["codex", "claude"] as const;

export type ChatProviderKind = (typeof CHAT_PROVIDER_KINDS)[number];

/**
 * Resolves the engine kind behind an engine id. Built-in ids are their own
 * kind; extra provider instances are named `<kind>_<slug>`.
 */
export function engineKind(engineId: string | null | undefined): string {
  if (!engineId) return "";
  if ((ENGINE_KINDS as readonly string[]).includes(engineId)) return engineId;
  for (const kind of ENGINE_KINDS) {
    if (engineId.startsWith(`${kind}_`) && engineId.length > kind.length + 1) {
      return kind;
    }
  }
  return engineId;
}

export function isBuiltinEngineId(engineId: string): boolean {
  return (ENGINE_KINDS as readonly string[]).includes(engineId);
}

export function isChatProviderKind(value: string): value is ChatProviderKind {
  return (CHAT_PROVIDER_KINDS as readonly string[]).includes(value);
}

/** Turns a label like "Work laptop" into the id suffix "work-laptop". */
export function chatProviderSlugFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 48);
}

export function isValidChatProviderSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]{0,47}$/.test(slug);
}
