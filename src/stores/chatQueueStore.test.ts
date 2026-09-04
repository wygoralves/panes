import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QUEUE_ENTRY_TTL_MS,
  parsePersistedQueues,
  selectThreadQueue,
  useChatQueueStore,
  type QueuedMessage,
} from "./chatQueueStore";

const STORAGE_KEY = "panes:chat.queue";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

let storage = memoryStorage();

function enqueueText(threadId: string, text: string): QueuedMessage {
  return useChatQueueStore.getState().enqueue({ threadId, text });
}

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("localStorage", storage);
  useChatQueueStore.setState({ queuesByThread: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatQueueStore enqueue", () => {
  it("appends messages per thread and stamps an id and time", () => {
    const first = enqueueText("thread-1", "one");
    const second = enqueueText("thread-1", "two");
    enqueueText("thread-2", "other");

    expect(first.id).not.toBe(second.id);
    expect(typeof first.createdAt).toBe("number");
    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(2);
    expect(
      useChatQueueStore.getState().queuesByThread["thread-1"].map((item) => item.text),
    ).toEqual(["one", "two"]);
    expect(useChatQueueStore.getState().queuesByThread["thread-2"]).toHaveLength(1);
  });

  it("writes the queue to storage", () => {
    enqueueText("thread-1", "one");

    const stored = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored["thread-1"]).toHaveLength(1);
    expect(stored["thread-1"][0].text).toBe("one");
  });
});

describe("chatQueueStore peek", () => {
  it("returns the oldest message of a thread", () => {
    enqueueText("thread-1", "one");
    enqueueText("thread-1", "two");

    expect(useChatQueueStore.getState().peek("thread-1")?.text).toBe("one");
  });

  it("returns null for a thread with nothing queued", () => {
    expect(useChatQueueStore.getState().peek("thread-1")).toBeNull();
  });
});

describe("chatQueueStore remove", () => {
  it("drops one message and keeps the rest", () => {
    const first = enqueueText("thread-1", "one");
    enqueueText("thread-1", "two");

    useChatQueueStore.getState().remove("thread-1", first.id);

    expect(
      useChatQueueStore.getState().queuesByThread["thread-1"].map((item) => item.text),
    ).toEqual(["two"]);
  });

  it("drops the thread entry once its last message goes, in state and in storage", () => {
    const only = enqueueText("thread-1", "one");

    useChatQueueStore.getState().remove("thread-1", only.id);

    expect(useChatQueueStore.getState().queuesByThread).toEqual({});
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("ignores an unknown thread", () => {
    const before = useChatQueueStore.getState().queuesByThread;
    useChatQueueStore.getState().remove("thread-9", "missing");
    expect(useChatQueueStore.getState().queuesByThread).toBe(before);
  });
});

describe("chatQueueStore restoreFront", () => {
  it("puts a failed send back at the head of the queue", () => {
    const first = enqueueText("thread-1", "one");
    enqueueText("thread-1", "two");
    useChatQueueStore.getState().remove("thread-1", first.id);

    useChatQueueStore.getState().restoreFront(first);

    expect(
      useChatQueueStore.getState().queuesByThread["thread-1"].map((item) => item.text),
    ).toEqual(["one", "two"]);
  });

  it("does not duplicate a message that is still queued", () => {
    const first = enqueueText("thread-1", "one");

    useChatQueueStore.getState().restoreFront(first);

    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toHaveLength(1);
  });
});

describe("chatQueueStore clear", () => {
  it("empties one thread and leaves the others alone", () => {
    enqueueText("thread-1", "one");
    enqueueText("thread-2", "other");

    useChatQueueStore.getState().clear("thread-1");

    expect(useChatQueueStore.getState().queuesByThread["thread-1"]).toBeUndefined();
    expect(useChatQueueStore.getState().queuesByThread["thread-2"]).toHaveLength(1);
  });

  it("ignores a thread with nothing queued", () => {
    const before = useChatQueueStore.getState().queuesByThread;
    useChatQueueStore.getState().clear("thread-1");
    expect(useChatQueueStore.getState().queuesByThread).toBe(before);
  });
});

describe("selectThreadQueue", () => {
  it("returns a stable empty list without a thread", () => {
    const state = useChatQueueStore.getState();
    expect(selectThreadQueue(null)(state)).toEqual([]);
    expect(selectThreadQueue(null)(state)).toBe(selectThreadQueue("thread-1")(state));
  });
});

describe("parsePersistedQueues", () => {
  const now = 1_700_000_000_000;

  function stored(entries: Record<string, unknown[]>): string {
    return JSON.stringify(entries);
  }

  it("keeps entries queued within the last day", () => {
    const raw = stored({
      "thread-1": [
        { id: "a", threadId: "thread-1", text: "fresh", createdAt: now - 60_000 },
      ],
    });

    expect(parsePersistedQueues(raw, now)["thread-1"]).toHaveLength(1);
  });

  it("drops entries older than the day-long window", () => {
    const raw = stored({
      "thread-1": [
        { id: "a", threadId: "thread-1", text: "stale", createdAt: now - QUEUE_ENTRY_TTL_MS - 1 },
        { id: "b", threadId: "thread-1", text: "fresh", createdAt: now - 1_000 },
      ],
      "thread-2": [
        { id: "c", threadId: "thread-2", text: "stale", createdAt: now - QUEUE_ENTRY_TTL_MS },
      ],
    });

    const parsed = parsePersistedQueues(raw, now);

    expect(parsed["thread-1"].map((item) => item.text)).toEqual(["fresh"]);
    expect(parsed["thread-2"]).toBeUndefined();
  });

  it("drops entries that are missing fields or carry no timestamp", () => {
    const raw = stored({
      "thread-1": [
        { id: "a", threadId: "thread-1", createdAt: now },
        { threadId: "thread-1", text: "no id", createdAt: now },
        { id: "c", threadId: "thread-1", text: "no time" },
        null,
        "nope",
      ],
    });

    expect(parsePersistedQueues(raw, now)).toEqual({});
  });

  it("returns an empty map for missing, unreadable or wrongly shaped storage", () => {
    expect(parsePersistedQueues(null, now)).toEqual({});
    expect(parsePersistedQueues("", now)).toEqual({});
    expect(parsePersistedQueues("{not json", now)).toEqual({});
    expect(parsePersistedQueues("[]", now)).toEqual({});
    expect(parsePersistedQueues(stored({ "thread-1": [] }), now)).toEqual({});
  });
});
