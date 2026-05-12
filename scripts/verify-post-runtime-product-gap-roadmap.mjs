#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const roadmapPath = path.join(root, "docs/architecture/post-runtime-product-gap-roadmap.md");

assert.ok(existsSync(roadmapPath), "post-runtime product gap roadmap missing");

const roadmap = readFileSync(roadmapPath, "utf8");
const architectureReadme = readFileSync(path.join(root, "docs/architecture/README.md"), "utf8");
const handoff = readFileSync(path.join(root, "docs/handoff/current-status.md"), "utf8");

for (const required of [
  "# Post Runtime Product Gap Roadmap",
  "Tracking Register",
  "PG-001 Product gap roadmap and verifier",
  "PG-001 Product gap roadmap and verifier | complete",
  "DXR-001 Desktop evidence pack runner",
  "DXR-001 Desktop evidence pack runner | complete",
  "DXR-002 Daily conversation/task/artifact GUI matrix",
  "DXR-002 Daily conversation/task/artifact GUI matrix | complete",
  "LAPI-001 Live provider acceptance harness",
  "CONN-001 Real connector/OAuth acceptance",
  "CAPM-001 Capability inventory manager",
  "CAPM-002 Capability creation lifecycle",
  "SBOX-001 High-risk sandbox evidence pack",
  "MMX-001 Model role management surface",
  "MMX-002 Budgeted fallback and cascade evidence",
  "CTX-001 Context selection and project packs",
  "REL-001 Release evidence bundle",
  "real API",
  "Electron GUI",
  "Office",
  "browser",
  "hardware",
  "packaged-build",
  "docs/release/desktop_product_acceptance_matrix.md",
  "docs/release/desktop_product_evidence_pack.md",
  "docs/architecture/desktop-gui-daily-workflow-coverage.md",
  "node scripts/verify-desktop-product-evidence-pack.mjs",
  "node scripts/verify-desktop-gui-daily-workflow-coverage.mjs",
  "FRAMEWORK_GAP_ANALYSIS.md",
  "FUNCTION_AUDIT_AND_UPGRADE_PLAN.md",
  "node scripts/verify-post-runtime-product-gap-roadmap.mjs",
  "npm run check:fast"
]) {
  assert.ok(roadmap.includes(required), `product gap roadmap missing required text: ${required}`);
}

assert.ok(
  architectureReadme.includes("[post-runtime-product-gap-roadmap.md](post-runtime-product-gap-roadmap.md)"),
  "architecture README must link post-runtime product gap roadmap"
);
assert.ok(
  handoff.includes("Post Runtime Product Gap Roadmap"),
  "handoff status must mention product gap roadmap"
);

const command = "node scripts/verify-post-runtime-product-gap-roadmap.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include product gap roadmap verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include product gap roadmap verifier");

console.log("[post-runtime-product-gap-roadmap] product gap roadmap tracking contract verified");
