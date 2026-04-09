import { describe, expect, it } from "vitest";
import {
  isCurrentExplorerLoad,
  isKnownDirectoryPath,
  pruneDeletedMapKeys,
  pruneDeletedSetPaths,
  pruneContainedPaths,
  remapDescendantPath,
} from "./fileExplorerState";

describe("isCurrentExplorerLoad", () => {
  it("accepts loads for the current workspace root generation", () => {
    expect(
      isCurrentExplorerLoad(
        { generation: 3, rootPath: "/workspace-a" },
        { generation: 3, rootPath: "/workspace-a" },
      ),
    ).toBe(true);
  });

  it("rejects loads from an older workspace generation", () => {
    expect(
      isCurrentExplorerLoad(
        { generation: 2, rootPath: "/workspace-a" },
        { generation: 3, rootPath: "/workspace-a" },
      ),
    ).toBe(false);
  });

  it("rejects loads for a different workspace root", () => {
    expect(
      isCurrentExplorerLoad(
        { generation: 3, rootPath: "/workspace-a" },
        { generation: 3, rootPath: "/workspace-b" },
      ),
    ).toBe(false);
  });
});

describe("pruneContainedPaths", () => {
  it("removes descendants when a parent path is already selected", () => {
    expect(
      pruneContainedPaths([
        "src",
        "src/components",
        "src/components/editor/FileExplorer.tsx",
        "README.md",
      ]),
    ).toEqual(["src", "README.md"]);
  });

  it("deduplicates identical paths", () => {
    expect(pruneContainedPaths(["src", "src", "README.md"])).toEqual([
      "src",
      "README.md",
    ]);
  });
});

describe("remapDescendantPath", () => {
  it("remaps the renamed path itself", () => {
    expect(remapDescendantPath("src/app.ts", "src/app.ts", "src/main.ts")).toBe(
      "src/main.ts",
    );
  });

  it("remaps descendants under a renamed directory", () => {
    expect(
      remapDescendantPath(
        "src/components/editor/FileExplorer.tsx",
        "src/components",
        "src/ui",
      ),
    ).toBe("src/ui/editor/FileExplorer.tsx");
  });

  it("returns null for unaffected paths", () => {
    expect(remapDescendantPath("README.md", "src/components", "src/ui")).toBeNull();
  });
});

describe("pruneDeletedSetPaths", () => {
  it("removes deleted folders and their expanded descendants", () => {
    expect(
      pruneDeletedSetPaths(
        new Set(["src/components", "src/components/editor", "README.md"]),
        ["src/components"],
      ),
    ).toEqual(new Set(["README.md"]));
  });
});

describe("pruneDeletedMapKeys", () => {
  it("removes cached directory contents for deleted subtrees", () => {
    const dirContents = new Map([
      ["", [{ path: "src/components", isDir: true }]],
      ["src/components", [{ path: "src/components/editor", isDir: true }]],
      ["src/components/editor", [{ path: "src/components/editor/FileExplorer.tsx", isDir: false }]],
      ["docs", [{ path: "docs/guide.md", isDir: false }]],
    ]);

    expect(pruneDeletedMapKeys(dirContents, ["src/components"])).toEqual(
      new Map([
        ["", [{ path: "src/components", isDir: true }]],
        ["docs", [{ path: "docs/guide.md", isDir: false }]],
      ]),
    );
  });
});

describe("isKnownDirectoryPath", () => {
  it("recognizes collapsed directories from their parent listing", () => {
    const dirContents = new Map([
      ["", [{ path: "src", isDir: true }]],
      ["docs", [{ path: "docs/guide.md", isDir: false }]],
    ]);

    expect(isKnownDirectoryPath(dirContents, "src")).toBe(true);
    expect(isKnownDirectoryPath(dirContents, "docs/guide.md")).toBe(false);
  });
});
