#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { renderHomebrewCask, resolveMacOsDmgAsset } from "./lib/homebrew-cask.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseArgs(argv) {
  const positionals = [];
  const options = {
    output: null,
    repo: process.env.GITHUB_REPOSITORY || "wygoralves/panes",
    template: join(root, "scripts", "templates", "homebrew-cask.rb.tpl"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--repo") {
      options.repo = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--template") {
      options.template = argv[index + 1];
      index += 1;
      continue;
    }

    positionals.push(arg);
  }

  const tag = positionals[0] || process.env.RELEASE_TAG;
  if (!tag) {
    throw new Error("Usage: generate-homebrew-cask.mjs <tag> [--output <path>] [--repo <owner/repo>] [--template <path>]");
  }

  if (!options.output) {
    options.output = join(root, "dist", "homebrew", "panes.rb");
  }

  return {
    output: resolve(options.output),
    repo: options.repo,
    tag,
    template: resolve(options.template),
  };
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "panes-homebrew-cask",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchJSON(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  return response.json();
}

async function sha256ForUrl(url, headers) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }

  const hash = createHash("sha256");
  const stream = Readable.fromWeb(response.body);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

const { output, repo, tag, template } = parseArgs(process.argv.slice(2));
const headers = githubHeaders();
const apiBase = `https://api.github.com/repos/${repo}`;

const release = await fetchJSON(`${apiBase}/releases/tags/${tag}`, headers);
const dmgAsset = resolveMacOsDmgAsset(release.assets || []);
const sha256 = await sha256ForUrl(dmgAsset.browser_download_url, headers);
const cask = renderHomebrewCask(readFileSync(template, "utf-8"), {
  version: tag.replace(/^v/, ""),
  sha256,
  url: dmgAsset.browser_download_url,
});

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, cask);
console.log(`Generated Homebrew cask for ${tag}: ${output}`);
