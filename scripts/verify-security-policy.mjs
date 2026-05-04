#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (relativePath) => path.join(repoRoot, relativePath);
const read = (relativePath) => readFileSync(repoPath(relativePath), "utf8");

function gitTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  }).split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/"));
}

for (const relativePath of ["SECURITY.md", ".github/dependabot.yml"]) {
  assert.equal(existsSync(repoPath(relativePath)), true, `missing security policy file: ${relativePath}`);
}

const tracked = new Set(gitTrackedFiles());
assert.equal(tracked.has("SECURITY.md"), true, "SECURITY.md must be tracked");
assert.equal(tracked.has(".github/dependabot.yml"), true, ".github/dependabot.yml must be tracked");

const security = read("SECURITY.md");
assert.match(security, /hxy94045@gmail\.com/u,
  "SECURITY.md must include the public security contact email");
const headings = new Set(
  security
    .split(/\r?\n/u)
    .map((line) => /^##\s+(.+?)\s*$/u.exec(line)?.[1]?.toLowerCase())
    .filter(Boolean)
);
for (const heading of [
  "reporting a vulnerability",
  "scope",
  "out of scope",
  "disclosure timeline",
  "supported versions"
]) {
  assert.equal(headings.has(heading), true, `SECURITY.md missing heading: ${heading}`);
}

const dependabot = read(".github/dependabot.yml");
assert.match(dependabot, /^version:\s*2\s*$/m, "dependabot.yml must declare version: 2");
for (const ecosystem of ["npm", "github-actions"]) {
  assert.match(dependabot, new RegExp(`package-ecosystem:\\s*["']?${ecosystem}["']?`, "m"),
    `dependabot.yml missing ${ecosystem} ecosystem`);
}
for (const dependency of ["electron", "unzipper", "uuid"]) {
  assert.match(dependabot, new RegExp(`dependency-name:\\s*["']?${dependency}["']?`, "m"),
    `dependabot.yml missing ignore for ${dependency}`);
}
assert.match(dependabot, /open-pull-requests-limit:\s*[1-5]\b/m,
  "dependabot.yml should cap open pull requests for maintainer load");

console.log("ok verify-security-policy");
