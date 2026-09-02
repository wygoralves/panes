import { describe, expect, it } from "vitest";
import { normalizeSidebarListMode } from "./sidebarListMode";

describe("normalizeSidebarListMode", () => {
  it("supports project and status grouping", () => {
    expect(normalizeSidebarListMode("projects")).toBe("projects");
    expect(normalizeSidebarListMode("status")).toBe("status");
  });

  it("migrates the former fleet value to status", () => {
    expect(normalizeSidebarListMode("fleet")).toBe("status");
  });

  it("falls back to project grouping", () => {
    expect(normalizeSidebarListMode("unknown")).toBe("projects");
  });
});
