import { describe, expect, it } from "vitest";
import { shouldCreateInitialTerminalSession } from "./terminalBootstrap";

describe("shouldCreateInitialTerminalSession", () => {
  const workspaceId = "workspace-a";

  it("returns true when listeners are ready and workspace is open without sessions", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
      }),
    ).toBe(true);
  });

  it("returns false while listeners are not ready", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: false,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
      }),
    ).toBe(false);
  });

  it("returns false when workspace is closed", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: false,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
      }),
    ).toBe(false);
  });

  it("returns false when a session already exists", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 1,
        workspaceId,
        createInFlightWorkspaceId: null,
      }),
    ).toBe(false);
  });

  it("returns false when initial creation is already in flight for the same workspace", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: workspaceId,
      }),
    ).toBe(false);
  });

  it("returns true for a different workspace even if another bootstrap is in flight", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: "workspace-b",
      }),
    ).toBe(true);
  });

  it("returns false when terminal is open in chat mode", () => {
    expect(
      shouldCreateInitialTerminalSession({
        listenersReady: true,
        isOpen: true,
        layoutMode: "chat",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
      }),
    ).toBe(false);
  });
});
