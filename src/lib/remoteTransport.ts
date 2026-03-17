import type { PanesTransport, PanesUnlistenFn } from "./panesTransport";

const SOCKET_OPEN = 1;

export interface RemoteCommandRequest {
  id: string;
  command: string;
  args?: Record<string, unknown> | null;
}

export interface RemoteCommandSuccess {
  id: string;
  ok: true;
  result: unknown;
}

export interface RemoteCommandFailure {
  id: string;
  ok: false;
  error: string;
}

export interface RemoteEventEnvelope {
  channel: string;
  payload: unknown;
}

type RemoteInboundMessage = RemoteCommandSuccess | RemoteCommandFailure | RemoteEventEnvelope;

type RemoteSocketEventMap = {
  open: Event;
  message: MessageEvent<string>;
  error: Event;
  close: CloseEvent;
};

export interface RemoteTransportSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener<K extends keyof RemoteSocketEventMap>(
    type: K,
    listener: (event: RemoteSocketEventMap[K]) => void,
  ): void;
  removeEventListener<K extends keyof RemoteSocketEventMap>(
    type: K,
    listener: (event: RemoteSocketEventMap[K]) => void,
  ): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface RemotePanesTransportOptions {
  socketFactory?: (url: string) => RemoteTransportSocket;
  authToken?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRemoteEventEnvelope(message: unknown): message is RemoteEventEnvelope {
  return isObject(message) && typeof message.channel === "string" && "payload" in message;
}

function isRemoteCommandSuccess(message: unknown): message is RemoteCommandSuccess {
  return isObject(message) && typeof message.id === "string" && message.ok === true && "result" in message;
}

function isRemoteCommandFailure(message: unknown): message is RemoteCommandFailure {
  return isObject(message) && typeof message.id === "string" && message.ok === false && typeof message.error === "string";
}

function parseRemoteInboundMessage(raw: string): RemoteInboundMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRemoteEventEnvelope(parsed) || isRemoteCommandSuccess(parsed) || isRemoteCommandFailure(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function buildCloseError(reason: string): Error {
  return new Error(`Remote transport closed: ${reason}`);
}

export class RemotePanesTransport implements PanesTransport {
  private static readonly AUTH_REQUEST_ID = "remote-auth-0";
  private readonly socket: RemoteTransportSocket;
  private readonly channelListeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly readyPromise: Promise<void>;
  private readonly authToken: string | null;
  private readyResolved = false;
  private readyRejected = false;
  private nextRequestId = 1;
  private resolveReady!: () => void;
  private rejectReady!: (reason?: unknown) => void;

  constructor(
    private readonly url: string,
    options: RemotePanesTransportOptions = {},
  ) {
    this.authToken = options.authToken?.trim() || null;
    this.socket = (options.socketFactory ?? ((socketUrl) => new WebSocket(socketUrl)))(url);
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.socket.addEventListener("open", this.handleOpen);
    this.socket.addEventListener("message", this.handleMessage);
    this.socket.addEventListener("error", this.handleError);
    this.socket.addEventListener("close", this.handleClose);

    if (this.socket.readyState === SOCKET_OPEN) {
      if (this.authToken) {
        this.sendAuthHandshake();
      } else {
        this.handleReady();
      }
    }
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    await this.readyPromise;

    return new Promise<T>((resolve, reject) => {
      const id = `remote-${this.nextRequestId++}`;
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      try {
        const request: RemoteCommandRequest = {
          id,
          command,
          args: args ?? null,
        };
        this.socket.send(JSON.stringify(request));
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  async listen<T>(channel: string, onEvent: (payload: T) => void): Promise<PanesUnlistenFn> {
    const listeners = this.channelListeners.get(channel) ?? new Set<(payload: unknown) => void>();
    listeners.add(onEvent as (payload: unknown) => void);
    this.channelListeners.set(channel, listeners);
    return () => {
      const current = this.channelListeners.get(channel);
      if (!current) {
        return;
      }
      current.delete(onEvent as (payload: unknown) => void);
      if (current.size === 0) {
        this.channelListeners.delete(channel);
      }
    };
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  private readonly handleOpen = () => {
    if (this.authToken) {
      this.sendAuthHandshake();
      return;
    }
    this.handleReady();
  };

  private readonly handleMessage = (event: MessageEvent<string>) => {
    if (typeof event.data !== "string") {
      return;
    }
    const message = parseRemoteInboundMessage(event.data);
    if (!message) {
      return;
    }
    if (isRemoteEventEnvelope(message)) {
      const listeners = this.channelListeners.get(message.channel);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        listener(message.payload);
      }
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      if (message.id === RemotePanesTransport.AUTH_REQUEST_ID) {
        if (message.ok) {
          this.handleReady();
          return;
        }
        const error = new Error(message.error);
        this.rejectReadyOnce(error);
        this.socket.close(4001, message.error);
      }
      return;
    }
    this.pendingRequests.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.error));
  };

  private readonly handleError = () => {
    const error = new Error(`Remote transport connection failed: ${this.url}`);
    this.rejectReadyOnce(error);
    this.rejectAllPending(error);
  };

  private readonly handleClose = (event: CloseEvent) => {
    const reason = event.reason || `${event.code || "unknown"}`;
    const error = buildCloseError(reason);
    this.rejectReadyOnce(error);
    this.rejectAllPending(error);
  };

  private handleReady(): void {
    if (this.readyResolved || this.readyRejected) {
      return;
    }
    this.readyResolved = true;
    this.resolveReady();
  }

  private rejectReadyOnce(error: Error): void {
    if (this.readyResolved || this.readyRejected) {
      return;
    }
    this.readyRejected = true;
    this.rejectReady(error);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private sendAuthHandshake(): void {
    const request: RemoteCommandRequest = {
      id: RemotePanesTransport.AUTH_REQUEST_ID,
      command: "authenticate_session",
      args: { token: this.authToken },
    };
    try {
      this.socket.send(JSON.stringify(request));
    } catch (error) {
      this.rejectReadyOnce(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export function createRemoteTransport(
  url: string,
  options?: RemotePanesTransportOptions,
): RemotePanesTransport {
  return new RemotePanesTransport(url, options);
}

export const remoteTransportInternals = {
  parseRemoteInboundMessage,
};
