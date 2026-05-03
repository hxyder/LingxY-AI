#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function gitTrackedFiles() {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return new Set(raw.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")));
}

const requiredPagesFiles = [
  "docs/public/README.md",
  "docs/public/index.html",
  "docs/public/privacy.html",
  "docs/public/terms.html"
];

const tracked = gitTrackedFiles();
for (const relativePath of requiredPagesFiles) {
  assert.equal(existsSync(repoPath(relativePath)), true, `missing GitHub Pages file: ${relativePath}`);
  assert.equal(tracked.has(relativePath), true, `GitHub Pages file is not tracked: ${relativePath}`);
}

const readme = readFileSync(repoPath("docs/public/README.md"), "utf8");
assert.match(readme, /GitHub Pages/u, "docs/public/README.md must describe GitHub Pages setup");
assert.match(readme, /OAuth consent screen/u, "docs/public/README.md must describe OAuth consent usage");

const privacy = readFileSync(repoPath("docs/public/privacy.html"), "utf8");
const terms = readFileSync(repoPath("docs/public/terms.html"), "utf8");
assert.match(privacy, /Google[-\s]+user[-\s]+data/iu,
  "privacy page must describe Google user data handling");
assert.match(terms, /Terms|Service/u,
  "terms page must be a terms-of-service document");

console.log("GitHub Pages readiness verification passed.");
