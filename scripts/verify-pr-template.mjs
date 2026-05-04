#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(repoRoot, ".github", "PULL_REQUEST_TEMPLATE.md");

assert.equal(existsSync(templatePath), true, "missing .github/PULL_REQUEST_TEMPLATE.md");

const template = readFileSync(templatePath, "utf8");
const headings = new Set(
  template
    .split(/\r?\n/u)
    .map((line) => /^##\s+(.+?)\s*$/u.exec(line)?.[1]?.toLowerCase())
    .filter(Boolean)
);

for (const heading of [
  "summary",
  "change type",
  "verification",
  "contributor checklist",
  "notes for reviewers"
]) {
  assert.equal(headings.has(heading), true, `PR template missing heading: ${heading}`);
}

for (const requiredPhrase of [
  "npm run check",
  "Targeted verifier or behavior test",
  "did not weaken existing verifiers",
  "license-compatible",
  "Code of Conduct"
]) {
  assert.match(template, new RegExp(requiredPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    `PR template missing required phrase: ${requiredPhrase}`);
}

console.log("PR template verification passed.");
