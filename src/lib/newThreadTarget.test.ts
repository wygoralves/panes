import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ipc", () => ({
  ipc: {},
  listenThreadEvents: vi.fn(),
}));

import { resolveNewThreadWorkspaceId } from "./newThreadActions";
import { useSidebarListModeStore } from "../stores/sidebarListModeStore";
import { useSidebarViewStore } from "../stores/sidebarViewStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Workspace } from "../types";

function workspace(id: string): Workspace {
  return {
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    scanDepth: 2,
    createdAt: "2026-09-01T12:00:00.000Z",
    lastOpenedAt: "2026-09-01T12:00:00.000Z",
  };
}

describe("resolveNewThreadWorkspaceId", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [workspace("workspace-a"), workspace("workspace-b")],
      activeWorkspaceId: "workspace-a",
    });
    useSidebarViewStore.setState({ projectFilterId: null });
    useSidebarListModeStore.setState({ mode: "projects" });
  });

  it("uses the active project when no filter is set", () => {
    expect(resolveNewThreadWorkspaceId()).toBe("workspace-a");
  });

  it("uses the filtered project in status mode", () => {
    useSidebarListModeStore.setState({ mode: "status" });
    useSidebarViewStore.setState({ projectFilterId: "workspace-b" });

    expect(resolveNewThreadWorkspaceId()).toBe("workspace-b");
  });

  it("ignores the filter in project mode", () => {
    useSidebarViewStore.setState({ projectFilterId: "workspace-b" });

    expect(resolveNewThreadWorkspaceId()).toBe("workspace-a");
  });

  it("falls back to the active project when the filter no longer exists", () => {
    useSidebarListModeStore.setState({ mode: "status" });
    useSidebarViewStore.setState({ projectFilterId: "workspace-gone" });

    expect(resolveNewThreadWorkspaceId()).toBe("workspace-a");
  });
});
