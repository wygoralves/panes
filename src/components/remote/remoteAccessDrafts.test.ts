import { describe, expect, it } from "vitest";
import {
  resolveRemoteAccessBindAddrDraft,
  resolveRemoteAccessConnectHostDraft,
} from "./remoteAccessDrafts";

describe("remoteAccessDrafts", () => {
  it("hydrates the bind draft from the running host when the user has not edited it", () => {
    expect(
      resolveRemoteAccessBindAddrDraft("127.0.0.1:4050", "0.0.0.0:4050", false),
    ).toBe("0.0.0.0:4050");
  });

  it("preserves the bind draft when the user has already edited it", () => {
    expect(
      resolveRemoteAccessBindAddrDraft("192.168.1.20:4050", "0.0.0.0:4050", true),
    ).toBe("192.168.1.20:4050");
  });

  it("keeps the last resolved bind draft when the host is stopped", () => {
    expect(resolveRemoteAccessBindAddrDraft("0.0.0.0:4050", null, false)).toBe("0.0.0.0:4050");
  });

  it("keeps wildcard hosts blank until the user enters an advertised IP or hostname", () => {
    expect(resolveRemoteAccessConnectHostDraft("127.0.0.1", "0.0.0.0:4050", false)).toBe("");
    expect(
      resolveRemoteAccessConnectHostDraft("192.168.1.15", "0.0.0.0:4050", true),
    ).toBe("192.168.1.15");
  });

  it("uses the bound host directly for non-wildcard listeners", () => {
    expect(resolveRemoteAccessConnectHostDraft("", "127.0.0.1:4050", false)).toBe(
      "127.0.0.1",
    );
  });
});
