import { describe, expect, it } from "vitest";
import { resolveNewThreadTargetLayoutMode } from "./newThreadLayout";

describe("resolveNewThreadTargetLayoutMode", () => {
  it("keeps terminal-oriented layouts in split mode", () => {
    expect(resolveNewThreadTargetLayoutMode("terminal")).toBe("split");
    expect(resolveNewThreadTargetLayoutMode("split")).toBe("split");
  });

  it("returns chat for non-terminal layouts", () => {
    expect(resolveNewThreadTargetLayoutMode("chat")).toBe("chat");
    expect(resolveNewThreadTargetLayoutMode("editor")).toBe("chat");
    expect(resolveNewThreadTargetLayoutMode(undefined)).toBe("chat");
    expect(resolveNewThreadTargetLayoutMode(null)).toBe("chat");
  });
});
