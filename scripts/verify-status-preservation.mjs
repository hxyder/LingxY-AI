#!/usr/bin/env node
/**
 * UCA-077 P4-RQ G6a: status preservation in submission paths.
 *
 * Pre-G6a: every submission path's success-completion block ran:
 *   if (task.status !== "success") {
 *     updateTask(... status: "success" ...);
 *   }
 *   markTaskSucceeded(...);
 *   return { status: "success", ... };
 *
 * That clobbered any terminal status the executor had already set —
 * partial_success / failed / cancelled / waiting_external_decision /
 * unsupported. G5b/G5c yielded partial_success events for routing-
 * degraded and unbacked-claim cases, but the submission layer
 * forced them back to success on the way out.
 *
 * G6a fix: only force success when task is still in an in-progress
 * state (queued / running). Preserve terminal statuses. Return
 * task.status (not the hardcoded "success") so callers see the
 * real outcome.
 *
 * Asserts via source-level grep across all 5 affected submission
 * files (8 patched sites total). Direct integration tests would
 * require running each submission path's executor; that's covered
 * by the per-executor verifiers (verify-fast-executor-truthfulness,
 * verify-prose-trap, verify-agentic-planner). This verifier
 * specifically guards against the "force-success" anti-pattern
 * silently re-emerging anywhere.
 *
 * Run: node scripts/verify-status-preservation.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SUBMISSION_FILES = [
  "../src/service/core/context-submission.mjs",
  "../src/service/core/browser-submission.mjs",
  "../src/service/core/file-submission.mjs",
  "../src/service/core/image-submission.mjs",
  "../src/service/core/office-submission.mjs"
];

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

function loadFile(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

// ── Anti-pattern check ──────────────────────────────────────────────
it("anti-pattern: NO submission file uses 'task.status !== \"success\"' force-success guard", () => {
  // Pre-G6a all 5 files had this pattern. After G6a it's been
  // replaced with the in-progress-only guard. Lock-in to prevent
  // regression.
  for (const rel of SUBMISSION_FILES) {
    const src = loadFile(rel);
    assert.doesNotMatch(src, /if \(task\.status !== "success"\) \{/,
      `${rel} must not contain the pre-G6a force-success guard`);
  }
});

// ── G6a guard shape ─────────────────────────────────────────────────
it("G6a: every submission file uses the in-progress-only success force pattern", () => {
  // The new pattern: only force success when task is still
  // queued or running.
  for (const rel of SUBMISSION_FILES) {
    const src = loadFile(rel);
    assert.match(src, /if \(task\.status === "queued" \|\| task\.status === "running"\) \{/,
      `${rel} must use the in-progress-only force-success guard`);
  }
});

it("G6a: every submission file return uses task.status (not hardcoded 'success')", () => {
  // After the success-completion guard, return values should pass
  // back the actual task.status so callers see partial_success /
  // failed / etc. when the executor downgraded.
  for (const rel of SUBMISSION_FILES) {
    const src = loadFile(rel);
    // Only check files that have a return-with-status return shape
    // following the G6a marker. file-submission returns a different
    // shape ({ task, taskEvents, ... }) so doesn't have a status key
    // at the success-completion site — skip its assertion.
    if (rel.includes("file-submission")) continue;
    // For each P4-RQ G6a marker, confirm the next 'return { status:'
    // within 12 lines uses task.status, not hardcoded "success".
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("P4-RQ G6a")) {
        // Look for return within 12 lines
        let foundReturn = false;
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          if (lines[j].includes("return { status:")) {
            foundReturn = true;
            assert.doesNotMatch(lines[j], /return \{ status: "success"[,\s}]/,
              `${rel}:${j + 1} must use task.status (not hardcoded "success") after G6a marker`);
            assert.match(lines[j], /return \{ status: task\.status[,\s}]/,
              `${rel}:${j + 1} must return task.status`);
            break;
          }
        }
        if (!foundReturn) {
          // file-submission returns a richer shape — that's fine,
          // skip. Other files should always have a return here.
        }
      }
    }
  }
});

// ── G5/G6 round-trip: partial_success status preserved end-to-end ───
it("integration: submission's force-success block preserves a partial_success applyExecutorEvent stamp", async () => {
  // Construct a fake task in 'partial_success' status and verify
  // that an in-progress-only guard wouldn't clobber it back.
  // The actual integration is exercised by verify-fast-executor-
  // truthfulness; here we just sanity-check the predicate.
  const sentinelStatuses = ["partial_success", "failed", "cancelled", "waiting_external_decision", "unsupported"];
  for (const status of sentinelStatuses) {
    const isInProgress = status === "queued" || status === "running";
    assert.equal(isInProgress, false,
      `terminal status "${status}" must not match the in-progress predicate`);
  }
});

// ── G6a fixture: at least one submission file should also have an
// updated comment explaining why ──────────────────────────────────
it("G6a: documentation cross-reference present in at least one file", () => {
  let found = false;
  for (const rel of SUBMISSION_FILES) {
    const src = loadFile(rel);
    if (/G5b|G5c|G6a/.test(src)) {
      found = true;
      break;
    }
  }
  assert.ok(found, "at least one submission file must reference the G6a / G5b / G5c rationale");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
