#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repoRoot, ".github", "workflows", "codeql.yml");

assert.equal(existsSync(workflowPath), true, "missing .github/workflows/codeql.yml");

const workflow = readFileSync(workflowPath, "utf8");

for (const required of [
  "name: CodeQL",
  "pull_request:",
  "workflow_dispatch:",
  "contents: read",
  "actions: read",
  "security-events: write",
  "runs-on: windows-latest",
  "node-version: \"22.12.0\"",
  "javascript-typescript",
  "github/codeql-action/init@v3",
  "github/codeql-action/analyze@v3",
  "category: \"/language:${{ matrix.language }}\""
]) {
  assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    `CodeQL workflow missing required phrase: ${required}`);
}

assert.match(workflow, /cron:\s+"29 3 \* \* 1"/u, "CodeQL workflow must run on a weekly schedule");
assert.match(workflow, /^permissions:\r?\n  contents: read/mu,
  "CodeQL workflow must be read-only at the top level");
assert.match(workflow, /^  analyze:\r?\n[\s\S]*?^    permissions:\r?\n      actions: read\r?\n      contents: read\r?\n      security-events: write/mu,
  "CodeQL analyze job must declare the minimum upload permissions");
assert.doesNotMatch(workflow, /write-all|read-all/u,
  "CodeQL workflow must not use broad permission shortcuts");

console.log("CodeQL workflow verification passed.");
