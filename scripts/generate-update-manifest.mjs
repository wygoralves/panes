#!/usr/bin/env node
/**
 * Generates latest.json for the Tauri updater from GitHub Release assets.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> node scripts/generate-update-manifest.mjs <tag>
 *
 * The tag (e.g. "v0.4.0") identifies the GitHub Release to pull assets from.
 * The release may still be a draft, so the token needs push access to see it.
 * Bundle URLs point at the public download path the release gets once it is
 * published. Outputs latest.json in the current working directory.
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
  const response = await fetchImpl(url, {
    headers: { ...headers, Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return (await response.text()).trim();
}

const RELEASES_PER_PAGE = 100;

// GET /releases/tags/{tag} never returns drafts, so list the releases and
// match the tag instead. Drafts are listed first.
async function findReleaseByTag(fetchImpl, apiBase, tag, headers) {
  for (let page = 1; ; page += 1) {
    const releases = await fetchJSON(
      fetchImpl,
      `${apiBase}/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      headers,
    );
    const release = releases.find((candidate) => candidate.tag_name === tag);
    if (release) {
      return release;
    }
    if (releases.length < RELEASES_PER_PAGE) {
      throw new Error(`No GitHub release found for tag ${tag}`);
    }
  }
}

export function publicAssetUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export async function generateUpdateManifest({
  tag,
  repo = DEFAULT_REPO,
  token,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  if (!tag) {
    throw new Error("Usage: generate-update-manifest.mjs <tag>");
  }

  const headers = buildHeaders(token);
  const apiBase = `https://api.github.com/repos/${repo}`;
  const release = await findReleaseByTag(fetchImpl, apiBase, tag, headers);
  const resolvedAssetPairs = resolveUpdaterAssetPairs(release.assets || []);
  const signatureByAssetName = {};

  for (const assetPair of resolvedAssetPairs) {
    // Draft browser URLs are not public; the asset API serves them to the token.
    signatureByAssetName[assetPair.signature.name] = await fetchText(
      fetchImpl,
      assetPair.signature.url,
      headers,
    );
  }

  const platforms = buildStaticReleasePlatforms(resolvedAssetPairs, signatureByAssetName, (asset) =>
    publicAssetUrl(repo, tag, asset.name),
  );

  return {
    version: tag.replace(/^v/, ""),
    notes: release.body || "",
    // A draft has no published_at yet.
    pub_date: release.published_at || now().toISOString(),
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
