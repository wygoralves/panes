import { describe, expect, it } from "vitest";
import { isCurrentExplorerLoad } from "./fileExplorerState";

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
