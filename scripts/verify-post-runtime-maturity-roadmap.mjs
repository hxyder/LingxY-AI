#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const roadmapPath = path.join(root, "docs/architecture/post-runtime-maturity-roadmap.md");

assert.ok(existsSync(roadmapPath), "post-runtime maturity roadmap missing");

const roadmap = readFileSync(roadmapPath, "utf8");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const architectureReadme = read("docs/architecture/README.md");

for (const required of [
  "# Post Runtime Maturity Roadmap",
  "Tracking Register",
  "MR-001 Memory review history and undo",
  "MR-002 Memory project scope and review filters",
  "SA-003 Planner-selected delegation enablement audit",
  "PM-004 Marketplace management UI",
  "SH-004 OS sandbox implementation decision",
  "DX-006 Desktop product acceptance matrix",
  "node scripts/verify-memory-review-history.mjs",
  "node scripts/verify-memory-scope-filters.mjs",
  "node scripts/verify-marketplace-management-ui.mjs",
  "node --test tests/behavior/user-memory-profile.test.mjs"
]) {
  assert.ok(roadmap.includes(required), `maturity roadmap missing required text: ${required}`);
}

assert.ok(
  architectureReadme.includes("[post-runtime-maturity-roadmap.md](post-runtime-maturity-roadmap.md)"),
  "architecture README must link post-runtime maturity roadmap"
);

const command = "node scripts/verify-post-runtime-maturity-roadmap.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include maturity roadmap verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include maturity roadmap verifier");

console.log("[post-runtime-maturity-roadmap] maturity roadmap tracking contract verified");
