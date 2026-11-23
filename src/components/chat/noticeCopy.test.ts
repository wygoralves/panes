import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { noticeCopy } from "./noticeCopy";

const t = ((key: string) => `t:${key}`) as unknown as TFunction<"chat">;

describe("noticeCopy", () => {
  it("localizes the Claude sandbox-unavailable warning", () => {
    expect(
      noticeCopy(t, {
        kind: "claude_sandbox_unavailable",
        title: "OS sandbox unavailable",
        message: "English text from the sidecar",
      }),
    ).toEqual({
      title: "t:messageBlocks.notices.claudeSandboxUnavailable.title",
      message: "t:messageBlocks.notices.claudeSandboxUnavailable.message",
    });
  });

  it("keeps the engine's copy for other notices", () => {
    expect(
      noticeCopy(t, { kind: "claude_status", title: "Claude status", message: "Retrying" }),
    ).toEqual({ title: "Claude status", message: "Retrying" });
  });
});
