import { describe, expect, it } from "vitest";
import {
  buildRemoteBrowserLink,
  buildRemoteConnectUrl,
  buildRemoteConnectionDetails,
  buildRemoteWebUrl,
  deriveRemoteConnectHost,
  parseRemoteBindAddr,
} from "./remoteConnection";

describe("remoteConnection", () => {
  it("parses IPv4 and bracketed IPv6 bind addresses", () => {
    expect(parseRemoteBindAddr("0.0.0.0:4050")).toEqual({
      host: "0.0.0.0",
      port: "4050",
      wildcard: true,
    });

    expect(parseRemoteBindAddr("[::1]:8080")).toEqual({
      host: "::1",
      port: "8080",
      wildcard: false,
    });
  });

  it("rejects invalid bind address shapes", () => {
    expect(parseRemoteBindAddr("4050")).toBeNull();
    expect(parseRemoteBindAddr("::1:4050")).toBeNull();
    expect(parseRemoteBindAddr("[::1]")).toBeNull();
    expect(parseRemoteBindAddr("localhost:not-a-port")).toBeNull();
  });

  it("derives a sensible connect host for wildcard listeners", () => {
    expect(deriveRemoteConnectHost("0.0.0.0:4050")).toBe("");
    expect(deriveRemoteConnectHost("[::]:4050")).toBe("");
    expect(deriveRemoteConnectHost("127.0.0.1:4050")).toBe("127.0.0.1");
    expect(deriveRemoteConnectHost("0.0.0.0:4050", "192.168.1.15")).toBe("192.168.1.15");
    expect(deriveRemoteConnectHost("127.0.0.1:4050", "192.168.1.15")).toBe("127.0.0.1");
  });

  it("builds websocket urls with explicit host overrides", () => {
    expect(buildRemoteConnectUrl("127.0.0.1:4050")).toBe("ws://127.0.0.1:4050");
    expect(buildRemoteConnectUrl("0.0.0.0:4050")).toBe("");
    expect(buildRemoteConnectUrl("0.0.0.0:4050", "panes.local")).toBe("ws://panes.local:4050");
    expect(buildRemoteConnectUrl("[::]:4050", "fe80::1")).toBe("ws://[fe80::1]:4050");
  });

  it("builds browser-facing urls and share links", () => {
    expect(buildRemoteWebUrl("0.0.0.0:4051")).toBe("");
    expect(buildRemoteWebUrl("0.0.0.0:4051", "192.168.1.15")).toBe(
      "http://192.168.1.15:4051/remote",
    );

    expect(
      buildRemoteBrowserLink("0.0.0.0:4051", "0.0.0.0:4050", "secret", "panes.local"),
    ).toBe(
      "http://panes.local:4051/remote#remoteUrl=ws%3A%2F%2Fpanes.local%3A4050&token=secret",
    );
  });

  it("builds copyable connection details", () => {
    expect(buildRemoteConnectionDetails("0.0.0.0:4050", "secret", "192.168.1.20")).toBe(
      "URL: ws://192.168.1.20:4050\nToken: secret",
    );
  });
});
