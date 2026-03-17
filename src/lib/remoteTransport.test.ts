import { describe, expect, it, vi } from "vitest";
import {
  createRemoteTransport,
  remoteTransportInternals,
  type RemoteTransportSocket,
} from "./remoteTransport";

type FakeSocketEventMap = {
  open: Event;
  message: MessageEvent<string>;
  error: Event;
  close: CloseEvent;
};

type ListenerMap = {
  [K in keyof FakeSocketEventMap]: Set<(event: FakeSocketEventMap[K]) => void>;
};

class FakeSocket implements RemoteTransportSocket {
  readyState = 0;
  sent: string[] = [];
  private readonly listeners: ListenerMap = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  };

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.emit("close", { code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }

  addEventListener<K extends keyof FakeSocketEventMap>(
    type: K,
    listener: (event: FakeSocketEventMap[K]) => void,
  ): void {
    this.listeners[type].add(listener);
  }

  removeEventListener<K extends keyof FakeSocketEventMap>(
    type: K,
    listener: (event: FakeSocketEventMap[K]) => void,
  ): void {
    this.listeners[type].delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {} as Event);
  }

  emitMessage(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) } as MessageEvent<string>);
  }

  emitError(): void {
    this.emit("error", {} as Event);
  }

  private emit<K extends keyof FakeSocketEventMap>(
    type: K,
    event: FakeSocketEventMap[K],
  ): void {
    for (const listener of this.listeners[type]) {
      listener(event);
    }
  }
}

describe("remoteTransport", () => {
  it("queues command sends until the socket is open and resolves responses by id", async () => {
    const socket = new FakeSocket();
    const transport = createRemoteTransport("ws://panes.test", {
      socketFactory: () => socket,
    });

    const pending = transport.invoke<string>("list_workspaces", { limit: 1 });
    await Promise.resolve();
    expect(socket.sent).toHaveLength(0);

    socket.open();
    await Promise.resolve();

    const request = JSON.parse(socket.sent[0]) as {
      id: string;
      command: string;
      args: { limit: number } | null;
    };
    expect(request.command).toBe("list_workspaces");
    expect(request.args).toEqual({ limit: 1 });

    socket.emitMessage({ id: request.id, ok: true, result: ["ws-1"] });
    await expect(pending).resolves.toEqual(["ws-1"]);
  });

  it("authenticates before resolving readiness when an auth token is configured", async () => {
    const socket = new FakeSocket();
    const transport = createRemoteTransport("ws://panes.test", {
      socketFactory: () => socket,
      authToken: "panes_token",
    });

    const pending = transport.invoke<string[]>("list_workspaces");
    await Promise.resolve();

    socket.open();
    await Promise.resolve();
    expect(JSON.parse(socket.sent[0])).toEqual({
      id: "remote-auth-0",
      command: "authenticate_session",
      args: { token: "panes_token" },
    });

    socket.emitMessage({ id: "remote-auth-0", ok: true, result: null });
    await Promise.resolve();
    expect(JSON.parse(socket.sent[1]).command).toBe("list_workspaces");

    socket.emitMessage({ id: "remote-1", ok: true, result: ["ws-1"] });
    await expect(pending).resolves.toEqual(["ws-1"]);
  });

  it("still performs the auth handshake when the socket starts open", async () => {
    const socket = new FakeSocket();
    socket.open();
    const transport = createRemoteTransport("ws://panes.test", {
      socketFactory: () => socket,
      authToken: "panes_token",
    });

    const pending = transport.invoke<string[]>("list_workspaces");
    await Promise.resolve();
    expect(JSON.parse(socket.sent[0]).command).toBe("authenticate_session");

    socket.emitMessage({ id: "remote-auth-0", ok: true, result: null });
    await Promise.resolve();
    expect(JSON.parse(socket.sent[1]).command).toBe("list_workspaces");

    socket.emitMessage({ id: "remote-1", ok: true, result: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it("dispatches host events by channel and stops after unlisten", async () => {
    const socket = new FakeSocket();
    const transport = createRemoteTransport("ws://panes.test", {
      socketFactory: () => socket,
    });
    const onEvent = vi.fn();

    const unlisten = await transport.listen("terminal-output-ws-1", onEvent);
    socket.emitMessage({
      channel: "terminal-output-ws-1",
      payload: { sessionId: "s1", data: "hello" },
    });
    expect(onEvent).toHaveBeenCalledWith({ sessionId: "s1", data: "hello" });

    unlisten();
    socket.emitMessage({
      channel: "terminal-output-ws-1",
      payload: { sessionId: "s1", data: "world" },
    });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects pending requests when the socket closes", async () => {
    const socket = new FakeSocket();
    const transport = createRemoteTransport("ws://panes.test", {
      socketFactory: () => socket,
    });

    socket.open();
    const pending = transport.invoke("terminal_write", { workspaceId: "ws-1" });
    await Promise.resolve();
    socket.close(1006, "network_lost");

    await expect(pending).rejects.toThrow("Remote transport closed: network_lost");
  });

  it("ignores malformed inbound payloads", () => {
    expect(remoteTransportInternals.parseRemoteInboundMessage("not json")).toBeNull();
    expect(
      remoteTransportInternals.parseRemoteInboundMessage(JSON.stringify({ foo: "bar" })),
    ).toBeNull();
  });
});
