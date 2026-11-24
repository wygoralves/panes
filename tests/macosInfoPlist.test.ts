import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const infoPlist = readFileSync(new URL("../src-tauri/Info.plist", import.meta.url), "utf-8");

function usageString(key: string): string | undefined {
  const match = infoPlist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1];
}

describe("macOS Info.plist usage strings", () => {
  it("explains Apple Events consent as terminal and agent automation", () => {
    const appleEvents = usageString("NSAppleEventsUsageDescription");

    expect(appleEvents).toBeDefined();
    expect(appleEvents).not.toMatch(/lid-close|administrator/i);
    expect(appleEvents).toMatch(/another app/);
  });

  it("declares the device and network strings that terminal programs can trigger", () => {
    for (const key of [
      "NSMicrophoneUsageDescription",
      "NSCameraUsageDescription",
      "NSLocalNetworkUsageDescription",
    ]) {
      expect(usageString(key), key).toBeTruthy();
    }
  });
});
