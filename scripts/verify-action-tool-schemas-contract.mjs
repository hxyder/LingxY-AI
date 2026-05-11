#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ACTION_TOOL_SCHEMAS } from "../src/service/capabilities/schemas/index.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-2 action-tool schemas ownership verifier.
// This locks the moved schema owner and public contract.

const currentPath = "src/service/capabilities/schemas/index.mjs";
const oldPath = "src/service/action_tools/schemas/index.mjs";
assert(existsSync(path.join(root, currentPath)), `current schema owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, oldPath)),
  "ACTION_TOOL_SCHEMAS must not remain at the old action_tools/schemas owner path");

const schemaSrc = read(currentPath);
assert(schemaSrc.includes("export const ACTION_TOOL_SCHEMAS = Object.freeze({"),
  "schema owner must export ACTION_TOOL_SCHEMAS as a frozen object");
assert(!/\bimport\s/u.test(schemaSrc), "schema owner must remain import-free");
assert(!/from\s+["'][^"']*(desktop|renderer|electron|providers|registry|tools)\//u.test(schemaSrc),
  "schema owner must not depend on runtime/electron/provider/tool modules");
assert(!/(?:\bfetch\(|\b(?:spawn|execFile|writeFile|mkdir|rm|unlink)\s*\()/u.test(schemaSrc),
  "schema owner must not perform IO, process, or network work");

const schemaIds = Object.keys(ACTION_TOOL_SCHEMAS).sort();
const toolIds = BUILTIN_ACTION_TOOLS.map((tool) => tool.id).sort();
assert.equal(schemaIds.length, 61, "schema count changed");
assert.deepEqual(schemaIds, toolIds, "ACTION_TOOL_SCHEMAS keys must match BUILTIN_ACTION_TOOLS ids");

for (const id of [
  "take_screenshot",
  "gui_click",
  "gui_type_text",
  "generate_document",
  "render_diagram",
  "render_svg",
  "vision_analyze",
  "preview_skill_from_github",
  "install_skill_from_github",
  "account_send_email"
]) {
  const schema = ACTION_TOOL_SCHEMAS[id];
  assert.equal(schema?.type, "object", `${id} schema must remain an object`);
  assert(Array.isArray(schema.required), `${id} schema must expose required array`);
}

const boundaryPath = "docs/architecture/action-tool-schemas-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "action tool schemas boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Action Tool Schemas Boundary",
  "`src/service/capabilities/schemas/index.mjs`",
  "moved from `src/service/action_tools/schemas/index.mjs`",
  "Current schema count: 61",
  "No-Touch Areas",
  "Do not add compatibility barrels"
]) {
  assert(boundaryDoc.includes(requiredText),
    `action tool schemas boundary doc missing required text: ${requiredText}`);
}

console.log("[action-tool-schemas] contract verified");
