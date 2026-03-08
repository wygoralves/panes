export type CommandPaletteVariant = "general" | "search";

export type CommandPaletteSearchScope = "all" | "messages" | "files" | "threads";

export interface CommandPaletteLaunchState {
  variant: CommandPaletteVariant;
  initialQuery: string;
  searchScope: CommandPaletteSearchScope;
}

export type CommandPaletteMode =
  | "default"
  | "command"
  | "thread"
  | "workspace"
  | "file"
  | "search"
  | "auto";

export const COMMAND_PALETTE_DEFAULT_LAUNCH: CommandPaletteLaunchState = {
  variant: "general",
  initialQuery: "",
  searchScope: "all",
};

export const COMMAND_PALETTE_GENERAL_PREFIXES = [">", "@", "#", "%", "?", ""] as const;
const COMMAND_PALETTE_ESCAPE_PREFIXES = new Set([">", "/", "@", "#", "%"]);

const SEARCH_SCOPE_ORDER: CommandPaletteSearchScope[] = ["all", "messages", "files", "threads"];

export function detectCommandPaletteMode(query: string): {
  mode: CommandPaletteMode;
  term: string;
} {
  if (query === "") return { mode: "default", term: "" };
  if (query.startsWith("?")) {
    return { mode: "search", term: query.slice(1) };
  }
  if (query.startsWith(">") || query.startsWith("/")) {
    return { mode: "command", term: query.slice(1).trimStart() };
  }
  if (query.startsWith("@")) {
    return { mode: "thread", term: query.slice(1) };
  }
  if (query.startsWith("#")) {
    return { mode: "workspace", term: query.slice(1) };
  }
  if (query.startsWith("%")) {
    return { mode: "file", term: query.slice(1) };
  }
  return { mode: "auto", term: query };
}

export function getNextCommandPalettePrefix(query: string): string {
  const currentPrefix =
    query.length > 0 && COMMAND_PALETTE_GENERAL_PREFIXES.includes(query[0] as (typeof COMMAND_PALETTE_GENERAL_PREFIXES)[number])
      ? query[0]
      : "";
  const currentIndex = COMMAND_PALETTE_GENERAL_PREFIXES.indexOf(
    currentPrefix as (typeof COMMAND_PALETTE_GENERAL_PREFIXES)[number],
  );
  const nextIndex = (currentIndex + 1) % COMMAND_PALETTE_GENERAL_PREFIXES.length;
  return COMMAND_PALETTE_GENERAL_PREFIXES[nextIndex];
}

export function getNextCommandPaletteSearchScope(
  scope: CommandPaletteSearchScope,
): CommandPaletteSearchScope {
  const currentIndex = SEARCH_SCOPE_ORDER.indexOf(scope);
  const nextIndex = (currentIndex + 1) % SEARCH_SCOPE_ORDER.length;
  return SEARCH_SCOPE_ORDER[nextIndex];
}

export function normalizeCommandPaletteInput(
  rawValue: string,
  currentMode: CommandPaletteMode,
): string {
  if (currentMode !== "search") {
    return rawValue;
  }

  if (rawValue === "") {
    return "?";
  }

  if (COMMAND_PALETTE_ESCAPE_PREFIXES.has(rawValue[0])) {
    return rawValue;
  }

  return `?${rawValue.replace(/^\?/, "")}`;
}

export function shouldTabCycleCommandPaletteSearchScope(
  mode: CommandPaletteMode,
  term: string,
): boolean {
  return mode === "search" && term.trim().length > 0;
}
