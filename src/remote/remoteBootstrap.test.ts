import { describe, expect, it } from "vitest";
import {
  buildRemoteAttachCleanUrl,
  parseRemoteBootstrapState,
  REMOTE_ATTACH_PATH,
} from "./remoteBootstrap";

describe("remoteBootstrap", () => {
  it("parses remote bootstrap state from the current location", () => {
    expect(
      parseRemoteBootstrapState(
        {
          pathname: REMOTE_ATTACH_PATH,
          search: "",
          hash: "#remoteUrl=ws%3A%2F%2Fpanes.local%3A4050&token=secret",
        },
        "",
      ),
    ).toEqual({
      mode: "remote",
      url: "ws://panes.local:4050",
      token: "secret",
      autoConnect: true,
    });
  });

  it("falls back to the persisted url when the current location has no remote url", () => {
    expect(
      parseRemoteBootstrapState(
        {
          pathname: REMOTE_ATTACH_PATH,
          search: "",
          hash: "",
        },
        "ws://persisted:4050",
      ),
    ).toEqual({
      mode: "remote",
      url: "ws://persisted:4050",
      token: "",
      autoConnect: false,
    });
  });

  it("scrubs the bearer token and remote url from the browser location", () => {
    expect(
      buildRemoteAttachCleanUrl({
        pathname: "/",
        search: "?remote=1&foo=bar&token=secret",
        hash: "#remoteUrl=ws%3A%2F%2Fpanes.local%3A4050&debug=1",
      }),
    ).toBe("/remote?foo=bar#debug=1");
  });
});
