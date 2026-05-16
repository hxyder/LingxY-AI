import test from "node:test";
import assert from "node:assert/strict";

import {
  FILE_CLEANUP_CATEGORIES,
  buildFileCleanupEvidencePack,
  isDisposableLocalCleanupPath,
  validateFileCleanupEvidencePack
} from "../../src/shared/file-cleanup-evidence-pack.mjs";

function passingEvidence() {
  return {
    referenceSweep: {
      status: "pass",
      command: "rg -n old-runtime src scripts tests docs",
      summary: "no active references"
    },
    packageScriptSweep: {
      status: "pass",
      command: "rg -n old-runtime package.json scripts",
      summary: "no package scripts or script registrations"
    },
    publicExportSweep: {
      status: "pass",
      command: "rg -n oldRuntime src",
      summary: "no public exports"
    },
    interfaceSweep: {
      status: "pass",
      command: "rg -n ipc-old src docs scripts tests",
      summary: "no IPC, HTTP, tool, artifact, provider, or storage surface"
    },
    replacementVerifier: {
      status: "pass",
      command: "node scripts/verify-global-execution-latency.mjs",
      summary: "replacement path verified"
    },
    rollbackOrArchivePath: {
      status: "pass",
      command: "",
      summary: "archive to src/service/core/archive/old-runtime"
    },
    checkFast: {
      status: "pass",
      command: "npm run check:fast",
      summary: "fast suite passed"
    }
  };
}

test("file cleanup evidence pack builder normalizes cleanup categories", () => {
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: FILE_CLEANUP_CATEGORIES.map((category) => ({
      path: category === "local_generated_output" ? ".tmp/demo.log" : `src/demo/${category}.mjs`,
      category,
      trackedSource: category !== "local_generated_output",
      ownerLayer: category === "local_generated_output" ? "" : "service",
      decision: category === "large_mixed_responsibility_file" ? "candidate" : "blocked",
      reason: "template candidate"
    }))
  });

  assert.deepEqual(pack.candidates.map((candidate) => candidate.category), FILE_CLEANUP_CATEGORIES);
  assert.equal(pack.candidates[0].evidence.checkFast.requiredCommand, "npm run check:fast");
});

test("local generated output can be marked delete_ready without source sweeps", () => {
  assert.equal(isDisposableLocalCleanupPath(".tmp/live-provider-acceptance/report.json"), true);
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: [
      {
        path: ".tmp/live-provider-acceptance/report.json",
        category: "local_generated_output",
        trackedSource: false,
        decision: "delete_ready",
        reason: "disposable local acceptance report copied into committed evidence when needed",
        evidence: {
          referenceSweep: { status: "not_applicable", summary: "untracked local output" },
          packageScriptSweep: { status: "not_applicable", summary: "untracked local output" },
          publicExportSweep: { status: "not_applicable", summary: "untracked local output" },
          interfaceSweep: { status: "not_applicable", summary: "untracked local output" },
          replacementVerifier: { status: "not_applicable", summary: "no replacement path" },
          rollbackOrArchivePath: { status: "not_applicable", summary: "regenerable local output" },
          checkFast: { status: "not_applicable", summary: "not a tracked source change" }
        }
      }
    ]
  });

  const validation = validateFileCleanupEvidencePack(pack);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("tracked source delete_ready requires all sweeps and check:fast", () => {
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: [
      {
        path: "src/service/core/legacy-runtime.mjs",
        category: "old_reachable_implementation",
        trackedSource: true,
        ownerLayer: "service runtime",
        decision: "delete_ready",
        reason: "replacement exists",
        replacementPath: "src/service/core/runtime-spine.mjs"
      }
    ]
  });

  const validation = validateFileCleanupEvidencePack(pack);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("src/service/core/legacy-runtime.mjs.evidence.referenceSweep.pass"));
  assert.ok(validation.missing.includes("src/service/core/legacy-runtime.mjs.evidence.checkFast.pass"));
});

test("tracked source delete_ready passes with complete evidence", () => {
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: [
      {
        path: "src/service/core/legacy-runtime.mjs",
        category: "old_reachable_implementation",
        trackedSource: true,
        ownerLayer: "service runtime",
        decision: "delete_ready",
        reason: "replacement path is verified and old route is unreachable",
        replacementPath: "src/service/core/runtime-spine.mjs",
        evidence: passingEvidence()
      }
    ]
  });

  const validation = validateFileCleanupEvidencePack(pack);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("large mixed responsibility files can require split without deletion evidence", () => {
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: [
      {
        path: "src/desktop/renderer/console.js",
        category: "large_mixed_responsibility_file",
        trackedSource: true,
        ownerLayer: "desktop renderer",
        decision: "split_required",
        splitDirection: "extract conversation hydration and live progress into owned renderer modules",
        reason: "large file requires boundary-first extraction"
      }
    ]
  });

  const validation = validateFileCleanupEvidencePack(pack);
  assert.equal(validation.ok, true, validation.missing.join(", "));
});

test("forbidden paths cannot be marked delete_ready", () => {
  const pack = buildFileCleanupEvidencePack({
    commit: "abc123",
    branch: "task/cleanup",
    candidates: [
      {
        path: "node_modules/demo/index.js",
        category: "local_generated_output",
        trackedSource: false,
        decision: "delete_ready",
        reason: "should be blocked"
      }
    ]
  });

  const validation = validateFileCleanupEvidencePack(pack);
  assert.equal(validation.ok, false);
  assert.ok(validation.missing.includes("node_modules/demo/index.js.forbiddenCleanupPath"));
});
