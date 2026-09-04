import { engineKind } from "./engineKind";

/**
 * Engines that accept input inside a running turn. Codex has `turn/steer`;
 * Claude streams follow-up user messages into the open query. OpenCode can
 * only take a new turn, so its follow-ups queue until the current one ends.
 */
export function engineSupportsSteering(engineId: string | null | undefined): boolean {
  const kind = engineKind(engineId);
  return kind === "codex" || kind === "claude";
}
