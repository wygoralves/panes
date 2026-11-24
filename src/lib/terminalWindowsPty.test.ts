import { Terminal } from "@xterm/xterm";
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

  it("reports a pre-reflow ConPTY build on Windows 10 or when the version is missing", () => {
    for (const platformVersion of ["10.0.0", "", undefined]) {
      expect(resolveTerminalWindowsPty(platformVersion)).toEqual({
        backend: "conpty",
        buildNumber: 19045,
      });
    }
  });
});

describe("xterm with the resolved windowsPty", () => {
  async function rowsAfterWidening(platformVersion: string | undefined): Promise<string[]> {
    const terminal = new Terminal({
      cols: 5,
      rows: 4,
      windowsPty: resolveTerminalWindowsPty(platformVersion),
    });
    await new Promise<void>((resolve) => terminal.write("abcdefghij\r\n", resolve));
    terminal.resize(10, 4);
    const buffer = terminal.buffer.active;
    const rows = [0, 1].map((row) => buffer.getLine(row)?.translateToString(true) ?? "");
    terminal.dispose();
    return rows;
  }

  it("leaves wrapped rows to ConPTY on Windows 10", async () => {
    await expect(rowsAfterWidening("10.0.0")).resolves.toEqual(["abcde", "fghij"]);
  });

  it("reflows wrapped rows itself on Windows 11", async () => {
    await expect(rowsAfterWidening("15.0.0")).resolves.toEqual(["abcdefghij", ""]);
  });
});

describe("readTerminalWindowsPty", () => {
  it("reads the platform version from user agent client hints", async () => {
    await expect(readTerminalWindowsPty(navigatorWithPlatformVersion("14.0.0"))).resolves.toEqual({
      backend: "conpty",
      buildNumber: 22000,
    });
  });

  it("falls back to a pre-reflow ConPTY build when client hints are unavailable", async () => {
    const fallback = { backend: "conpty", buildNumber: 19045 };
    await expect(readTerminalWindowsPty({} as Navigator)).resolves.toEqual(fallback);
    await expect(
      readTerminalWindowsPty(navigatorWithPlatformVersion(new Error("denied"))),
    ).resolves.toEqual(fallback);
  });
});
