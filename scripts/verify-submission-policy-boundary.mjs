#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.join(repoRoot, "src", "service", "core");

const expectedSubmissionFiles = new Set([
  "action-tool-submission.mjs",
  "browser-submission.mjs",
  "composite-submission.mjs",
  "context-submission.mjs",
  "file-submission.mjs",
  "image-submission.mjs",
  "office-submission.mjs",
  "screenshot-submission.mjs"
]);

const files = readdirSync(coreDir)
  .filter((name) => name.endsWith("-submission.mjs"))
  .sort();

assert.deepEqual(
  new Set(files),
  expectedSubmissionFiles,
  "submission policy boundary audit must classify every core *-submission.mjs file"
);

const report = files.map((name) => {
  const relativePath = `src/service/core/${name}`;
  const source = readFileSync(path.join(coreDir, name), "utf8");
  return {
    file: relativePath,
    directPolicyGuard: /\bapplyPolicyGuard\b|\bpolicyGuard\b|\briskTier\b/.test(source),
    usesActionToolRegistry: /\bactionToolRegistry\b|\bcreateActionToolRegistry\b/.test(source),
    runsToolAgentLoop: /\brunToolAgentLoop\b/.test(source),
    submitsTaskWithConversation: /\bsubmitTaskWithConversation\b/.test(source),
    executorOverride: [...source.matchAll(/executorOverride:\s*"([^"]+)"/g)].map((match) => match[1])
  };
});

const directGuarded = report.filter((entry) => entry.directPolicyGuard);
assert.equal(
  directGuarded.length,
  0,
  "No core submission module currently calls applyPolicyGuard directly; update this audit if that boundary changes."
);

const actionTool = report.find((entry) => entry.file.endsWith("action-tool-submission.mjs"));
assert.equal(actionTool.usesActionToolRegistry, true);
assert.equal(actionTool.runsToolAgentLoop, true);
assert.ok(
  report.every((entry) => entry.submitsTaskWithConversation || entry.file.endsWith("screenshot-submission.mjs")),
  "submissions should funnel task records through submitTaskWithConversation unless explicitly classified"
);

console.log("Submission policy boundary audit passed.");
for (const entry of report) {
  const flags = [
    entry.directPolicyGuard ? "direct_guard" : "no_direct_guard",
    entry.usesActionToolRegistry ? "action_registry" : null,
    entry.runsToolAgentLoop ? "tool_loop" : null,
    entry.executorOverride.length ? `executor=${entry.executorOverride.join(",")}` : null
  ].filter(Boolean).join(" | ");
  console.log(`- ${entry.file}: ${flags}`);
}
