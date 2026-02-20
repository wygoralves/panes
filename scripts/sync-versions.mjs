#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-versions.mjs <version>");
  process.exit(1);
}

function updateCargoToml(nextVersion) {
  const cargoPath = join(root, "src-tauri", "Cargo.toml");
  const raw = readFileSync(cargoPath, "utf-8");
  const lines = raw.split(/\r?\n/);
  let insidePackageSection = false;
  let updated = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*\[package\]\s*$/.test(line)) {
      insidePackageSection = true;
      continue;
    }

    if (insidePackageSection && /^\s*\[/.test(line)) {
      insidePackageSection = false;
    }

    if (!insidePackageSection) {
      continue;
    }

    if (/^\s*version\s*=/.test(line)) {
      lines[index] = `version = "${nextVersion}"`;
      updated = true;
      break;
    }
  }

  if (!updated) {
    throw new Error("Could not update version in [package] section of src-tauri/Cargo.toml");
  }

  writeFileSync(cargoPath, lines.join("\n"));
  console.log(`  ✓ src-tauri/Cargo.toml -> ${nextVersion}`);
}

function updateTauriConfig(nextVersion) {
  const tauriConfigPath = join(root, "src-tauri", "tauri.conf.json");
  const raw = readFileSync(tauriConfigPath, "utf-8");
  const next = raw.replace(
    /("version"\s*:\s*")[^"]+(")/,
    `$1${nextVersion}$2`,
  );

  if (next === raw) {
    throw new Error("Could not update version in src-tauri/tauri.conf.json");
  }

  writeFileSync(tauriConfigPath, next);
  console.log(`  ✓ src-tauri/tauri.conf.json -> ${nextVersion}`);
}

updateCargoToml(version);
updateTauriConfig(version);
