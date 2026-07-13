import { describe, expect, it } from "vitest";
import { resolveThreadFileRootPath } from "./fileRootUtils";

const repos = [
  { id: "repo-a", path: "/workspace/repo-a" },
  { id: "repo-b", path: "/workspace/repo-b" },
];

describe("resolveThreadFileRootPath", () => {
  it("uses the thread repository instead of an independently selected repo", () => {
    expect(
      resolveThreadFileRootPath(
        { repoId: "repo-a" },
        repos,
        "/workspace",
      ),
    ).toBe("/workspace/repo-a");
  });

  it("uses the workspace root for workspace-scoped threads", () => {
    expect(
      resolveThreadFileRootPath({ repoId: null }, repos, "/workspace"),
    ).toBe("/workspace");
  });

  it("does not fall back to another root when the thread repository is missing", () => {
    expect(
      resolveThreadFileRootPath(
        { repoId: "missing" },
        repos,
        "/workspace",
      ),
    ).toBeNull();
  });
});
