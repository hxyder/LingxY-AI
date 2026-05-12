#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const roadmapPath = "docs/architecture/post-runtime-upgrade-roadmap.md";
assert(existsSync(path.join(root, roadmapPath)), "post-runtime roadmap missing");

const roadmap = read(roadmapPath);
const architectureReadme = read("docs/architecture/README.md");
const checkManifest = read("scripts/check-manifest.mjs");

for (const required of [
  "# Post Runtime Upgrade Roadmap",
  "Current Status Snapshot",
  "Tracking Register",
  "Program-Grounded Triage",
  "Phase B: Runtime Persistence, Trace Budgets, And Mode Model",
  "Phase C: Desktop Experience Completion",
  "Phase E: Generic Graph Resume, Reversibility, And True Sub-Agents",
  "Phase F: Multi-Model Execution",
  "Phase G: Plugin, Skill, MCP Marketplace",
  "Phase H: Privacy, Sandbox, Sidecars, And Release Hardening",
  "Recommended PR Order",
  "PX-001",
  "RT-001",
  "DX-001",
  "SA-001",
  "MM-001",
  "PM-001",
  "SH-001",
  "OQ-001"
]) {
  assert(roadmap.includes(required), `post-runtime roadmap missing required text: ${required}`);
}

for (const required of [
  "FRAMEWORK_GAP_ANALYSIS.md",
  "FUNCTION_AUDIT_AND_UPGRADE_PLAN.md",
  "not the authority",
  "current program"
]) {
  assert(roadmap.includes(required),
    `roadmap must explicitly demote root historical plan dependency: ${required}`);
}

for (const required of [
  "`npm run check:fast` passed",
  "`src/service/action_tools/tools/index.mjs`",
  "aggregator/re-export surface only",
  "desktop completeness",
  "context/trace",
  "plugin/MCP trust",
  "sandbox governance",
  "multi-model execution",
  "sub-agent runtime"
]) {
  assert(roadmap.includes(required), `roadmap current snapshot missing: ${required}`);
}

for (const required of [
  "docs/architecture/sqlite-write-path-budget.md",
  "node scripts/verify-sqlite-write-path-budget.mjs",
  "Current decision is to keep direct service-owned SQLite writes",
  "node scripts/verify-session-context-artifact-write-budget.mjs",
  "RT-001, RT-002, RT-003, and RT-004 are complete",
  "docs/architecture/context-trace-budget.md",
  "node scripts/verify-context-trace-budget.mjs",
  "compact task metadata is the canonical context trace storage",
  "docs/architecture/permission-mode-model.md",
  "node scripts/verify-permission-mode-model.mjs",
  "docs/architecture/window-session-state-machine.md",
  "node scripts/verify-window-session-state-machine.mjs",
  "Window owner state, preview stale-delta rejection, popup owner tracking",
  "This phase intentionally does not split more IPC handlers",
  "docs/architecture/desktop-ipc-boundaries.md",
  "node scripts/verify-desktop-ipc-boundaries.mjs",
  "`electron-main.mjs` is locked as lifecycle/composition only",
  "DX-003 Renderer runtime client consolidation",
  "node scripts/verify-renderer-runtime-client-consolidation.mjs",
  "runtime-submission-client",
  "runtime-user-memory-client",
  "runtime-preflight-client",
  "DX-004 Keyboard/a11y GUI pass",
  "Overlay task-list open/filter/Escape",
  "approval popup reject by keyboard",
  "No IPC channel names, HTTP routes, storage schema, tool ids, artifact kinds"
]) {
  assert(roadmap.includes(required), `roadmap runtime persistence status missing: ${required}`);
}

assert(architectureReadme.includes("[post-runtime-upgrade-roadmap.md](post-runtime-upgrade-roadmap.md)"),
  "architecture README must link post-runtime roadmap");
assert(checkManifest.includes("node scripts/verify-post-runtime-roadmap.mjs"),
  "check manifest must include post-runtime roadmap verifier");

console.log("[post-runtime-roadmap] roadmap tracking contract verified");
