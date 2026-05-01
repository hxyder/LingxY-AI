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

const expectedClassifications = Object.freeze({
  "action-tool-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: true,
    usesSecurityBroker: true,
    runsToolAgentLoop: true,
    submitsTaskWithConversation: true,
    submissionKind: ["action_tool"],
    executorOverride: ["tool_using"]
  },
  "browser-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: true,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: [],
    executorOverride: []
  },
  "composite-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: false,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: [],
    executorOverride: ["composite"]
  },
  "context-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: true,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: ["context"],
    executorOverride: []
  },
  "file-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: true,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: ["file"],
    executorOverride: []
  },
  "image-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: true,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: ["image"],
    executorOverride: ["tool_using"]
  },
  "office-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: true,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: true,
    submissionKind: ["office"],
    executorOverride: []
  },
  "screenshot-submission.mjs": {
    directPolicyGuard: false,
    usesActionToolRegistry: false,
    usesSecurityBroker: false,
    runsToolAgentLoop: false,
    submitsTaskWithConversation: false,
    submissionKind: [],
    executorOverride: []
  }
});

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
    usesSecurityBroker: /\bsecurityBroker\b|\binspectContext\b/.test(source),
    runsToolAgentLoop: /\brunToolAgentLoop\b/.test(source),
    submitsTaskWithConversation: /\bsubmitTaskWithConversation\b/.test(source),
    submissionKind: [...source.matchAll(/submissionKind:\s*"([^"]+)"/g)].map((match) => match[1]),
    executorOverride: [...source.matchAll(/executorOverride:\s*"([^"]+)"/g)].map((match) => match[1])
  };
});

for (const entry of report) {
  const name = path.basename(entry.file);
  const expected = expectedClassifications[name];
  assert.ok(expected, `${entry.file} must have an explicit submission boundary classification`);
  for (const key of [
    "directPolicyGuard",
    "usesActionToolRegistry",
    "usesSecurityBroker",
    "runsToolAgentLoop",
    "submitsTaskWithConversation"
  ]) {
    assert.equal(entry[key], expected[key], `${entry.file} classification drifted for ${key}`);
  }
  assert.deepEqual(
    entry.submissionKind,
    expected.submissionKind,
    `${entry.file} submissionKind classification drifted`
  );
  assert.deepEqual(
    entry.executorOverride,
    expected.executorOverride,
    `${entry.file} executor override classification drifted`
  );
}

console.log("Submission policy boundary audit passed.");
for (const entry of report) {
  const flags = [
    entry.directPolicyGuard ? "direct_guard" : "no_direct_guard",
    entry.usesActionToolRegistry ? "action_registry" : null,
    entry.usesSecurityBroker ? "security_broker" : null,
    entry.runsToolAgentLoop ? "tool_loop" : null,
    entry.submissionKind.length ? `submission=${entry.submissionKind.join(",")}` : null,
    entry.executorOverride.length ? `executor=${entry.executorOverride.join(",")}` : null
  ].filter(Boolean).join(" | ");
  console.log(`- ${entry.file}: ${flags}`);
}
