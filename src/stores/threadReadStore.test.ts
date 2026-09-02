import { beforeEach, describe, expect, it } from "vitest";
import {
  applyThreadUnread,
  applyThreadVisited,
  trimVisitMap,
  useThreadReadStore,
} from "./threadReadStore";

describe("applyThreadVisited", () => {
  it("records the first visit", () => {
    expect(applyThreadVisited({}, "thread-1", "2026-09-01T12:00:00.000Z")).toEqual({
      "thread-1": "2026-09-01T12:00:00.000Z",
    });
  });

  it("only ever moves the visit forward", () => {
    const visits = { "thread-1": "2026-09-01T12:00:00.000Z" };

    expect(applyThreadVisited(visits, "thread-1", "2026-09-01T11:00:00.000Z")).toBe(
      visits,
    );
    expect(
      applyThreadVisited(visits, "thread-1", "2026-09-01T13:00:00.000Z"),
    ).toEqual({ "thread-1": "2026-09-01T13:00:00.000Z" });
  });

  it("ignores an unparseable stamp", () => {
    const visits = {};
    expect(applyThreadVisited(visits, "thread-1", "not a date")).toBe(visits);
  });
});

describe("applyThreadUnread", () => {
  it("rewinds the visit to just before the completion", () => {
    expect(
      applyThreadUnread({}, "thread-1", "2026-09-01T12:00:00.000Z"),
    ).toEqual({ "thread-1": "2026-09-01T11:59:59.999Z" });
  });

  it("accepts a bare SQLite completion stamp", () => {
    expect(applyThreadUnread({}, "thread-1", "2026-09-01 12:00:00")).toEqual({
      "thread-1": "2026-09-01T11:59:59.999Z",
    });
  });

  it("does nothing without a completion", () => {
    const visits = { "thread-1": "2026-09-01T12:00:00.000Z" };
    expect(applyThreadUnread(visits, "thread-1", null)).toBe(visits);
    expect(applyThreadUnread(visits, "thread-1", "not a date")).toBe(visits);
  });
});

describe("trimVisitMap", () => {
  it("keeps the most recent visits", () => {
    const visits = {
      old: "2026-09-01T10:00:00.000Z",
      middle: "2026-09-01T11:00:00.000Z",
      recent: "2026-09-01T12:00:00.000Z",
    };

    expect(Object.keys(trimVisitMap(visits, 2)).sort()).toEqual(["middle", "recent"]);
  });
});

describe("threadReadStore", () => {
  beforeEach(() => {
    useThreadReadStore.setState({ lastVisitedAtByThread: {} });
  });

  it("marks a thread unread only when a completion stamp exists", () => {
    expect(
      useThreadReadStore.getState().markThreadUnread("thread-1", null),
    ).toBe(false);
    expect(
      useThreadReadStore
        .getState()
        .markThreadUnread("thread-1", "2026-09-01T12:00:00.000Z"),
    ).toBe(true);
    expect(useThreadReadStore.getState().lastVisitedAtByThread["thread-1"]).toBe(
      "2026-09-01T11:59:59.999Z",
    );
  });

  it("clears the unread state on the next visit", () => {
    useThreadReadStore
      .getState()
      .markThreadUnread("thread-1", "2026-09-01T12:00:00.000Z");
    useThreadReadStore
      .getState()
      .markThreadVisited("thread-1", "2026-09-01T12:05:00.000Z");

    expect(useThreadReadStore.getState().lastVisitedAtByThread["thread-1"]).toBe(
      "2026-09-01T12:05:00.000Z",
    );
  });
});
