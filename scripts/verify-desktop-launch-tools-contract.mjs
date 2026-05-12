#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_ACTION_TOOLS,
  createLaunchAmbiguityResult,
  normalizeLaunchCandidates
} from "../src/service/action_tools/tools/index.mjs";
import {
  LAUNCH_APP_TOOL,
  createLaunchAmbiguityResult as createLaunchAmbiguityResultFromOwner,
  normalizeLaunchCandidates as normalizeLaunchCandidatesFromOwner
} from "../src/service/capabilities/tools/desktop-launch-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP desktop launch verifier.
// Post-move state: launch_app is owned by capabilities/tools and index.mjs only
// aggregates the tool plus re-exports public helpers for existing import sites.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const ownerPath = "src/service/capabilities/tools/desktop-launch-tools.mjs";
const oldOwnerPath = "src/service/action_tools/tools/desktop-launch-tools.mjs";
const pythonLauncherPath = "scripts/app_launcher/launcher.py";
const boundaryPath = "docs/architecture/desktop-launch-tools-boundary.md";

assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, ownerPath)), `desktop launch owner missing: ${ownerPath}`);
assert(existsSync(path.join(root, pythonLauncherPath)), `Python launcher script missing: ${pythonLauncherPath}`);
assert(existsSync(path.join(root, boundaryPath)), `desktop launch boundary doc missing: ${boundaryPath}`);
assert(!existsSync(path.join(root, oldOwnerPath)), `old desktop launch owner must not exist: ${oldOwnerPath}`);

const indexSrc = read(aggregatorPath);
const ownerSrc = read(ownerPath);
for (const requiredText of [
  "export const LAUNCH_APP_TOOL",
  "export function normalizeLaunchCandidates",
  "export function createLaunchAmbiguityResult",
  "const KNOWN_APPS",
  "function resolveAppCommand",
  "function hasKnownAppAlias",
  "function looksLikeExecutableTarget",
  "function stableLaunchCandidateId",
  "async function findPythonLauncherScript",
  "async function tryPythonLauncher",
  "async function resolveAppViaStartMenu",
  "scripts\", \"app_launcher\", \"launcher.py",
  "disambiguation_type: \"launch_app_candidate\"",
  "next_tool: \"launch_app\"",
  "Start-Process",
  "Get-StartApps",
  "spawn(command, [], { detached: true, stdio: \"ignore\" }).unref()"
]) {
  assert(ownerSrc.includes(requiredText), `desktop launch owner missing ${requiredText}`);
}
assert(indexSrc.includes("from \"../../capabilities/tools/desktop-launch-tools.mjs\""),
  "index.mjs must import/re-export desktop launch tools from capabilities/tools/");
for (const removedText of [
  "const KNOWN_APPS",
  "function resolveAppCommand",
  "function hasKnownAppAlias",
  "function looksLikeExecutableTarget",
  "function stableLaunchCandidateId",
  "async function findPythonLauncherScript",
  "async function tryPythonLauncher",
  "async function resolveAppViaStartMenu",
  "export const LAUNCH_APP_TOOL = {",
  "export function normalizeLaunchCandidates",
  "export function createLaunchAmbiguityResult",
  "\"scripts\", \"app_launcher\", \"launcher.py\""
]) {
  assert(!indexSrc.includes(removedText), `index.mjs must not retain old desktop launch owner text: ${removedText}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
const launchTool = tools.get("launch_app");
assert(launchTool, "missing built-in tool launch_app");
assert.equal(launchTool, LAUNCH_APP_TOOL, "BUILTIN_ACTION_TOOLS must aggregate the capability-owned launch tool");
assert.equal(launchTool.risk_level, "medium", "launch_app risk level changed");
assert.equal(launchTool.requires_confirmation, false, "launch_app confirmation gate changed");
assert(launchTool.required_capabilities?.includes("launch_app"), "launch_app missing launch_app capability");
assert.equal(launchTool.parameters?.type, "object", "launch_app schema must remain an object schema");

const normalized = normalizeLaunchCandidates([
  { display_name: "Alpha", app_id: "alpha.app", score: "0.7" }
]);
const normalizedFromOwner = normalizeLaunchCandidatesFromOwner([
  { display_name: "Alpha", app_id: "alpha.app", score: "0.7" }
]);
assert.deepEqual(normalized, normalizedFromOwner, "index re-export must match owner normalizeLaunchCandidates");
assert.equal(normalized.length, 1, "normalizeLaunchCandidates returned wrong candidate count");
assert.equal(normalized[0].display_name, "Alpha", "normalizeLaunchCandidates display_name changed");
assert.equal(normalized[0].app_id, "alpha.app", "normalizeLaunchCandidates app_id changed");
assert.equal(normalized[0].launch_args.app, "alpha.app", "normalizeLaunchCandidates launch target changed");
assert.equal(normalized[0].score, 0.7, "normalizeLaunchCandidates score normalization changed");
assert.match(normalized[0].candidate_id, /^[a-f0-9]{12}$/, "candidate_id shape changed");

const ambiguity = createLaunchAmbiguityResult("Alpha", normalized, {
  method: "python_launcher",
  decision_reason: "multiple_candidates"
});
const ambiguityFromOwner = createLaunchAmbiguityResultFromOwner("Alpha", normalized, {
  method: "python_launcher",
  decision_reason: "multiple_candidates"
});
assert.deepEqual(ambiguity, ambiguityFromOwner, "index re-export must match owner createLaunchAmbiguityResult");
assert.equal(ambiguity.success, false, "ambiguity result must remain unsuccessful");
assert.equal(ambiguity.metadata?.disambiguation_type, "launch_app_candidate",
  "ambiguity metadata type changed");
assert.equal(ambiguity.metadata?.next_tool, "launch_app", "ambiguity next tool changed");
assert.equal(ambiguity.metadata?.candidate_count, 1, "ambiguity candidate count changed");
assert.equal(ambiguity.metadata?.decision_reason, "multiple_candidates",
  "ambiguity decision reason changed");
assert.match(ambiguity.observation, /Alpha/, "ambiguity observation must mention target app");

const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Desktop Launch Tools Boundary",
  "`src/service/capabilities/tools/desktop-launch-tools.mjs`",
  "launch_app",
  "scripts/app_launcher/launcher.py",
  "No-Touch Areas",
  "Moved"
]) {
  assert(boundaryDoc.includes(requiredText),
    `desktop launch boundary doc missing required text: ${requiredText}`);
}

console.log("[desktop-launch-tools] contract verified");
