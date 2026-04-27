import { describe, expect, it } from "vitest";
import {
  findFileReferenceMatches,
  isEditorFileReferenceHref,
  isLikelyFileReferencePath,
  linkifyMarkdownFileReferences,
  parseFileReference,
} from "./fileReferences";

describe("fileReferences", () => {
  it("detects plain file references and location suffixes", () => {
    const matches = findFileReferenceMatches(
      "Open src/App.tsx:42 and ../shared/util.ts#L9C2 before package.json.",
    );

    expect(matches.map((match) => match.rawReference)).toEqual([
      "src/App.tsx:42",
      "../shared/util.ts#L9C2",
      "package.json",
    ]);
  });

  it("ignores urls and non-file numeric versions", () => {
    const matches = findFileReferenceMatches(
      "See https://example.com and version 1.2.3 before release notes.",
    );

    expect(matches).toHaveLength(0);
  });

  it("parses line and column metadata", () => {
    expect(parseFileReference("src/App.tsx:12:7")).toEqual({
      path: "src/App.tsx",
      line: 12,
      column: 7,
    });
    expect(parseFileReference("/tmp/file.rs#L10C4")).toEqual({
      path: "/tmp/file.rs",
      line: 10,
      column: 4,
    });
  });

  it("linkifies markdown references while skipping code and existing links", () => {
    const linked = linkifyMarkdownFileReferences(
      [
        "Review src/App.tsx and [existing](./docs/guide.md).",
        "",
        "`src/inline.ts` should stay plain.",
        "",
        "```ts",
        "src/fenced.ts",
        "```",
      ].join("\n"),
    );

    expect(linked).toContain("[src/App.tsx](<src/App.tsx>)");
    expect(linked).toContain("[existing](./docs/guide.md)");
    expect(linked).toContain("`src/inline.ts`");
    expect(linked).toContain("src/fenced.ts");
    expect(linked).not.toContain("[src/inline.ts]");
    expect(linked).not.toContain("[src/fenced.ts]");
  });

  it("preserves inline html while still linkifying surrounding plain text", () => {
    const linked = linkifyMarkdownFileReferences(
      'See <a href="src/App.tsx">src/App.tsx</a> and <img src="src/logo.svg"> beside src/main.ts.',
    );

    expect(linked).toContain('<a href="src/App.tsx">src/App.tsx</a>');
    expect(linked).toContain('<img src="src/logo.svg">');
    expect(linked).toContain("[src/main.ts](<src/main.ts>)");
    expect(linked).not.toContain('[href="src/App.tsx"]');
    expect(linked).not.toContain('[src="src/logo.svg"]');
  });

  it("recognizes editor candidate hrefs", () => {
    expect(isEditorFileReferenceHref("./src/App.tsx")).toBe(true);
    expect(isEditorFileReferenceHref("/repo/src/App.tsx#L9")).toBe(true);
    expect(isEditorFileReferenceHref("https://example.com")).toBe(false);
    expect(isEditorFileReferenceHref("#")).toBe(false);
    expect(isLikelyFileReferencePath("Cargo.toml")).toBe(true);
    expect(isLikelyFileReferencePath("1.2.3")).toBe(false);
  });
});
