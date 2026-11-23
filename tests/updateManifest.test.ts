import { readFileSync } from "node:fs";

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

type Asset = { name: string; url?: string; browser_download_url?: string };

// A draft release as GET /repos/{owner}/{repo}/releases lists it: the
// browser URLs carry an untagged-* path that only resolves once published,
// and published_at stays null until then.
const draftRelease = JSON.parse(
  readFileSync(new URL("./fixtures/github-draft-release.json", import.meta.url), "utf8"),
) as {
  tag_name: string;
  draft: boolean;
  body: string;
  published_at: string | null;
  assets: Array<Asset & { url: string }>;
};

const SIGNATURES = {
  "Panes.app.tar.gz.sig": "mac-signature",
  "Panes.AppImage.sig": "linux-signature",
  "Panes_0.42.0_amd64.deb.sig": "deb-signature",
  "Panes_0.42.0_x64-setup.exe.sig": "windows-signature",
};

function asset(name: string): Asset {
  return { name, browser_download_url: `https://example.com/${name}` };
}

function completeAssets(...omit: string[]): Asset[] {
  return [
    "Panes.app.tar.gz",
    "Panes.app.tar.gz.sig",
    "Panes.AppImage",
    "Panes.AppImage.sig",
    "Panes_0.42.0_amd64.deb",
    "Panes_0.42.0_amd64.deb.sig",
    "Panes_0.42.0_x64-setup.exe",
    "Panes_0.42.0_x64-setup.exe.sig",
  ]
    .filter((name) => !omit.includes(name))
    .map(asset);
}

