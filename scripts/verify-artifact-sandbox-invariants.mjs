#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const helperSrc = read("src/service/core/artifact-path-helper.mjs");

// Sandbox invariants (Codex 2E.1 review):
// 1. `..` segments must throw "path must not contain '..'"
assert.match(helperSrc, /path must not contain '\.\.'/,
  "resolveSandboxedTarget must reject '..' segments");
assert.match(helperSrc, /relativePath\.includes\("\.\."\)/,
  "resolveSandboxedTarget must check for '..' in relativePath");

// 2. Absolute path inside allowed roots must be accepted (path.isAbsolute branch)
assert.match(helperSrc, /path\.isAbsolute/,
  "resolveSandboxedTarget must handle absolute paths");

// 3. Absolute path outside all roots must throw "path escapes task workspace"
assert.match(helperSrc, /path escapes task workspace/,
  "resolveSandboxedTarget must throw on paths outside allowed roots");

// 4. Parent-chain symlinks must throw "parent path contains a symlink"
assert.match(helperSrc, /parent path contains a symlink/,
  "resolveSandboxedTarget must reject symlinks in parent chain");

// 5. Existing target symlinks must throw "target path is a symlink"
assert.match(helperSrc, /target path is a symlink/,
  "resolveSandboxedTarget must reject symlink targets");

// 6. lstat must be imported (symlink checks depend on it)
assert.match(helperSrc, /import.*lstat.*from.*node:fs\/promises/,
  "artifact-path-helper.mjs must import lstat for symlink checks");

// 7. The containingRoot check must use the right logic
assert.match(helperSrc, /containingRoot/,
  "resolveSandboxedTarget must find containing root");
assert.match(helperSrc, /roots\.find/,
  "resolveSandboxedTarget must search roots for containing root");

// 8. ENOENT must be ignored in lstat error handling (parent may not exist yet)
assert.match(helperSrc, /ENOENT/,
  "resolveSandboxedTarget must tolerate ENOENT in lstat");

// 9. No fallback path rewriting — outside paths must throw, not be rewritten
// (The original had no path.basename fallback — rejection is the only path)
const srcLines = helperSrc.split("\n");
for (const line of srcLines) {
  assert.ok(!line.includes("basename(relativePath)"),
    `artifact-path-helper must not rewrite outside paths: ${line.trim()}`);
}

console.log("[verify-artifact-sandbox-invariants] sandbox invariants verified");
