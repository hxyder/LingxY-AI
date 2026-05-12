#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const ownerPath = "src/service/core/subagents/sub-agent-runtime-contract.mjs";
const testPath = "tests/behavior/sub-agent-runtime-contract.test.mjs";
const docPath = "docs/architecture/sub-agent-runtime-contract.md";

for (const rel of [ownerPath, testPath, docPath]) {
  assert.ok(existsSync(path.join(root, rel)), `missing SA-001 file: ${rel}`);
}

const owner = read(ownerPath);
const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
const tests = read(testPath);
const doc = read(docPath);
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");

for (const required of [
  "SUB_AGENT_RUNTIME_SCHEMA_VERSION",
  "SUB_AGENT_DELEGATION_SOURCES",
  "PLANNER_SELECTED",
  "isSubAgentRuntimeEnabled",
  "runtime?.featureFlags?.subAgentRuntime === true",
  "createSubAgentRunContract",
  "buildIsolatedSubAgentContext",
  "allowed_tool_ids",
  "parentAllowedToolIds",
  "sub-agent allowed tool escape",
  "createLinkedSubAgentCancellation",
  "parent_to_child",
  "validateSubAgentBudgetUsage",
  "tool_call_budget_exhausted",
  "buildSubAgentResultReport",
  "tool_surface_escape"
]) {
  assert.ok(owner.includes(required), `sub-agent contract owner missing: ${required}`);
}

assert.ok(
  runtimeServices.includes("createSubAgentRuntimeService")
    && runtimeServices.includes("runtime.subAgentRuntime ??= createSubAgentRuntimeService({ runtime })"),
  "runtime services must attach the service-owned sub-agent runtime contract service"
);

for (const required of [
  "disabled unless explicitly feature-flagged",
  "requires planner-selected delegation",
  "isolates context and allowed tools",
  "rejects tool-surface escape",
  "detects budget exhaustion",
  "propagates parent cancellation",
  "flags escaped tool calls",
  "runtime services attach"
]) {
  assert.ok(tests.includes(required), `sub-agent behavior test missing: ${required}`);
}

for (const required of [
  "Sub-Agent Runtime Contract",
  "disabled by default",
  "planner_selected",
  "assigned tool surface must be a subset",
  "isolated compiled context contains only assigned context item ids",
  "No automatic planner delegation",
  "No IPC or HTTP route changes"
]) {
  assert.ok(doc.includes(required), `sub-agent architecture doc missing: ${required}`);
}

for (const required of [
  "SA-001: Sub-Agent Runtime Contract",
  "service-owned child-run contract",
  "allowed tools",
  "budget",
  "cancellation",
  "node scripts/verify-sub-agent-runtime-contract.mjs"
]) {
  assert.ok(roadmap.includes(required), `roadmap missing SA-001 tracking text: ${required}`);
}

const command = "node scripts/verify-sub-agent-runtime-contract.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include SA-001 verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include SA-001 verifier");

console.log("[verify-sub-agent-runtime-contract] SA-001 sub-agent service contract OK");
