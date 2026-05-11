#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[memory-tools] ${message}`);
  process.exitCode = 1;
}

// CAP-1 memory-tools contract preflight. No physical move.

// 1. All four tools exist in BUILTIN_ACTION_TOOLS
const memoryToolIds = ["recall_memory", "list_recent_tasks", "get_task_detail", "list_conversation_artifacts"];
for (const id of memoryToolIds) {
  const tool = BUILTIN_ACTION_TOOLS.find(t => t.id === id);
  assert(tool, `BUILTIN_ACTION_TOOLS must include ${id}`);
}

// 2. Current owner file exists
const currentPath = "src/service/action_tools/tools/memory-tools.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);

// 3. Current owner exports the tools
const memSrc = read(currentPath);
for (const name of ["RECALL_MEMORY_TOOL", "LIST_RECENT_TASKS_TOOL", "GET_TASK_DETAIL_TOOL", "LIST_CONVERSATION_ARTIFACTS_TOOL"]) {
  assert(memSrc.includes(`export const ${name}`),
    `memory-tools.mjs must export ${name}`);
}

// 4. No-touch contracts
assert(memSrc.includes("createActionResult"),
  "memory-tools must use createActionResult");
assert(memSrc.includes("runtime.store") || memSrc.includes("runtime?.store"),
  "memory-tools must access runtime.store");
assert(memSrc.includes("extractArtifactPaths"),
  "memory-tools must define extractArtifactPaths helper");
assert(memSrc.includes("embeddingStore"),
  "memory-tools must use embeddingStore for semantic search");

// 5. All tools are read-only (no writes, no network)
assert(!memSrc.includes("writeFile") && !memSrc.includes("fetch("),
  "memory-tools must not write files or make network calls");

// 6. Boundary doc exists
const boundaryPath = "docs/architecture/memory-tools-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "memory-tools boundary doc missing");
const boundaryDoc = read(boundaryPath);
assert(boundaryDoc.includes("Memory Tools Boundary"),
  "boundary doc must have title");
assert(boundaryDoc.includes("Preflight only in this phase"),
  "boundary doc must state preflight-only status");

if (!process.exitCode) {
  console.log("[memory-tools] contract verified");
}
