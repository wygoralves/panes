import { describe, expect, it } from "vitest";
import { buildTreeRows, getFileDisplayName } from "./gitChangesUtils";

describe("getFileDisplayName", () => {
  it("returns the last path segment", () => {
    expect(getFileDisplayName("src/components/App.tsx")).toBe("App.tsx");
  });

  it("returns the directory name for untracked directory paths", () => {
    expect(getFileDisplayName("newdir/")).toBe("newdir");
    expect(getFileDisplayName("nested/newdir/")).toBe("newdir");
  });

  it("falls back to the raw path when there are no segments", () => {
    expect(getFileDisplayName("")).toBe("");
  });
});

describe("buildTreeRows", () => {
  it("names untracked directory entries after the directory", () => {
    const rows = buildTreeRows(
      [{ path: "newdir/", worktreeStatus: "untracked" }],
      "changes",
      {},
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "file",
      name: "newdir",
      path: "newdir/",
    });
  });
});
