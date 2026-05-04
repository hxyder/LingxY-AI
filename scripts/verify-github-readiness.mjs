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
  return raw.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")).sort();
}

const requiredPublicFiles = [
  ".gitignore",
  ".github/dependabot.yml",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "package.json",
  "package-lock.json",
  "THIRD_PARTY_LICENSES.md",
  "docs/release/github_release_checklist.md"
];

for (const relativePath of requiredPublicFiles) {
  assert.equal(existsSync(repoPath(relativePath)), true, `missing GitHub readiness file: ${relativePath}`);
}

const tracked = gitTrackedFiles();
const trackedSet = new Set(tracked);

for (const relativePath of requiredPublicFiles) {
  assert.equal(trackedSet.has(relativePath), true, `GitHub readiness file is not tracked: ${relativePath}`);
}

const forbiddenTrackedPathRules = [
  [/^\.env(?:\.|$)/u, "environment files must not be tracked"],
  [/^\.claude\/settings\.local\.json$/u, "local Claude settings must not be tracked"],
  [/^internal\//u, "internal planning/audit files must not be tracked"],
  [/^phases\//u, "phase/task planning docs must live under local internal/ before public push"],
  [/^models\//u, "local model/enrollment data must not be tracked"],
  [/^(?:dist|build|coverage|node_modules)\//u, "generated build output/dependencies must not be tracked"],
  [/^(?:logs|artifacts|outputs|tmp|temp|\.tmp|\.cache)\//u, "runtime output must not be tracked"],
  [/^external\/paddle_ocr_runtime\/(?!README\.md$)/u, "Paddle OCR runtime binaries/models must not be tracked"],
  [/(^|\/)(?:config\.json|credentials?\.json|secrets?\.json|tokens?\.json)$/iu, "local config/credential JSON must not be tracked"],
  [/(^|\/)COMMIT_EDITMSG$/u, "git editor leftovers must not be tracked"]
];

const forbiddenTracked = [];
for (const file of tracked) {
  for (const [pattern, reason] of forbiddenTrackedPathRules) {
    if (pattern.test(file)) {
      forbiddenTracked.push(`${file} — ${reason}`);
      break;
    }
  }
}

assert.deepEqual(forbiddenTracked, [], `forbidden tracked files:\n${forbiddenTracked.join("\n")}`);

const secretPatterns = [
  ["OpenAI-style API key", /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gu],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/gu],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{20,}\b/gu],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ["Private key block", /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/gu]
];

const scanExclusions = new Set([
  "package-lock.json"
]);

const secretHits = [];
for (const file of tracked) {
  if (scanExclusions.has(file)) continue;
  const fullPath = repoPath(file);
  let buffer;
  try {
    buffer = readFileSync(fullPath);
  } catch {
    continue;
  }
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const line = text.slice(0, match.index).split(/\r?\n/u).length;
      secretHits.push(`${file}:${line} — ${label}`);
    }
  }
}

assert.deepEqual(secretHits, [], `potential secrets in tracked files:\n${secretHits.join("\n")}`);

const pkg = JSON.parse(readFileSync(repoPath("package.json"), "utf8"));
assert.equal(pkg.license, "MIT", "package.json license must match root LICENSE");

const warnings = [];
if (pkg.private !== true) {
  warnings.push("package.json private=true is recommended unless npm publication is intentional.");
}

const rootReviewMarkdown = tracked.filter((file) =>
  !file.includes("/")
  && /\.md$/iu.test(file)
  && ![
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "README.md",
    "SECURITY.md",
    "THIRD_PARTY_LICENSES.md",
    "LICENSE.md",
    "LICENCE.md"
  ].includes(file)
);
if (rootReviewMarkdown.length > 0) {
  warnings.push(`Tracked root Markdown docs need manual public review: ${rootReviewMarkdown.join(", ")}`);
}

console.log("GitHub readiness verification passed.");
if (warnings.length > 0) {
  console.log("Advisory warnings:");
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}
