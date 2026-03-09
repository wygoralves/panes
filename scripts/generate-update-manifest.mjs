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

import {
  buildStaticReleasePlatforms,
  resolveUpdaterAssetPairs,
} from "./lib/update-manifest.mjs";

const tag = process.argv[2] || process.env.RELEASE_TAG;
if (!tag) {
  console.error("Usage: generate-update-manifest.mjs <tag>");
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY || "wygoralves/panes";
const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "panes-update-manifest",
};
if (token) headers.Authorization = `Bearer ${token}`;

const apiBase = `https://api.github.com/repos/${repo}`;

async function fetchJSON(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return (await res.text()).trim();
}

// Fetch release metadata
const release = await fetchJSON(`${apiBase}/releases/tags/${tag}`);
const version = tag.replace(/^v/, "");
const pub_date = release.published_at;
const notes = release.body || "";

const assets = release.assets || [];
const resolvedAssetPairs = resolveUpdaterAssetPairs(assets);
const signatureByAssetName = {};

for (const assetPair of resolvedAssetPairs) {
  signatureByAssetName[assetPair.signature.name] = await fetchText(assetPair.signature.browser_download_url);
}

const platforms = buildStaticReleasePlatforms(resolvedAssetPairs, signatureByAssetName);

if (Object.keys(platforms).length === 0) {
  console.error("No updater-compatible assets found in release", tag);
  process.exit(1);
}

const manifest = { version, notes, pub_date, platforms };
writeFileSync("latest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Generated latest.json for ${tag} with platforms: ${Object.keys(platforms).join(", ")}`);
