#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_ACTION_TOOLS,
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  WRITE_FILE_TOOL
} from "../src/service/action_tools/tools/index.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-5F preflight verifier.
// Current state: write/edit/run are still index-owned. The physical move must
// update this verifier to require the capability owner and old inline absence.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const targetOwnerPath = "src/service/capabilities/tools/file-mutation-execution-tools.mjs";
const oldSplitOwnerPath = "src/service/action_tools/tools/file-mutation-execution-tools.mjs";
const boundaryPath = "docs/architecture/write-edit-run-tools-boundary.md";

assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, boundaryPath)), `write/edit/run boundary doc missing: ${boundaryPath}`);
assert(!existsSync(path.join(root, targetOwnerPath)),
  `CAP-5F preflight must not create target owner before the physical move: ${targetOwnerPath}`);
assert(!existsSync(path.join(root, oldSplitOwnerPath)),
  `old split owner must not exist: ${oldSplitOwnerPath}`);

const indexSrc = read(aggregatorPath);
for (const requiredText of [
  "export const WRITE_FILE_TOOL = {",
  "export const EDIT_FILE_TOOL = {",
  "export const RUN_SCRIPT_TOOL = {",
  "function decodeWriteFileContent",
  "const RUN_SCRIPT_LANGUAGES",
  "function clampTimeout",
  "async function spawnScript",
  "async function resolveEditableTargetForEdit",
  "resolveSandboxedTarget(outputDir, targetArg",
  "configuredWritableArtifactRoots(ctx)",
  "prepareFileReversibilityCheckpoint(ctx,",
  "toolId: \"write_file\"",
  "operation: args.overwrite ? \"overwrite_file\" : \"create_file\"",
  "toolId: \"edit_file\"",
  "operation: \"edit_file\"",
  "OUTLINE_KINDS.has(kind)",
  "writeDocumentPreviewSidecar",
  "writePdfFromHtmlArtifact",
  "windowsHide: true",
  "Math.min(20, Math.max(1, Math.floor(n)))",
  "artifactPaths: [absTarget]"
]) {
  assert(indexSrc.includes(requiredText), `index.mjs missing write/edit/run contract text: ${requiredText}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
const expected = [
  ["write_file", WRITE_FILE_TOOL, "medium", false, ["file_write"]],
  ["edit_file", EDIT_FILE_TOOL, "medium", false, ["file_write"]],
  ["run_script", RUN_SCRIPT_TOOL, "medium", false, ["subprocess_exec"]]
];
for (const [id, expectedTool, risk, requiresConfirmation, capabilities] of expected) {
  const tool = tools.get(id);
  assert(tool, `missing built-in tool ${id}`);
  assert.equal(tool, expectedTool, `${id} must still be aggregated from index.mjs during preflight`);
  assert.equal(tool.risk_level, risk, `${id} risk level changed`);
  assert.equal(tool.requires_confirmation, requiresConfirmation, `${id} confirmation gate changed`);
  assert.deepEqual(tool.required_capabilities ?? [], capabilities, `${id} required capabilities changed`);
  assert.equal(tool.parameters?.type, "object", `${id} schema must remain an object schema`);
}

const ids = BUILTIN_ACTION_TOOLS.map((tool) => tool.id);
assert.deepEqual(
  ids.slice(ids.indexOf("write_file"), ids.indexOf("run_script") + 1),
  ["write_file", "edit_file", "run_script"],
  "write/edit/run registry order changed"
);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
const toolSandbox = path.join(root, ".tmp", "verify-write-edit-run-tools");
await rm(toolSandbox, { recursive: true, force: true });
await mkdir(toolSandbox, { recursive: true });

const writeOk = await registry.call("write_file", {
  path: "notes/preflight.txt",
  content: "CAP-5F preflight"
}, { outputDir: toolSandbox, task: { task_id: "cap5f_preflight" } });
assert.equal(writeOk.success, true, "write_file must still write inside the task workspace");
assert.equal(writeOk.metadata?.tool_id, "write_file", "write_file metadata tool_id changed");
assert.ok(writeOk.artifact_paths?.[0], "write_file must return artifact path");
assert.ok(writeOk.metadata?.reversibility?.checkpoint_id,
  "write_file must expose file reversibility checkpoint metadata");

const writeDup = await registry.call("write_file", {
  path: "notes/preflight.txt",
  content: "should not overwrite"
}, { outputDir: toolSandbox, task: { task_id: "cap5f_preflight" } });
assert.equal(writeDup.success, false, "write_file must reject overwrite without overwrite:true");
assert.match(writeDup.observation, /overwrite:true/u, "write_file overwrite rejection observation changed");

const editOk = await registry.call("edit_file", {
  path: writeOk.artifact_paths[0],
  content: "CAP-5F edited",
  overwrite: true
}, { outputDir: toolSandbox, task: { task_id: "cap5f_preflight" } });
assert.equal(editOk.success, true, "edit_file must update an existing artifact in place");
assert.equal(editOk.metadata?.tool_id, "edit_file", "edit_file metadata tool_id changed");
assert.equal(editOk.artifact_paths?.[0], writeOk.artifact_paths[0],
  "edit_file must preserve the edited artifact path");
assert.ok(editOk.metadata?.reversibility?.checkpoint_id,
  "edit_file must expose file reversibility checkpoint metadata");

const runBadLang = await registry.call("run_script", {
  language: "ruby",
  script: "puts 'x'"
}, { outputDir: toolSandbox, task: { task_id: "cap5f_preflight" } });
assert.equal(runBadLang.success, false, "run_script must reject unsupported languages");
assert.match(runBadLang.observation, /powershell\/node\/python/u,
  "run_script language rejection observation changed");

const runNode = await registry.call("run_script", {
  language: "node",
  script: "console.log('cap5f preflight');",
  timeout: 5
}, { outputDir: toolSandbox, task: { task_id: "cap5f_preflight" } });
assert.equal(runNode.success, true, `run_script(node) must still execute; got ${runNode.observation}`);
assert.equal(runNode.metadata?.tool_id, "run_script", "run_script metadata tool_id changed");
assert.match(runNode.observation, /cap5f preflight/u, "run_script stdout observation changed");

const manifest = read("scripts/check-manifest.mjs");
for (const requiredCommand of [
  "node scripts/verify-file-reversibility-checkpoint.mjs",
  "node scripts/verify-approval-resume-state.mjs",
  "node scripts/verify-action-tool-registry-contract.mjs"
]) {
  assert(manifest.includes(requiredCommand),
    `check manifest must keep related gate: ${requiredCommand}`);
}

const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Write Edit Run Tools Boundary",
  "`src/service/action_tools/tools/index.mjs`",
  "`src/service/capabilities/tools/file-mutation-execution-tools.mjs`",
  "write_file",
  "edit_file",
  "run_script",
  "No-Touch Areas",
  "Preflight only"
]) {
  assert(boundaryDoc.includes(requiredText),
    `write/edit/run boundary doc missing required text: ${requiredText}`);
}

console.log("[write-edit-run-tools] preflight contract verified");
