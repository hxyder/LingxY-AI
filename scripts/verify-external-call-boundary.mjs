#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const expectedNakedCalls = new Map([
  ["src/service/connectors/account-connectors.mjs", { fetch: 13, spawn: 0 }],
  ["src/service/executors/agentic/code-cli-bridge.mjs", { fetch: 0, spawn: 1 }],
  ["src/service/executors/fast/fast-executor.mjs", { fetch: 2, spawn: 0 }],
  ["src/service/executors/kimi/kimi-cli-executor.mjs", { fetch: 0, spawn: 2 }],
  ["src/service/executors/multi_modal/multi-modal-executor.mjs", { fetch: 2, spawn: 0 }]
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }
  return files;
}

function countCalls(source, name) {
  return [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].length;
}

assert.equal(existsSync(path.join(repoRoot, "src/service/core/external-call.mjs")), true);
assert.equal(existsSync(path.join(repoRoot, "tests/behavior/external-call.test.mjs")), true);

const roots = [
  path.join(repoRoot, "src/service/executors"),
  path.join(repoRoot, "src/service/connectors")
].filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory());

const actual = new Map();
for (const file of roots.flatMap(walk)) {
  const relativePath = path.relative(repoRoot, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  const fetch = countCalls(source, "fetch");
  const spawn = countCalls(source, "spawn");
  if (fetch > 0 || spawn > 0) {
    actual.set(relativePath, { fetch, spawn });
  }
}

assert.deepEqual(
  Object.fromEntries([...actual.entries()].sort()),
  Object.fromEntries([...expectedNakedCalls.entries()].sort()),
  "naked fetch/spawn inventory changed; migrate the new call through external-call.mjs or update this audit with a reason"
);

console.log("External call boundary audit passed.");
for (const [file, counts] of actual) {
  console.log(`- ${file}: fetch=${counts.fetch}, spawn=${counts.spawn}`);
}
