import { describe, expect, it } from "vitest";
import { buildCodexInputItems } from "./codexInputItems";

describe("buildCodexInputItems", () => {
  it("converts matching $skill and $app tokens into typed input items", () => {
    expect(
      buildCodexInputItems(
        "Use $lint with $docs today",
        [
          {
            name: "lint",
            path: "/skills/lint",
            description: "Run linting helpers",
            enabled: true,
            scope: "workspace",
          },
        ],
        [
          {
            id: "docs",
            name: "Docs",
            description: "Workspace docs",
            isEnabled: true,
            isAccessible: true,
          },
        ],
      ),
    ).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "lint", path: "/skills/lint" },
      { type: "text", text: " with " },
      { type: "mention", name: "Docs", path: "app://docs" },
      { type: "text", text: " today" },
    ]);
  });

  it("falls back to a single text item when no references match", () => {
    expect(buildCodexInputItems("Plain message", [], [])).toEqual([
      { type: "text", text: "Plain message" },
    ]);
  });

  it("leaves unknown tokens inside adjacent text spans", () => {
    expect(
      buildCodexInputItems(
        "Keep $unknown and use $lint",
        [
          {
            name: "lint",
            path: "/skills/lint",
            description: "Run linting helpers",
            enabled: true,
            scope: "workspace",
          },
        ],
        [],
      ),
    ).toEqual([
      { type: "text", text: "Keep $unknown and use " },
      { type: "skill", name: "lint", path: "/skills/lint" },
    ]);
  });
});
