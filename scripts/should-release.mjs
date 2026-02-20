#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { execSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const outputValueOnly = args.has("--value");

const run = (command) => {
  try {
    return execSync(command, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
};

const writeGithubOutput = (shouldRelease, reason) => {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `should_release=${shouldRelease}\n`);
  appendFileSync(outputFile, `reason=${reason}\n`);
};

const finish = (shouldRelease, reason) => {
  writeGithubOutput(shouldRelease, reason);
  if (outputValueOnly) {
    process.stdout.write(shouldRelease ? "true\n" : "false\n");
    return;
  }
  process.stdout.write(`${shouldRelease ? "yes" : "no"}: ${reason}\n`);
};

const latestSubject = run("git log -1 --format=%s");
if (/^chore\(release\):/.test(latestSubject)) {
  finish(false, "latest commit is a release commit");
  process.exit(0);
}

const lastTag = run("git describe --tags --abbrev=0");
const hasTagHistory = Boolean(lastTag);
const range = hasTagHistory ? `${lastTag}..HEAD` : "HEAD";

const subjects = run(`git log ${range} --format=%s`);
const bodies = run(`git log ${range} --format=%b`);

if (!subjects && !bodies) {
  finish(false, hasTagHistory ? `no commits since ${lastTag}` : "no commits found");
  process.exit(0);
}

const hasMinorOrPatch = /^(feat|fix|perf)(\(.+\))?!?:/m.test(subjects);
const hasBreakingByBang = /^[a-z]+(\(.+\))?!:/m.test(subjects);
const hasBreakingFooter = /(^|[ \t])BREAKING[ -]CHANGE:/m.test(bodies);

if (hasMinorOrPatch || hasBreakingByBang || hasBreakingFooter) {
  const reason = hasTagHistory
    ? `release-worthy commits detected since ${lastTag}`
    : "release-worthy commits detected (initial release)";
  finish(true, reason);
  process.exit(0);
}

if (!hasTagHistory) {
  finish(false, "no release-worthy commits for initial release");
  process.exit(0);
}

finish(false, `no release-worthy commits since ${lastTag}`);
