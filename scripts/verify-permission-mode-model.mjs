#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  buildPermissionModeContract,
  shouldBlockToolForExecutionMode,
  shouldPromptForToolApproval
} from "../src/shared/permission-mode-model.mjs";

const sharedModel = readFileSync("src/shared/permission-mode-model.mjs", "utf8");
const taskRecord = readFileSync("src/service/core/task-runtime/task-record.mjs", "utf8");
const eventEmitter = readFileSync("src/service/core/task-runtime/event-emitter.mjs", "utf8");
const actionSubmission = readFileSync("src/service/core/action-tool-submission.mjs", "utf8");
const confirmationGate = readFileSync("src/service/executors/tool_using/confirmation-gate.mjs", "utf8");
const agentLoop = readFileSync("src/service/executors/tool_using/agent-loop.mjs", "utf8");
const agenticToolExecution = readFileSync("src/service/executors/agentic/tool-execution.mjs", "utf8");
const consoleTaskDetail = readFileSync("src/desktop/renderer/console-task-detail.mjs", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const overlayJs = readFileSync("src/desktop/renderer/overlay.js", "utf8");
const docs = readFileSync("docs/architecture/permission-mode-model.md", "utf8");
const behavior = readFileSync("tests/behavior/permission-mode-model.test.mjs", "utf8");

assert.match(sharedModel, /buildPermissionModeContract/u, "shared mode contract builder must exist");
assert.match(sharedModel, /shouldPromptForToolApproval/u, "shared approval threshold helper must exist");
assert.match(sharedModel, /shouldBlockToolForExecutionMode/u, "shared unattended block helper must exist");
assert.match(taskRecord, /permission_mode_contract/u, "task record must persist permission mode contract");
assert.match(eventEmitter, /permission_mode/u, "task_created trace must carry permission mode");
assert.match(actionSubmission, /shouldPromptForToolApproval/u, "fast-path approval gate must use shared mode helper");
assert.match(confirmationGate, /shouldBlockToolForExecutionMode/u, "tool_using high-risk gate must use shared mode helper");
assert.match(agentLoop, /shouldPromptForToolApproval/u, "tool_using loop approval branch must use shared mode helper");
assert.match(agenticToolExecution, /shouldPromptForToolApproval/u, "agentic tool approval branch must use shared mode helper");
assert.match(agenticToolExecution, /shouldBlockToolForExecutionMode/u, "agentic unattended high-risk branch must use shared mode helper");
assert.match(consoleTaskDetail, /describeTaskMode/u, "console task detail renderer must expose mode display helper");
assert.match(consoleJs, /mode:\s*modeDisplay/u, "console task hero must render mode in the KV grid");
assert.match(overlayJs, /describePermissionModeContract/u, "overlay active task surface must render shared mode contract");
assert.match(docs, /RT-004 defines one shared contract/u, "architecture doc must describe RT-004 contract");
assert.match(behavior, /permission mode helpers preserve current approval semantics/u, "behavior tests must lock approval semantics");

const interactiveRisk = { risk_level: "high", requires_confirmation: true };
assert.equal(shouldPromptForToolApproval({ executionMode: "interactive", risk: interactiveRisk }), true);
assert.equal(shouldPromptForToolApproval({ executionMode: "unattended_safe", risk: interactiveRisk }), false);
assert.equal(shouldBlockToolForExecutionMode({ executionMode: "unattended_safe", risk: interactiveRisk }), true);

const localOnly = buildPermissionModeContract({
  executionMode: "interactive",
  privacyConfig: { privacy_sandbox: { mode: "local_only" } }
});
assert.equal(localOnly.user_visible.local_only, true);
assert.equal(localOnly.tool_surface.network_allowed, false);

const command = "node scripts/verify-permission-mode-model.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include permission mode verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include permission mode verifier");

console.log("[verify-permission-mode-model] RT-004 permission mode contract OK");
