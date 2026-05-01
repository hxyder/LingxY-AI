#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const behaviorDir = path.join(repoRoot, "tests", "behavior");

function collectTestFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.isFile() && /\.test\.mjs$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

if (!statSync(behaviorDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("Missing tests/behavior directory.");
  process.exit(1);
}

const testFiles = collectTestFiles(behaviorDir);
if (testFiles.length === 0) {
  console.error("No behavior tests found under tests/behavior.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
