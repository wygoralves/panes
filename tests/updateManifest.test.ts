import { describe, expect, it, vi } from "vitest";

import {
  buildStaticReleasePlatforms,
  resolveUpdaterAssetPairs,
} from "../scripts/lib/update-manifest.mjs";
import {
  generateUpdateManifest,
  main as generateUpdateManifestMain,
  resolveReleaseTag,
} from "../scripts/generate-update-manifest.mjs";

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

describe("generate-update-manifest", () => {
  it("prefers an explicit CLI tag over RELEASE_TAG", () => {
    expect(
      resolveReleaseTag(
        ["node", "scripts/generate-update-manifest.mjs", "v1.2.3"],
        { RELEASE_TAG: "v9.9.9" },
      ),
    ).toBe("v1.2.3");
  });

  it("builds the updater manifest from a GitHub release payload", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/releases/tags/v0.38.0")) {
        return {
          ok: true,
          json: async () => ({
            published_at: "2026-03-12T00:00:00.000Z",
            body: "Release notes",
            assets: [
              {
                name: "Panes_0.38.0_x64-setup.exe",
                browser_download_url: "https://example.com/Panes_0.38.0_x64-setup.exe",
              },
              {
                name: "Panes_0.38.0_x64-setup.exe.sig",
                browser_download_url: "https://example.com/Panes_0.38.0_x64-setup.exe.sig",
              },
            ],
          }),
        };
      }

      if (url === "https://example.com/Panes_0.38.0_x64-setup.exe.sig") {
        return {
          ok: true,
          text: async () => "windows-signature\n",
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    await expect(
      generateUpdateManifest({
        tag: "v0.38.0",
        repo: "owner/repo",
        token: "secret-token",
        fetchImpl,
      }),
    ).resolves.toEqual({
      version: "0.38.0",
      notes: "Release notes",
      pub_date: "2026-03-12T00:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "windows-signature",
          url: "https://example.com/Panes_0.38.0_x64-setup.exe",
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/releases/tags/v0.38.0",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("writes latest.json using RELEASE_TAG when no CLI tag is provided", async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/releases/tags/v0.38.0")) {
        return {
          ok: true,
          json: async () => ({
            published_at: "2026-03-12T00:00:00.000Z",
            body: "",
            assets: [
              {
                name: "Panes.AppImage",
                browser_download_url: "https://example.com/Panes.AppImage",
              },
              {
                name: "Panes.AppImage.sig",
                browser_download_url: "https://example.com/Panes.AppImage.sig",
              },
            ],
          }),
        };
      }

      if (url === "https://example.com/Panes.AppImage.sig") {
        return {
          ok: true,
          text: async () => "linux-signature\n",
        };
      }

      throw new Error(`unexpected URL: ${url}`);
    });

    const manifest = await generateUpdateManifestMain({
      argv: ["node", "scripts/generate-update-manifest.mjs"],
      env: {
        RELEASE_TAG: "v0.38.0",
        GITHUB_REPOSITORY: "owner/repo",
      },
      fetchImpl,
      writeFile: (path: string, contents: string) => {
        writes.push({ path, contents });
      },
    });

    expect(manifest.platforms).toEqual({
      "linux-x86_64": {
        signature: "linux-signature",
        url: "https://example.com/Panes.AppImage",
      },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("latest.json");
    expect(JSON.parse(writes[0]?.contents ?? "")).toEqual(manifest);
  });
});