function platformsFor(assets: Asset[]) {
  return buildStaticReleasePlatforms(
    resolveUpdaterAssetPairs(assets),
    SIGNATURES,
    (entry: Asset) => entry.browser_download_url,
  );
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

function textResponse(body: string) {
  return { ok: true, text: async () => body };
}

function draftReleaseFetch(releasePages: unknown[][]) {
  const signatureByApiUrl = new Map(
    draftRelease.assets
      .filter((entry) => entry.name.endsWith(".sig"))
      .map((entry) => [entry.url, `${entry.name}-contents\n`]),
  );

  return vi.fn(async (url: string, _init?: { headers?: Record<string, string> }) => {
    const page = /\/releases\?per_page=100&page=(\d+)$/.exec(url);
    if (page) {
      return jsonResponse(releasePages[Number(page[1]) - 1] ?? []);
    }

    const signature = signatureByApiUrl.get(url);
    if (signature !== undefined) {
      return textResponse(signature);
    }

    throw new Error(`unexpected URL: ${url}`);
  });
}

describe("resolveUpdaterAssetPairs", () => {
  it("maps one universal macOS updater asset to both darwin targets", () => {
    expect(platformsFor(completeAssets())).toMatchObject({
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

  it("maps AppImage to bundle-specific and compatibility Linux targets", () => {
    expect(platformsFor(completeAssets())).toMatchObject({
      "linux-x86_64-appimage": {
        signature: "linux-signature",
        url: "https://example.com/Panes.AppImage",
      },
      "linux-x86_64": {
        signature: "linux-signature",
        url: "https://example.com/Panes.AppImage",
      },
    });
  });

  it("maps Debian updater bundles to linux-x86_64-deb", () => {
    expect(platformsFor(completeAssets())).toMatchObject({
      "linux-x86_64-deb": {
        signature: "deb-signature",
        url: "https://example.com/Panes_0.42.0_amd64.deb",
      },
    });
  });

  it("maps one Windows updater asset to windows-x86_64", () => {
    expect(platformsFor(completeAssets())).toMatchObject({
      "windows-x86_64": {
        signature: "windows-signature",
        url: "https://example.com/Panes_0.42.0_x64-setup.exe",
      },
    });
  });

  it("covers every updater target when all four pairs are present", () => {
    expect(Object.keys(platformsFor(completeAssets())).sort()).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "windows-x86_64",
    ]);
  });

  it("fails when a whole platform is missing instead of dropping it", () => {
    expect(() =>
      resolveUpdaterAssetPairs(completeAssets("Panes.app.tar.gz", "Panes.app.tar.gz.sig")),
    ).toThrow("Expected exactly one macOS updater bundle asset, found none.");
    expect(() =>
      resolveUpdaterAssetPairs(
        completeAssets("Panes_0.42.0_x64-setup.exe", "Panes_0.42.0_x64-setup.exe.sig"),
      ),
    ).toThrow("Expected exactly one Windows updater bundle asset, found none.");
  });

  it("fails when multiple macOS updater bundles are present", () => {
    expect(() =>
      resolveUpdaterAssetPairs([...completeAssets(), asset("Panes_x64.app.tar.gz")]),
    ).toThrow("Expected exactly one macOS updater bundle asset");
  });

  it("fails when a macOS updater signature is missing", () => {
    expect(() => resolveUpdaterAssetPairs(completeAssets("Panes.app.tar.gz.sig"))).toThrow(
      "Expected exactly one macOS updater bundle signature asset, found none.",
    );
  });

  it("fails when a Debian updater signature is missing", () => {
    expect(() => resolveUpdaterAssetPairs(completeAssets("Panes_0.42.0_amd64.deb.sig"))).toThrow(
      "Expected exactly one Linux Debian updater bundle signature asset, found none.",
    );
  });

  it("fails when multiple Debian updater bundles are present", () => {
    expect(() =>
      resolveUpdaterAssetPairs([...completeAssets(), asset("Panes_0.42.0_amd64_copy.deb")]),
    ).toThrow("Expected exactly one Linux Debian updater bundle asset");
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

  it("builds the manifest from a draft release found through the release list", async () => {
    expect(draftRelease.draft).toBe(true);
    const fetchImpl = draftReleaseFetch([[{ tag_name: "v0.66.0", assets: [] }, draftRelease]]);

    const manifest = await generateUpdateManifest({
      tag: "v0.67.0",
      repo: "wygoralves/panes",
      token: "secret-token",
      fetchImpl,
      now: () => new Date("2026-11-23T05:00:00.000Z"),
    });

    const download = "https://github.com/wygoralves/panes/releases/download/v0.67.0";
    expect(manifest).toEqual({
      version: "0.67.0",
      notes: draftRelease.body,
      pub_date: "2026-11-23T05:00:00.000Z",
      platforms: {
        "darwin-aarch64": {
          signature: "Panes.app.tar.gz.sig-contents",
          url: `${download}/Panes.app.tar.gz`,
        },
        "darwin-x86_64": {
          signature: "Panes.app.tar.gz.sig-contents",
          url: `${download}/Panes.app.tar.gz`,
        },
        "linux-x86_64-appimage": {
          signature: "Panes_0.67.0_amd64.AppImage.sig-contents",
          url: `${download}/Panes_0.67.0_amd64.AppImage`,
        },
        "linux-x86_64": {
          signature: "Panes_0.67.0_amd64.AppImage.sig-contents",
          url: `${download}/Panes_0.67.0_amd64.AppImage`,
        },
        "linux-x86_64-deb": {
          signature: "Panes_0.67.0_amd64.deb.sig-contents",
          url: `${download}/Panes_0.67.0_amd64.deb`,
        },
        "windows-x86_64": {
          signature: "Panes_0.67.0_x64-setup.exe.sig-contents",
          url: `${download}/Panes_0.67.0_x64-setup.exe`,
        },
      },
    });

    const requestedUrls = fetchImpl.mock.calls.map(([url]) => url);
    expect(requestedUrls).not.toContainEqual(expect.stringContaining("/releases/tags/"));
    expect(requestedUrls).not.toContainEqual(expect.stringContaining("untagged-"));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/wygoralves/panes/releases/assets/543789930",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/octet-stream",
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("keeps the published date of a release that is already public", async () => {
    const published = {
      ...draftRelease,
      draft: false,
      published_at: "2026-11-23T06:00:00Z",
    };
    const manifest = await generateUpdateManifest({
      tag: "v0.67.0",
      repo: "wygoralves/panes",
      fetchImpl: draftReleaseFetch([[published]]),
    });

    expect(manifest.pub_date).toBe("2026-11-23T06:00:00Z");
  });

  it("pages through the release list until it finds the tag", async () => {
    const olderReleases = Array.from({ length: 100 }, (_, index) => ({
      tag_name: `v0.0.${index}`,
      assets: [],
    }));
    const fetchImpl = draftReleaseFetch([olderReleases, [draftRelease]]);

    const manifest = await generateUpdateManifest({
      tag: "v0.67.0",
      repo: "wygoralves/panes",
      fetchImpl,
    });

    expect(manifest.version).toBe("0.67.0");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/wygoralves/panes/releases?per_page=100&page=2",
      expect.anything(),
    );
  });

  it("fails when no release carries the tag", async () => {
    await expect(
      generateUpdateManifest({
        tag: "v9.9.9",
        repo: "wygoralves/panes",
        fetchImpl: draftReleaseFetch([[draftRelease]]),
      }),
    ).rejects.toThrow("No GitHub release found for tag v9.9.9");
  });

  it("fails when the draft is missing a platform's assets", async () => {
    const withoutWindows = {
      ...draftRelease,
      assets: draftRelease.assets.filter((entry) => !entry.name.includes("setup.exe")),
    };

    await expect(
      generateUpdateManifest({
        tag: "v0.67.0",
        repo: "wygoralves/panes",
        fetchImpl: draftReleaseFetch([[withoutWindows]]),
      }),
    ).rejects.toThrow("Expected exactly one Windows updater bundle asset, found none.");
  });

  it("writes latest.json using RELEASE_TAG when no CLI tag is provided", async () => {
    const writes: Array<{ path: string; contents: string }> = [];

    const manifest = await generateUpdateManifestMain({
      argv: ["node", "scripts/generate-update-manifest.mjs"],
      env: {
        RELEASE_TAG: "v0.67.0",
        GITHUB_REPOSITORY: "wygoralves/panes",
      },
      fetchImpl: draftReleaseFetch([[draftRelease]]),
      writeFile: (path: string, contents: string) => {
        writes.push({ path, contents });
      },
    });

    expect(Object.keys(manifest.platforms)).toHaveLength(6);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("latest.json");
    expect(JSON.parse(writes[0]?.contents ?? "")).toEqual(manifest);
  });
});
