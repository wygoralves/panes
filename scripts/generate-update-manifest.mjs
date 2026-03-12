#!/usr/bin/env node
/**
 * Generates latest.json for the Tauri updater from GitHub Release assets.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> node scripts/generate-update-manifest.mjs <tag>
 *
 * The tag (e.g. "v0.4.0") identifies the GitHub Release to pull assets from.
 * Outputs latest.json in the current working directory.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  buildStaticReleasePlatforms,
  resolveUpdaterAssetPairs,
} from "./lib/update-manifest.mjs";

const DEFAULT_REPO = "wygoralves/panes";

export function resolveReleaseTag(argv = process.argv, env = process.env) {
  return argv[2] || env.RELEASE_TAG || null;
}

function buildHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "panes-update-manifest",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJSON(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

async function fetchText(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return (await response.text()).trim();
}

export async function generateUpdateManifest({
  tag,
  repo = DEFAULT_REPO,
  token,
  fetchImpl = fetch,
}) {
  if (!tag) {
    throw new Error("Usage: generate-update-manifest.mjs <tag>");
  }

  const headers = buildHeaders(token);
  const apiBase = `https://api.github.com/repos/${repo}`;
  const release = await fetchJSON(fetchImpl, `${apiBase}/releases/tags/${tag}`, headers);
  const resolvedAssetPairs = resolveUpdaterAssetPairs(release.assets || []);
  const signatureByAssetName = {};

  for (const assetPair of resolvedAssetPairs) {
    signatureByAssetName[assetPair.signature.name] = await fetchText(
      fetchImpl,
      assetPair.signature.browser_download_url,
      headers,
    );
  }

  const platforms = buildStaticReleasePlatforms(resolvedAssetPairs, signatureByAssetName);
  if (Object.keys(platforms).length === 0) {
    throw new Error(`No updater-compatible assets found in release ${tag}`);
  }

  return {
    version: tag.replace(/^v/, ""),
    notes: release.body || "",
    pub_date: release.published_at,
    platforms,
  };
}

export async function main({
  argv = process.argv,
  env = process.env,
  fetchImpl = fetch,
  writeFile = writeFileSync,
} = {}) {
  const tag = resolveReleaseTag(argv, env);
  const manifest = await generateUpdateManifest({
    tag,
    repo: env.GITHUB_REPOSITORY || DEFAULT_REPO,
    token: env.GITHUB_TOKEN,
    fetchImpl,
  });

  writeFile("latest.json", JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

const isCliEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntrypoint) {
  try {
    const manifest = await main();
    console.log(
      `Generated latest.json for ${manifest.version} with platforms: ${Object.keys(
        manifest.platforms,
      ).join(", ")}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
