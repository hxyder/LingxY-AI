#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP desktop capture / GUI verifier.
// This locks the moved owner and behavior contracts after extraction.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const ownerPath = "src/service/capabilities/tools/desktop-capture-gui-tools.mjs";
assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, ownerPath)), `desktop capture / GUI owner missing: ${ownerPath}`);

const indexSrc = read(aggregatorPath);
const ownerSrc = read(ownerPath);
for (const requiredText of [
  "export const TAKE_SCREENSHOT_TOOL",
  "export const GUI_FIND_ELEMENT_TOOL",
  "export const GUI_CLICK_TOOL",
  "export const GUI_TYPE_TEXT_TOOL",
  "function buildGuiFindScript",
  "async function runGuiPsScript",
  "scripts/capture-screenshot.ps1",
  "artifactPaths: [artifactPath]",
  "mime_type: \"image/png\"",
  "process.platform !== \"win32\""
]) {
  assert(ownerSrc.includes(requiredText), `desktop capture / GUI owner missing ${requiredText}`);
}
assert(indexSrc.includes("from \"../../capabilities/tools/desktop-capture-gui-tools.mjs\""),
  "index.mjs must import desktop capture / GUI tools from capabilities/tools/");
for (const movedTool of ["TAKE_SCREENSHOT_TOOL", "GUI_FIND_ELEMENT_TOOL", "GUI_CLICK_TOOL", "GUI_TYPE_TEXT_TOOL"]) {
  assert(!indexSrc.includes(`export const ${movedTool} = {`),
    `index.mjs must not redefine moved ${movedTool}`);
}

for (const schemaRef of [
  "ACTION_TOOL_SCHEMAS.take_screenshot",
  "ACTION_TOOL_SCHEMAS.gui_find_element",
  "ACTION_TOOL_SCHEMAS.gui_click",
  "ACTION_TOOL_SCHEMAS.gui_type_text"
]) {
  assert(ownerSrc.includes(schemaRef), `desktop capture / GUI schema ref missing ${schemaRef}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
const expected = [
  ["take_screenshot", "low", false, "screenshot"],
  ["gui_find_element", "low", false, "gui_automation"],
  ["gui_click", "high", true, "gui_automation"],
  ["gui_type_text", "high", true, "gui_automation"]
];
for (const [id, risk, requiresConfirmation, capability] of expected) {
  const tool = tools.get(id);
  assert(tool, `missing built-in tool ${id}`);
  assert.equal(tool.risk_level, risk, `${id} risk level changed`);
  assert.equal(tool.requires_confirmation, requiresConfirmation, `${id} confirmation gate changed`);
  assert(tool.required_capabilities?.includes(capability), `${id} missing ${capability} capability`);
  assert.equal(tool.parameters?.type, "object", `${id} schema must remain an object schema`);
}

const boundaryPath = "docs/architecture/desktop-capture-gui-tools-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "desktop capture / GUI boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Desktop Capture And GUI Tools Boundary",
  "`src/service/capabilities/tools/desktop-capture-gui-tools.mjs`",
  "take_screenshot",
  "gui_find_element",
  "gui_click",
  "gui_type_text",
  "No-Touch Areas"
]) {
  assert(boundaryDoc.includes(requiredText),
    `desktop capture / GUI boundary doc missing required text: ${requiredText}`);
}

console.log("[desktop-capture-gui-tools] contract verified");
