import { describe, expect, it } from "vitest";
import {
  isCurrentExplorerLoad,
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
