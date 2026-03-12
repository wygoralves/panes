import { describe, expect, it } from "vitest";

import {
  buildStaticReleasePlatforms,
  resolveUpdaterAssetPairs,
} from "../scripts/lib/update-manifest.mjs";

describe("resolveUpdaterAssetPairs", () => {
  it("maps one universal macOS updater asset to both darwin targets", () => {
    const resolved = resolveUpdaterAssetPairs([
      {
        name: "Panes.app.tar.gz",
        browser_download_url: "https://example.com/Panes.app.tar.gz",
      },
      {
        name: "Panes.app.tar.gz.sig",
        browser_download_url: "https://example.com/Panes.app.tar.gz.sig",
      },
    ]);

    expect(
      buildStaticReleasePlatforms(resolved, {
        "Panes.app.tar.gz.sig": "mac-signature",
      }),
    ).toEqual({
      "darwin-aarch64": {
        signature: "mac-signature",
        url: "https://example.com/Panes.app.tar.gz",
      },
      "darwin-x86_64": {
        signature: "mac-signature",
        url: "https://example.com/Panes.app.tar.gz",
      },
    });
  });

  it("keeps Linux updater mapping unchanged", () => {
    const resolved = resolveUpdaterAssetPairs([
      {
        name: "Panes.AppImage",
        browser_download_url: "https://example.com/Panes.AppImage",
      },
      {
        name: "Panes.AppImage.sig",
        browser_download_url: "https://example.com/Panes.AppImage.sig",
      },
    ]);

    expect(
      buildStaticReleasePlatforms(resolved, {
        "Panes.AppImage.sig": "linux-signature",
      }),
    ).toEqual({
      "linux-x86_64": {
        signature: "linux-signature",
        url: "https://example.com/Panes.AppImage",
      },
    });
  });

  it("fails when multiple macOS updater bundles are present", () => {
    expect(() =>
      resolveUpdaterAssetPairs([
        { name: "Panes.app.tar.gz" },
        { name: "Panes_x64.app.tar.gz" },
        { name: "Panes.app.tar.gz.sig" },
      ]),
    ).toThrow("Expected exactly one macOS updater bundle asset");
  });

  it("fails when a macOS updater signature is missing", () => {
    expect(() =>
      resolveUpdaterAssetPairs([
        {
          name: "Panes.app.tar.gz",
          browser_download_url: "https://example.com/Panes.app.tar.gz",
        },
      ]),
    ).toThrow("Expected exactly one macOS updater bundle signature asset, found none.");
  });

  it("maps one Windows updater asset to windows-x86_64", () => {
    const resolved = resolveUpdaterAssetPairs([
      {
        name: "Panes_0.38.0_x64-setup.exe",
        browser_download_url: "https://example.com/Panes_0.38.0_x64-setup.exe",
      },
      {
        name: "Panes_0.38.0_x64-setup.exe.sig",
        browser_download_url: "https://example.com/Panes_0.38.0_x64-setup.exe.sig",
      },
    ]);

    expect(
      buildStaticReleasePlatforms(resolved, {
        "Panes_0.38.0_x64-setup.exe.sig": "windows-signature",
      }),
    ).toEqual({
      "windows-x86_64": {
        signature: "windows-signature",
        url: "https://example.com/Panes_0.38.0_x64-setup.exe",
      },
    });
  });
});
