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

assert.equal(existsSync(repoPath("CODE_OF_CONDUCT.md")), true, "missing CODE_OF_CONDUCT.md");

const tracked = new Set(gitTrackedFiles());
assert.equal(tracked.has("CODE_OF_CONDUCT.md"), true, "CODE_OF_CONDUCT.md must be tracked");

const codeOfConduct = read("CODE_OF_CONDUCT.md");
const headings = new Set(
  codeOfConduct
    .split(/\r?\n/u)
    .map((line) => /^##\s+(.+?)\s*$/u.exec(line)?.[1]?.toLowerCase())
    .filter(Boolean)
);

for (const heading of [
  "our pledge",
  "our standards",
  "enforcement responsibilities",
  "scope",
  "enforcement",
  "enforcement guidelines",
  "attribution"
]) {
  assert.equal(headings.has(heading), true, `CODE_OF_CONDUCT.md missing heading: ${heading}`);
}

assert.match(codeOfConduct, /Contributor Covenant version 2\.1/u,
  "CODE_OF_CONDUCT.md must retain Contributor Covenant attribution");
assert.match(codeOfConduct, /git log/u,
  "CODE_OF_CONDUCT.md must use the current maintainer contact convention");

console.log("ok verify-code-of-conduct");
