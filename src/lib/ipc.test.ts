import { afterEach, describe, expect, it, vi } from "vitest";
import { ipc, listenThreadEvents, writeCommandToNewSession } from "./ipc";
import { resetPanesTransport, setPanesTransport, type PanesTransport } from "./panesTransport";

function createMockTransport() {
  const listeners = new Map<string, (payload: unknown) => void>();
  const invoke = vi.fn();
  const listen = vi.fn(async (channel: string, onEvent: (payload: unknown) => void) => {
    listeners.set(channel, onEvent);
    return () => {
      listeners.delete(channel);
    };
  });
  const transport: PanesTransport = {
    invoke: (command, args) => invoke(command, args),
    listen: (channel, onEvent) => listen(channel, onEvent as (payload: unknown) => void),
  };

  return { invoke, listen, listeners, transport };
}

describe("ipc transport", () => {
  afterEach(() => {
    resetPanesTransport();
    vi.useRealTimers();
  });

  it("forwards commands through the configured transport", async () => {
    const { invoke, transport } = createMockTransport();
    invoke.mockResolvedValue("pt-BR");
    setPanesTransport(transport);

    await expect(ipc.getAppLocale()).resolves.toBe("pt-BR");
    expect(invoke).toHaveBeenCalledWith("get_app_locale", undefined);
  });

  it("forwards remote audit queries through the configured transport", async () => {
    const { invoke, transport } = createMockTransport();
    invoke.mockResolvedValue([]);
    setPanesTransport(transport);

    await expect(ipc.listRemoteAuditEvents(25)).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledWith("list_remote_audit_events", {
      limit: 25,
    });
  });

  it("forwards remote host control commands through the configured transport", async () => {
    const { invoke, transport } = createMockTransport();
    invoke.mockResolvedValue({ running: true, bindAddr: "127.0.0.1:4050" });
    setPanesTransport(transport);

    await expect(ipc.startRemoteHost("0.0.0.0:4050")).resolves.toEqual({
      running: true,
      bindAddr: "127.0.0.1:4050",
    });
    expect(invoke).toHaveBeenCalledWith("start_remote_host", {
      bindAddr: "0.0.0.0:4050",
    });
  });

  it("forwards event subscriptions through the configured transport", async () => {
    const { listeners, listen, transport } = createMockTransport();
    setPanesTransport(transport);
    const onEvent = vi.fn();

    const unlisten = await listenThreadEvents("thread-1", onEvent);
    listeners.get("stream-event-thread-1")?.({ type: "thread.updated" });

    expect(listen).toHaveBeenCalledWith("stream-event-thread-1", expect.any(Function));
    expect(onEvent).toHaveBeenCalledWith({ type: "thread.updated" });
    unlisten();
    expect(listeners.has("stream-event-thread-1")).toBe(false);
  });

  it("uses the configured transport when bootstrapping a new terminal session", async () => {
    vi.useFakeTimers();
    const { invoke, listeners, transport } = createMockTransport();
    invoke.mockResolvedValue(undefined);
    setPanesTransport(transport);

    const pendingWrite = writeCommandToNewSession("ws-1", "session-1", "echo ready");
    await Promise.resolve();

    listeners.get("terminal-output-ws-1")?.({
      sessionId: "session-1",
      seq: 1,
      ts: new Date().toISOString(),
      data: "$ ",
    });
    await vi.advanceTimersByTimeAsync(50);
    await pendingWrite;

    expect(invoke).toHaveBeenCalledWith("terminal_write", {
      workspaceId: "ws-1",
      sessionId: "session-1",
      data: "echo ready\r",
    });
  });
});
