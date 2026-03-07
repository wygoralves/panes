import { describe, expect, it } from "vitest";
import { resolveTerminalBootstrapAction } from "./terminalBootstrap";

describe("resolveTerminalBootstrapAction", () => {
  const workspaceId = "workspace-a";

  it("returns single_session when listeners are ready and workspace is open without sessions", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: false,
      }),
    ).toBe("single_session");
  });

  it("returns preset when a startup preset is pending", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "split",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: true,
      }),
    ).toBe("preset");
  });

  it("returns none while listeners are not ready", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: false,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: false,
      }),
    ).toBe("none");
  });

  it("returns none when workspace is closed", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: false,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: false,
      }),
    ).toBe("none");
  });

  it("returns none when a session already exists", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 1,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: false,
      }),
    ).toBe("none");
  });

  it("returns none when initial creation is already in flight for the same workspace", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: workspaceId,
        hasPendingStartupPreset: false,
      }),
    ).toBe("none");
  });

  it("returns single_session for a different workspace even if another bootstrap is in flight", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "terminal",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: "workspace-b",
        hasPendingStartupPreset: false,
      }),
    ).toBe("single_session");
  });

  it("returns preset when a startup preset is pending in chat mode", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "chat",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: true,
      }),
    ).toBe("preset");
  });

  it("returns none in chat mode without a pending preset", () => {
    expect(
      resolveTerminalBootstrapAction({
        listenersReady: true,
        isOpen: true,
        layoutMode: "chat",
        sessionCount: 0,
        workspaceId,
        createInFlightWorkspaceId: null,
        hasPendingStartupPreset: false,
      }),
    ).toBe("none");
  });
});
