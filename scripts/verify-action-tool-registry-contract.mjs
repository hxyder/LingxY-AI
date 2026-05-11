#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { ACTION_TOOL_RISK_LEVELS, createActionResult } from "../src/service/action_tools/types.mjs";
import { evaluateToolRisk } from "../src/service/action_tools/risk_matrix.mjs";
import {
  DEFAULT_RATE_LIMITS,
  applyPolicyGuard,
  getRateLimitUsage,
  resetRateLimits
} from "../src/service/action_tools/policy-guard.mjs";
import {
  applyFileReversibilityCheckpoint,
  collectFileReversibilityCheckpoints,
  prepareFileReversibilityCheckpoint
} from "../src/service/action_tools/file-reversibility.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-3 action-tool registry/type/risk/policy ownership preflight.
// This locks current behavior before the physical owner move.

const currentPaths = [
  "src/service/action_tools/registry.mjs",
  "src/service/action_tools/types.mjs",
  "src/service/action_tools/risk_matrix.mjs",
  "src/service/action_tools/policy-guard.mjs",
  "src/service/action_tools/file-reversibility.mjs"
];
for (const rel of currentPaths) {
  assert(existsSync(path.join(root, rel)), `current CAP-3 owner missing: ${rel}`);
}

const futureDir = "src/service/capabilities/registry";
assert(!existsSync(path.join(root, futureDir)),
  "CAP-3 preflight must not create the future registry owner before the physical move");

const expectedIds = [
  "open_url",
  "web_search",
  "compose_email",
  "send_email_smtp",
  "open_file",
  "reveal_in_explorer",
  "launch_app",
  "copy_to_clipboard",
  "notify",
  "file_op",
  "take_screenshot",
  "read_clipboard",
  "create_scheduled_task",
  "list_scheduled_tasks",
  "delete_scheduled_task",
  "pause_scheduled_task",
  "translate_text",
  "web_search_fetch",
  "fetch_url_content",
  "write_file",
  "edit_file",
  "run_script",
  "generate_document",
  "render_diagram",
  "render_svg",
  "list_files",
  "glob_files",
  "find_recent_files",
  "get_latest_artifact",
  "stat_file",
  "read_file_text",
  "read_folder_text",
  "search_file_content",
  "index_file_content",
  "verify_file_exists",
  "register_artifact",
  "resolve_output_path",
  "gui_find_element",
  "gui_click",
  "gui_type_text",
  "vision_analyze",
  "recall_memory",
  "list_recent_tasks",
  "get_task_detail",
  "list_conversation_artifacts",
  "draft_capability",
  "save_capability_draft",
  "preview_skill_from_github",
  "install_skill_from_github",
  "connector_catalog_search",
  "connector_catalog_get",
  "connector_workflow_run",
  "connector_plugin_manage",
  "account_list_connected_accounts",
  "account_list_emails",
  "account_list_events",
  "account_list_files",
  "account_download_file",
  "account_send_email",
  "account_upload_file",
  "account_create_event"
];

const expectedConfirmationIds = [
  "account_send_email",
  "create_scheduled_task",
  "delete_scheduled_task",
  "gui_click",
  "gui_type_text",
  "index_file_content",
  "install_skill_from_github",
  "save_capability_draft",
  "send_email_smtp"
];

assert.deepEqual(BUILTIN_ACTION_TOOLS.map((tool) => tool.id), expectedIds,
  "built-in action tool id order must remain stable");
assert.equal(BUILTIN_ACTION_TOOLS.length, 61, "built-in action tool count must remain 61");
assert(Object.isFrozen(BUILTIN_ACTION_TOOLS), "BUILTIN_ACTION_TOOLS must remain frozen");
assert.deepEqual(
  BUILTIN_ACTION_TOOLS.filter((tool) => tool.requires_confirmation).map((tool) => tool.id).sort(),
  expectedConfirmationIds,
  "confirmation-gated ids must remain stable"
);

assert.deepEqual(ACTION_TOOL_RISK_LEVELS, Object.freeze(["low", "medium", "high"]),
  "risk level constants must remain stable");
assert(Object.isFrozen(ACTION_TOOL_RISK_LEVELS), "ACTION_TOOL_RISK_LEVELS must remain frozen");
assert.deepEqual(
  createActionResult({ success: true, observation: "ok", artifactPaths: ["a"], metadata: { x: 1 } }),
  {
    success: true,
    observation: "ok",
    artifact_paths: ["a"],
    error: null,
    metadata: { x: 1 }
  },
  "createActionResult shape changed"
);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
assert.equal(registry.get("web_search")?.id, "web_search", "registry.get must return tools by id");
assert.equal(registry.get("missing_tool"), null, "registry.get must return null for missing tools");
assert.equal(registry.list().length, 61, "registry.list must expose 61 descriptors");
assert(!("execute" in registry.list()[0]), "registry.list must not expose execute functions");
assert.throws(() => registry.evaluate("missing_tool", {}, {}), /Unknown tool/u,
  "registry.evaluate must reject unknown tools");
