#!/usr/bin/env node
import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isDisposableLocalCleanupPath,
  isForbiddenCleanupPath
} from "../src/shared/file-cleanup-evidence-pack.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const LOCAL_GENERATED_CLEANUP_PATHS = Object.freeze([
  ".tmp",
  "tmp",
  ".tmp-checkfast.log",
  ".codex-behavior.log"
]);

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run")
  };
}

function normalizeForPolicy(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "");
}

function relativeInsideRoot(absPath) {
  const relative = path.relative(root, absPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to clean outside repository root: ${absPath}`);
  }
  return normalizeForPolicy(relative);
}

function assertApprovedCleanupPath(relPath) {
  const normalized = normalizeForPolicy(relPath);
  const absPath = path.resolve(root, relPath);
  const rootRelative = relativeInsideRoot(absPath);
  if (rootRelative !== normalized) {
    throw new Error(`refusing ambiguous cleanup path: ${relPath}`);
  }
  if (!isDisposableLocalCleanupPath(normalized)) {
    throw new Error(`refusing non-disposable cleanup path: ${relPath}`);
  }
  if (isForbiddenCleanupPath(normalized)) {
    throw new Error(`refusing forbidden cleanup path: ${relPath}`);
  }
  return { normalized, absPath };
}

async function readEntry(absPath) {
  try {
    return await lstat(absPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function describeEntry(stat) {
  if (stat.isSymbolicLink()) return "symlink";
  if (stat.isDirectory()) return "directory";
  if (stat.isFile()) return "file";
  return "other";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const removed = [];
  const candidates = [];
  const skipped = [];

  for (const relPath of LOCAL_GENERATED_CLEANUP_PATHS) {
    const { normalized, absPath } = assertApprovedCleanupPath(relPath);
    const entry = await readEntry(absPath);
    if (!entry) {
      skipped.push({ path: normalized, reason: "missing" });
      continue;
    }

    const type = describeEntry(entry);
    if (type === "symlink") {
      skipped.push({ path: normalized, reason: "symlink" });
      continue;
    }

    const record = { path: normalized, type };
    if (args.dryRun) {
      candidates.push(record);
      continue;
    }

    await rm(absPath, { force: true, recursive: true });
    removed.push(record);
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    candidates,
    removed,
    skipped
  }, null, 2));
}

main().catch((error) => {
  console.error(`[clean-local-generated] ${error.stack || error.message}`);
  process.exitCode = 1;
});
