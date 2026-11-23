// Rewrites the version of one package in a Cargo.lock without touching any
// other line, so a release bump keeps the lockfile in step with Cargo.toml.
export function setCargoLockPackageVersion(raw, packageName, nextVersion) {
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const nameLine = `name = "${packageName}"`;
  let updated = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "[[package]]") {
      continue;
    }
    if (lines[index + 1]?.trim() !== nameLine) {
      continue;
    }
    if (!/^\s*version\s*=/.test(lines[index + 2] ?? "")) {
      break;
    }
    lines[index + 2] = `version = "${nextVersion}"`;
    updated = true;
    break;
  }

  if (!updated) {
    throw new Error(`Could not find package ${packageName} in Cargo.lock`);
  }

  return lines.join(newline);
}
