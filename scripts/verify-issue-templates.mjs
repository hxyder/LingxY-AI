#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const templates = {
  ".github/ISSUE_TEMPLATE/bug_report.yml": [
    "name: Bug report",
    "labels:",
    "bug",
    "LingxY version or commit",
    "Windows version",
    "Steps to reproduce",
    "Expected behavior",
    "Actual behavior",
    "Redacted diagnostics",
    "SECURITY.md"
  ],
  ".github/ISSUE_TEMPLATE/feature_request.yml": [
    "name: Feature request",
    "enhancement",
    "User scenario",
    "Current workaround or pain",
    "Proposed behavior",
    "Product area",
    "Risks or constraints"
  ],
  ".github/ISSUE_TEMPLATE/config.yml": [
    "blank_issues_enabled: true"
  ]
};

for (const [relativePath, requiredPhrases] of Object.entries(templates)) {
  assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `missing ${relativePath}`);
  const text = read(relativePath);
  for (const phrase of requiredPhrases) {
    assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
      `${relativePath} missing required phrase: ${phrase}`);
  }
}

console.log("Issue template verification passed.");
