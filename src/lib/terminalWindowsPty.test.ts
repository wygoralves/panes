import { describe, expect, it } from "vitest";
import { readTerminalWindowsPty, resolveTerminalWindowsPty } from "./terminalWindowsPty";

function navigatorWithPlatformVersion(platformVersion: string | Error): Navigator {
  return {
    userAgentData: {
      getHighEntropyValues: () =>
        platformVersion instanceof Error
          ? Promise.reject(platformVersion)
          : Promise.resolve({ platformVersion }),
    },
  } as unknown as Navigator;
}

describe("resolveTerminalWindowsPty", () => {
  it("enables ConPTY reflow on Windows 11", () => {
    expect(resolveTerminalWindowsPty("15.0.0")).toEqual({ backend: "conpty", buildNumber: 22000 });
    expect(resolveTerminalWindowsPty("13.0.0")).toEqual({ backend: "conpty", buildNumber: 22000 });
  });

  it("leaves the build unknown on Windows 10 or when the version is missing", () => {
    expect(resolveTerminalWindowsPty("10.0.0")).toEqual({ backend: "conpty" });
    expect(resolveTerminalWindowsPty("")).toEqual({ backend: "conpty" });
    expect(resolveTerminalWindowsPty(undefined)).toEqual({ backend: "conpty" });
  });
});

describe("readTerminalWindowsPty", () => {
  it("reads the platform version from user agent client hints", async () => {
    await expect(readTerminalWindowsPty(navigatorWithPlatformVersion("14.0.0"))).resolves.toEqual({
      backend: "conpty",
      buildNumber: 22000,
    });
  });

  it("falls back to ConPTY without a build when client hints are unavailable", async () => {
    await expect(readTerminalWindowsPty({} as Navigator)).resolves.toEqual({ backend: "conpty" });
    await expect(
      readTerminalWindowsPty(navigatorWithPlatformVersion(new Error("denied"))),
    ).resolves.toEqual({ backend: "conpty" });
  });
});
