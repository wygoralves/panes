import type { IWindowsPty } from "@xterm/xterm";

// Windows 11 reports a User-Agent Client Hints platformVersion major of 13 or
// higher, and its first build is 22000. xterm only compares buildNumber with
// 21376 (the first ConPTY that reflows by itself), so these bounds are enough:
// every Windows 10 build is at or below 19045.
const WINDOWS_11_MIN_PLATFORM_MAJOR = 13;
const WINDOWS_11_FIRST_BUILD = 22000;
const WINDOWS_10_LAST_BUILD = 19045;

interface UserAgentDataWithHighEntropyValues {
  getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string }>;
}

/**
 * xterm `windowsPty` option for the inbox ConPTY. Without a known Windows 11
 * build, report a Windows 10 build so xterm turns its reflow off and lets
 * ConPTY repaint after a resize, which is the safe choice for older builds.
 * (xterm ignores the ConPTY threshold, and keeps reflowing, when buildNumber
 * is missing.)
 */
export function resolveTerminalWindowsPty(platformVersion: string | undefined): IWindowsPty {
  const major = Number.parseInt(platformVersion ?? "", 10);
  if (Number.isFinite(major) && major >= WINDOWS_11_MIN_PLATFORM_MAJOR) {
    return { backend: "conpty", buildNumber: WINDOWS_11_FIRST_BUILD };
  }
  return { backend: "conpty", buildNumber: WINDOWS_10_LAST_BUILD };
}

export async function readTerminalWindowsPty(
  nav: Navigator | undefined = globalThis.navigator,
): Promise<IWindowsPty> {
  const userAgentData = (nav as (Navigator & { userAgentData?: UserAgentDataWithHighEntropyValues }) | undefined)
    ?.userAgentData;
  if (!userAgentData || typeof userAgentData.getHighEntropyValues !== "function") {
    return resolveTerminalWindowsPty(undefined);
  }
  try {
    const { platformVersion } = await userAgentData.getHighEntropyValues(["platformVersion"]);
    return resolveTerminalWindowsPty(platformVersion);
  } catch {
    return resolveTerminalWindowsPty(undefined);
  }
}
