#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const nodeBaseline = "22.12.0";
const engineRange = ">=22.12.0 <23";

assert.equal(read(".nvmrc").trim(), nodeBaseline, ".nvmrc must pin the local Node baseline");

const packageJson = JSON.parse(read("package.json"));
assert.equal(packageJson.engines?.node, engineRange, "package.json engines.node must match the supported Node 22 range");

for (const workflowPath of [
  ".github/workflows/repo-baseline.yml",
  ".github/workflows/release-gate.yml",
  ".github/workflows/release-artifacts.yml"
]) {
  assert.match(
    read(workflowPath),
    new RegExp(`node-version:\\s+"${nodeBaseline.replaceAll(".", "\\.")}"`, "u"),
    `${workflowPath} must use Node ${nodeBaseline}`
  );
}

assert.match(read("README.md"), /Node\.js 22\.12 or newer recommended/u,
  "README must document the Node baseline for local setup");
assert.match(read("docs/release/github_release_checklist.md"), /Node 22\.12\.0/u,
  "release checklist must document the CI Node baseline");

console.log("Node version baseline verification passed.");
