#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildFileCleanupEvidencePack,
  validateFileCleanupEvidencePack
} from "../src/shared/file-cleanup-evidence-pack.mjs";

const DEFAULT_OUTPUT_DIR = path.resolve(".tmp", "file-cleanup-candidates");
const MAX_LISTED_DIR_ENTRIES = 12;

const LARGE_FILE_CANDIDATES = Object.freeze([
  {
    path: "src/desktop/renderer/console.js",
    ownerLayer: "desktop renderer",
    splitDirection: "extract conversation hydration, task progress, and settings flows behind renderer clients"
  },
  {
    path: "src/desktop/renderer/overlay.js",
    ownerLayer: "desktop renderer",
    splitDirection: "extract capture mode, task card hydration, and composer state into owned modules"
  },
  {
    path: "src/service/core/task-runtime/conversation-lifecycle.mjs",
    ownerLayer: "service task runtime",
    splitDirection: "keep task submission orchestration thin and move enrichment helpers behind typed service contracts"
  },
  {
    path: "src/service/executors/tool_using/agent-loop.mjs",
    ownerLayer: "service executor",
    splitDirection: "continue extracting planner heartbeat, deterministic artifact plans, and finalization policies"
  },
  {
    path: "src/service/executors/agentic/planner.mjs",
    ownerLayer: "service executor",
    splitDirection: "move provider wait, skill loading, and tool-surface shaping into shared executor modules"
  }
]);

function parseArgs(argv) {
  const out = {
    outputDir: DEFAULT_OUTPUT_DIR
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-dir") out.outputDir = path.resolve(argv[++i]);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

function currentGit(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function trackedFiles() {
  const output = currentGit(["ls-files"]);
  return new Set(output.split(/\r?\n/u).filter(Boolean).map((file) => file.replace(/\\/g, "/")));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function listDirectoryHead(relPath) {
  try {
    return readdirSync(path.resolve(relPath)).slice(0, MAX_LISTED_DIR_ENTRIES).join(", ");
  } catch {
    return "";
  }
}

function disposableOutputCandidates() {
  const paths = [".tmp", "tmp", ".tmp-checkfast.log", ".codex-behavior.log"];
  return paths
    .filter((relPath) => existsSync(path.resolve(relPath)))
    .map((relPath) => {
      const stat = statSync(path.resolve(relPath));
      const summary = stat.isDirectory()
        ? `local generated directory; sample entries: ${listDirectoryHead(relPath) || "none"}`
        : `local generated file; ${stat.size} bytes`;
      return {
        path: relPath,
        category: "local_generated_output",
        trackedSource: false,
        decision: "delete_ready",
        reason: "disposable local output; runner reports it but performs no deletion",
        evidence: {
          referenceSweep: { status: "not_applicable", summary },
          packageScriptSweep: { status: "not_applicable", summary: "untracked local output" },
          publicExportSweep: { status: "not_applicable", summary: "untracked local output" },
          interfaceSweep: { status: "not_applicable", summary: "untracked local output" },
          replacementVerifier: { status: "not_applicable", summary: "regenerable local output" },
          rollbackOrArchivePath: { status: "not_applicable", summary: "regenerate by rerunning the owning verifier or acceptance harness" },
          checkFast: { status: "not_applicable", summary: "not a tracked source cleanup" }
        }
      };
    });
}

function historicalEvidenceCandidates(tracked) {
  const dir = path.resolve("scripts", "real-llm-test");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^report-\d{4}-\d{2}-\d{2}.*\.md$/u.test(name))
    .map((name) => {
      const relPath = path.join("scripts", "real-llm-test", name).replace(/\\/g, "/");
      return {
        path: relPath,
        category: "historical_evidence",
        trackedSource: tracked.has(relPath),
        ownerLayer: "release evidence",
        decision: "retain",
        reason: "historical live-provider evidence; retain until a roadmap-linked evidence replacement and release-note sweep exists",
        evidence: {
          referenceSweep: { status: "not_run", summary: "run before archive/delete" },
          packageScriptSweep: { status: "not_applicable", summary: "evidence report" },
          publicExportSweep: { status: "not_applicable", summary: "evidence report" },
          interfaceSweep: { status: "not_applicable", summary: "evidence report" },
          replacementVerifier: { status: "not_run", summary: "replacement evidence bundle not selected" },
          rollbackOrArchivePath: { status: "not_run", summary: "archive path not selected" },
          checkFast: { status: "not_run", summary: "required only if tracked cleanup is performed" }
        }
      };
    });
}

function largeFileSplitCandidates(tracked) {
  return LARGE_FILE_CANDIDATES
    .filter((candidate) => existsSync(path.resolve(candidate.path)))
    .map((candidate) => ({
      path: candidate.path,
      category: "large_mixed_responsibility_file",
      trackedSource: tracked.has(candidate.path),
      ownerLayer: candidate.ownerLayer,
      decision: "split_required",
      splitDirection: candidate.splitDirection,
      reason: "large mixed-responsibility file; cleanup starts with boundary verifier and one-owner extraction, not deletion",
      evidence: {
        referenceSweep: { status: "not_run", summary: "run before moving owners" },
        packageScriptSweep: { status: "not_applicable", summary: "source split candidate" },
        publicExportSweep: { status: "not_run", summary: "run before changing exports" },
        interfaceSweep: { status: "not_run", summary: "run IPC/HTTP/tool/event/storage sweep before split" },
        replacementVerifier: { status: "not_run", summary: "add boundary verifier before extraction" },
        rollbackOrArchivePath: { status: "not_applicable", summary: "split candidate, not archive/delete candidate" },
        checkFast: { status: "not_run", summary: "run after extraction" }
      }
    }));
}

const tracked = trackedFiles();
const candidates = [
  ...disposableOutputCandidates(),
  ...historicalEvidenceCandidates(tracked),
  ...largeFileSplitCandidates(tracked)
];

const pack = buildFileCleanupEvidencePack({
  commit: currentGit(["rev-parse", "--short", "HEAD"]),
  branch: currentGit(["branch", "--show-current"]),
  candidates,
  notes: [
    "This report is evidence-only. It performs no deletion, archive, move, or source edit.",
    "Only local_generated_output candidates under disposable roots may be delete_ready without tracked-source sweeps."
  ]
});

const validation = validateFileCleanupEvidencePack(pack);
mkdirSync(ARGS.outputDir, { recursive: true });
const reportPath = path.join(ARGS.outputDir, `report-${nowStamp()}.json`);
writeFileSync(reportPath, JSON.stringify(pack, null, 2), "utf8");

const byDecision = candidates.reduce((acc, candidate) => {
  acc[candidate.decision] = (acc[candidate.decision] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  ok: validation.ok,
  report: path.relative(process.cwd(), reportPath),
  candidates: candidates.length,
  byDecision,
  missing: validation.missing
}, null, 2));

if (!validation.ok) {
  process.exitCode = 1;
}