await assert.rejects(() => registry.call("missing_tool", {}, {}), /Unknown tool/u,
  "registry.call must reject unknown tools");

let executed = 0;
const fakeRegistry = createActionToolRegistry([
  {
    id: "write_file",
    name: "Write",
    description: "fake",
    risk_level: "high",
    required_capabilities: ["file_write"],
    parameters: { type: "object", required: [] },
    async execute() {
      executed += 1;
      return createActionResult({ success: true, observation: "executed" });
    }
  }
]);
const blocked = await fakeRegistry.call("write_file", { path: "x" }, {
  task: {
    task_id: "task_policy",
    task_spec: {
      tool_policy: {
        write_file: { mode: "forbidden", reason: "test block" }
      }
    }
  },
  runtime: {}
});
assert.equal(executed, 0, "policy guard must block before tool.execute");
assert.equal(blocked.success, false, "policy guard must return action-result failure");
assert.equal(blocked.error, "blocked_by_policy", "policy block error must remain stable");
assert.equal(blocked.metadata.requires_user_permission, true,
  "policy block metadata must preserve user-permission signal");

const rateRuntime = {};
const rateTask = { task_id: "task_rate", task_spec: {} };
resetRateLimits(rateRuntime);
for (let i = 0; i < DEFAULT_RATE_LIMITS.write_file; i += 1) {
  const allowed = applyPolicyGuard("write_file", { path: `f${i}` }, { task: rateTask, runtime: rateRuntime });
  assert.equal(allowed.allowed, true, "write_file must remain allowed until rate limit is reached");
}
assert.equal(getRateLimitUsage(rateRuntime, "task_rate", "write_file"), DEFAULT_RATE_LIMITS.write_file,
  "rate-limit usage counter changed");
const limited = applyPolicyGuard("write_file", { path: "too-many" }, { task: rateTask, runtime: rateRuntime });
assert.equal(limited.allowed, false, "write_file must be blocked after default rate limit");
assert.equal(limited.result.error, "rate_limited", "rate-limit error must remain stable");

assert.equal(evaluateToolRisk(registry.get("send_email_smtp"), {}, {}).requires_confirmation, true,
  "send_email_smtp must remain confirmation-gated");
assert.equal(evaluateToolRisk(registry.get("open_url"), { url: "C:/Temp/a.exe" }, {}).requires_confirmation, true,
  "open_url executable targets must remain confirmation-gated");
assert.equal(evaluateToolRisk(registry.get("generate_document"), {}, {}).requires_confirmation, false,
  "generate_document must remain confirmation-free");

assert.equal(typeof prepareFileReversibilityCheckpoint, "function",
  "prepareFileReversibilityCheckpoint export missing");
assert.equal(typeof collectFileReversibilityCheckpoints, "function",
  "collectFileReversibilityCheckpoints export missing");
assert.equal(typeof applyFileReversibilityCheckpoint, "function",
  "applyFileReversibilityCheckpoint export missing");

for (const rel of currentPaths) {
  const src = read(rel);
  assert(!/from\s+["'][^"']*(?:src\/desktop|desktop\/|renderer\/|preload\/|electron)/u.test(src),
    `${rel} must not import Electron/desktop/renderer/preload modules`);
  assert(!/\b(?:BrowserWindow|ipcMain|ipcRenderer|contextBridge)\b/u.test(src),
    `${rel} must not reference Electron bridge/main APIs`);
}

const registrySrc = read("src/service/action_tools/registry.mjs");
assert(registrySrc.includes("evaluateToolRisk"), "registry must evaluate risk through risk_matrix");
assert(registrySrc.includes("applyPolicyGuard"), "registry.call must use applyPolicyGuard");
assert(registrySrc.includes("tool.execute(args, ctx)"), "registry.call execution behavior changed");

const boundaryPath = "docs/architecture/action-tool-registry-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "action tool registry boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const text of [
  "Action Tool Registry Boundary",
  "`src/service/action_tools/registry.mjs`",
  "`src/service/action_tools/types.mjs`",
  "`src/service/action_tools/risk_matrix.mjs`",
  "`src/service/action_tools/policy-guard.mjs`",
  "`src/service/action_tools/file-reversibility.mjs`",
  "`src/service/capabilities/registry/`",
  "Current State",
  "Public Contract",
  "No-Touch Areas",
  "Migration Shape"
]) {
  assert(boundaryDoc.includes(text), `boundary doc missing required text: ${text}`);
}

console.log("[action-tool-registry] contract preflight verified");
