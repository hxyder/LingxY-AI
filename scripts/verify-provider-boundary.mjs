#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[provider-boundary] ${message}`);
  process.exitCode = 1;
}

// Phase 2G.1: provider boundary inventory and verifier lock

// ── 1. Provider adapter exists and exports the factory ──
const adapterPath = "src/service/executors/agentic/provider-adapter.mjs";
assert(existsSync(path.join(root, adapterPath)), `provider adapter missing: ${adapterPath}`);
const adapterSrc = read(adapterPath);
assert(adapterSrc.includes("export function createProviderAdapter"),
  "provider-adapter.mjs must export createProviderAdapter");

// ── 2. Provider resolver exists ──
const resolverPath = "src/service/executors/shared/provider-resolver.mjs";
assert(existsSync(path.join(root, resolverPath)), `provider resolver missing: ${resolverPath}`);
const resolverSrc = read(resolverPath);
assert(resolverSrc.includes("resolveProviderForTask"),
  "provider-resolver.mjs must export resolveProviderForTask");
assert(resolverSrc.includes("describeResolvedProvider"),
  "provider-resolver.mjs must export describeResolvedProvider");

// ── 3. All approved provider resolver call sites ──
const approvedResolverCallers = new Set([
  "src/service/executors/fast/fast-executor.mjs",
  "src/service/executors/tool_using/agent-loop.mjs",
  "src/service/executors/tool_using/final-composer.mjs",
  "src/service/executors/agentic/planner.mjs",
  "src/service/executors/agentic/provider-adapter.mjs",
  "src/service/executors/multi_modal/multi-modal-executor.mjs",
  "src/service/executors/shared/provider-resolver.mjs",
  "src/service/action_tools/tools/vision-analyze.mjs",
  "src/service/core/browser-submission.mjs",
  "src/service/core/context-submission.mjs",
  "src/service/core/file-submission.mjs",
  "src/service/core/image-submission.mjs",
  "src/service/core/planning/runnable-executor.mjs",
  "src/service/core/http-routes/audio-routes.mjs",
  "src/service/core/http-routes/config-provider-routes.mjs",
  "src/service/core/intent/semantic-router.mjs",
  "src/service/embeddings/semantic.mjs",
  "src/service/dag/streaming-planner.mjs",
  "src/service/dag/planner.mjs"
]);

// ── 4. Tree scan: every file in src/service/** that references provider-resolver
//    must be in the approved set ──
function walkDir(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, files);
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

// Comment-only references to provider-resolver (no runtime import/call)
const commentOnlyCallers = new Set([
  "src/service/extractors/file-ingest.mjs"
]);

const allServiceFiles = walkDir(path.join(root, "src/service"));
for (const filePath of allServiceFiles) {
  const src = readFileSync(filePath, "utf8");
  if (!src.includes("resolveProviderForTask") && !src.includes("provider-resolver")) continue;
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  if (commentOnlyCallers.has(rel)) continue;
  if (!approvedResolverCallers.has(rel)) {
    fail(`${rel} uses provider-resolver but is not in the approved caller list`);
  }
}

// ── 5. Tree scan: every createProviderAdapter / provider-adapter user must be approved ──
const approvedAdapterCallers = new Set([
  "src/service/executors/tool_using/agent-loop.mjs",
  "src/service/executors/tool_using/final-composer.mjs",
  "src/service/executors/agentic/planner.mjs",
  "src/service/executors/agentic/provider-adapter.mjs",
  "src/service/executors/fast/fast-executor.mjs",
  "src/service/core/intent/semantic-router.mjs"
]);

for (const filePath of allServiceFiles) {
  const src = readFileSync(filePath, "utf8");
  if (!src.includes("createProviderAdapter") && !src.includes("provider-adapter")) continue;
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  if (!approvedAdapterCallers.has(rel)) {
    fail(`${rel} uses provider-adapter but is not in the approved caller list`);
  }
}

// ── 6. No unauthorized direct provider HTTP calls across ALL src/service/** ──
for (const filePath of allServiceFiles) {
  if (filePath.includes("provider-adapter.mjs")) continue;
  const src = readFileSync(filePath, "utf8");
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  if (src.includes("messages.create") || src.includes("chat.completions.create")) {
    fail(`${rel} must not make direct provider calls; use provider-adapter.mjs`);
  }
}

// ── 7. Inventory doc exists and documents all approved callers ──
const docPath = "docs/architecture/provider-boundary-plan.md";
assert(existsSync(path.join(root, docPath)), "provider boundary plan missing");
const doc = read(docPath);
assert(doc.includes("Provider Boundary Plan"), "provider boundary plan missing title");
assert(doc.includes("provider-adapter.mjs"), "provider boundary plan missing adapter path");
assert(doc.includes("provider-resolver.mjs"), "provider boundary plan missing resolver path");
assert(doc.includes("resolveProviderForTask"), "provider boundary plan missing resolution function");
assert(doc.includes("createProviderAdapter"), "provider boundary plan missing adapter function");
// The doc must reference the out-of-pipeline callers
for (const caller of ["audio-routes.mjs", "config-provider-routes.mjs", "runnable-executor.mjs", "semantic-router.mjs"]) {
  assert(doc.includes(caller), `provider boundary plan must document ${caller}`);
}

if (!process.exitCode) {
  console.log("[provider-boundary] provider boundary contracts verified");
}
