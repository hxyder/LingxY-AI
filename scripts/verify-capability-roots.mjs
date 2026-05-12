#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[capability-roots] ${message}`);
  process.exitCode = 1;
}

// Phase CAP-0: capability directory inventory verifier
// Documents current capability roots; no product source moves.

const capabilityRoots = [
  // Action tools
  "src/service/action_tools/tools/index.mjs",
  "src/service/capabilities/schemas/index.mjs",
  "src/service/capabilities/registry/registry.mjs",
  "src/service/capabilities/registry/types.mjs",
  "src/service/capabilities/registry/risk_matrix.mjs",
  "src/service/capabilities/registry/policy-guard.mjs",
  "src/service/capabilities/tools/file-reversibility.mjs",
  // Skills
  "src/service/capabilities/skills/lifecycle.mjs",
  // MCP
  "src/service/capabilities/mcp",
  // Connectors
  "src/service/capabilities/connectors",
  // Providers
  "src/service/capabilities/providers",
  // Code CLI adapters
  "src/service/capabilities/code_cli",
  // Extracted tool families and capability-owned helpers
  "src/service/capabilities/tools/browser-web-tools.mjs",
  "src/service/capabilities/tools/os-app-tools.mjs",
  "src/service/capabilities/tools/scheduler-tools.mjs",
  "src/service/capabilities/tools/file-read-tools.mjs",
  "src/service/capabilities/tools/email-tools.mjs",
  "src/service/capabilities/tools/vision-analyze.mjs",
  "src/service/capabilities/tools/memory-tools.mjs",
  "src/service/capabilities/tools/skill-install-tools.mjs",
  "src/service/capabilities/tools/document-renderer.mjs",
  "src/service/capabilities/tools/svg-sanitize.mjs",
  "src/service/capabilities/tools/mermaid-assets.mjs",
  "src/service/capabilities/tools/open-with-default-handler.mjs",
  "src/service/capabilities/tools/file-manifest-helpers.mjs",
];

// ── 1. All current capability roots must exist ──
for (const rel of capabilityRoots) {
  const full = path.join(root, rel);
  assert(existsSync(full), `capability root missing: ${rel}`);
}

// ── 2. No user-installed capabilities under src/ ──
// Check that runtime data paths are not under src/
const userDataPaths = [
  path.join(root, "src", "user-skills"),
  path.join(root, "src", "user-mcp"),
  path.join(root, "src", "user-tools"),
  path.join(root, "src", "user-connectors"),
];
for (const p of userDataPaths) {
  assert(!existsSync(p), `user-installed capability path must not exist under src/: ${path.relative(root, p)}`);
}

// ── 3. Capability directory architecture doc exists ──
const docPath = "docs/architecture/capability-directory-architecture.md";
assert(existsSync(path.join(root, docPath)), "capability directory architecture doc missing");
const doc = read(docPath);
assert(doc.includes("Capability Directory Architecture"), "capability arch doc missing title");
assert(doc.includes("Current Capability Roots"), "capability arch doc must inventory current roots");
assert(doc.includes("Target Architecture"), "capability arch doc must describe target layout");
assert(doc.includes("Migration Rules"), "capability arch doc must define migration rules");
assert(doc.includes("Migration Sequence"), "capability arch doc must list migration sequence");
assert(doc.includes("src/service/capabilities/schemas/index.mjs"),
  "capability arch doc must list moved schema owner");

// ── 4. Legacy compatibility rule: no parallel implementations ──
// Extracted tool families must NOT have their tool bodies in both the
// extracted module AND index.mjs
const indexSrc = read("src/service/action_tools/tools/index.mjs");
for (const tool of [
  "OPEN_URL_TOOL", "WEB_SEARCH_TOOL", "TRANSLATE_TEXT_TOOL",
  "WEB_SEARCH_FETCH_TOOL", "FETCH_URL_CONTENT_TOOL",
  "OPEN_FILE_TOOL", "REVEAL_IN_EXPLORER_TOOL", "FILE_OP_TOOL",
  "COPY_TO_CLIPBOARD_TOOL", "NOTIFY_TOOL", "COMPOSE_EMAIL_TOOL",
  "CREATE_SCHEDULED_TASK_TOOL", "LIST_SCHEDULED_TASKS_TOOL",
  "DELETE_SCHEDULED_TASK_TOOL", "PAUSE_SCHEDULED_TASK_TOOL",
  "STAT_FILE_TOOL", "VERIFY_FILE_EXISTS_TOOL",
  "LIST_FILES_TOOL", "GLOB_FILES_TOOL", "FIND_RECENT_FILES_TOOL",
  "GET_LATEST_ARTIFACT_TOOL"
]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine extracted ${tool} (parallel implementation)`);
}

if (!process.exitCode) {
  console.log("[capability-roots] capability directory roots verified");
}
