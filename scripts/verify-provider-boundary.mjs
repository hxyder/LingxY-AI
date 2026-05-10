#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

// ── 2. Provider resolver exists and exports resolution functions ──
const resolverPath = "src/service/executors/shared/provider-resolver.mjs";
assert(existsSync(path.join(root, resolverPath)), `provider resolver missing: ${resolverPath}`);
const resolverSrc = read(resolverPath);
assert(resolverSrc.includes("export function resolveProviderForTask") ||
  resolverSrc.includes("export async function resolveProviderForTask"),
  "provider-resolver.mjs must export resolveProviderForTask");
assert(resolverSrc.includes("describeResolvedProvider"),
  "provider-resolver.mjs must export describeResolvedProvider");

// ── 3. All executor call sites must use provider-resolver, not direct resolution ──
const approvedResolverCallers = [
  "src/service/executors/fast/fast-executor.mjs",
  "src/service/executors/tool_using/agent-loop.mjs",
  "src/service/executors/tool_using/final-composer.mjs",
  "src/service/executors/agentic/planner.mjs",
  "src/service/executors/agentic/provider-adapter.mjs",
  "src/service/executors/multi_modal/multi-modal-executor.mjs",
  "src/service/action_tools/tools/vision-analyze.mjs",
  "src/service/core/browser-submission.mjs",
  "src/service/core/context-submission.mjs",
  "src/service/core/file-submission.mjs",
  "src/service/core/image-submission.mjs",
  "src/service/dag/streaming-planner.mjs",
  "src/service/dag/planner.mjs"
];
for (const callerPath of approvedResolverCallers) {
  const fullPath = path.join(root, callerPath);
  if (!existsSync(fullPath)) {
    fail(`approved resolver caller missing: ${callerPath}`);
    continue;
  }
  const callerSrc = readFileSync(fullPath, "utf8");
  assert(callerSrc.includes("resolveProviderForTask") ||
    callerSrc.includes("provider-resolver"),
    `${callerPath} must use provider-resolver for provider resolution`);
}

// ── 4. All provider adapter call sites must use provider-adapter ──
const approvedAdapterCallers = [
  "src/service/executors/tool_using/agent-loop.mjs",
  "src/service/executors/tool_using/final-composer.mjs",
  "src/service/executors/agentic/planner.mjs",
  "src/service/executors/fast/fast-executor.mjs"
];
for (const callerPath of approvedAdapterCallers) {
  const callerSrc = read(callerPath);
  assert(callerSrc.includes("createProviderAdapter"),
    `${callerPath} must use createProviderAdapter for provider calls`);
}

// ── 5. Semantic router is the only approved dynamic resolver import ──
const semanticSrc = read("src/service/embeddings/semantic.mjs");
assert(semanticSrc.includes("provider-resolver"),
  "semantic router must use provider-resolver (approved exception)");

// ── 6. No unauthorized direct provider HTTP calls outside provider-adapter ──
// The provider-adapter is the single boundary for provider HTTP/streaming.
// Check that no executor (other than provider-adapter) contains direct
// provider API calls (e.g., anthropic.messages.create, openai.chat.completions).
const executorsDir = path.join(root, "src/service/executors");
function walkExecutors(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkExecutors(fullPath));
    else if (/\.(mjs|js)$/.test(entry.name)) results.push(fullPath);
  }
  return results;
}
const executorFiles = walkExecutors(executorsDir);
for (const filePath of executorFiles) {
  if (filePath.includes("provider-adapter.mjs")) continue;
  const src = readFileSync(filePath, "utf8");
  // Check for direct Anthropic/OpenAI SDK calls that bypass the adapter
  const relPath = path.relative(root, filePath);
  if (src.includes("messages.create") || src.includes("chat.completions.create")) {
    // Only provider-adapter may make direct provider calls
    fail(`${relPath} must not make direct provider calls; use provider-adapter.mjs`);
  }
}

// ── 7. Inventory doc exists and documents the boundary ──
const docPath = "docs/architecture/provider-boundary-plan.md";
assert(existsSync(path.join(root, docPath)), "provider boundary plan missing");
const doc = read(docPath);
assert(doc.includes("Provider Boundary Plan"), "provider boundary plan missing title");
assert(doc.includes("provider-adapter.mjs"), "provider boundary plan missing adapter path");
assert(doc.includes("provider-resolver.mjs"), "provider boundary plan missing resolver path");
assert(doc.includes("resolveProviderForTask"), "provider boundary plan missing resolution function");
assert(doc.includes("createProviderAdapter"), "provider boundary plan missing adapter function");
assert(doc.includes("semantic.mjs"), "provider boundary plan must document semantic router exception");

if (!process.exitCode) {
  console.log("[provider-boundary] provider boundary contracts verified");
}
