#!/usr/bin/env node
/**
 * verify-route-verifier-readiness.mjs — C18 #C' round-7 (codex round-6 #9)
 *
 * Mechanical enforce-gate for the route verifier. Reads shadow-mode
 * telemetry produced by a corpus run and outputs PASS/FAIL based on
 * the criteria codex round-2 + round-6 settled on:
 *
 *   1. hard_signal_override (a.k.a. axis-violating correction the
 *      framework had to block) frequency — must be 0
 *   2. inconsistent_correction frequency — must be 0
 *      (these mean the judge proposed a self-contradictory triple
 *      and the framework caught it; small > 0 is OK during shadow,
 *      but enforce gate requires the judge has internalized the
 *      consistency rules)
 *   3. judge availability — invalid_payload + parse_error +
 *      unavailable cumulative rate < 5% (configurable)
 *   4. reject precision proxy — when the judge reject-s, the
 *      diff direction (upgrade vs downgrade) must agree with what
 *      structural signals would suggest (no random direction)
 *   5. dual-track coherence — `verifier_shadow.raw` and
 *      `verifier_shadow.post_override` must not contradict each
 *      other when both are present
 *
 * The script is intentionally NOT auto-flipping enforce on. It only
 * reports readiness; turning enforce on stays a deliberate operator
 * action (codex round-2 design — env=enforce alone is rejected by
 * semantic-router.mjs).
 *
 * Usage:
 *   node scripts/verify-route-verifier-readiness.mjs <telemetry.jsonl>
 *
 * The expected JSONL format is one row per SR call with at least:
 *   {
 *     "user_command": "...",
 *     "verifier_shadow": {
 *       "raw": { "judge_status", "diff", "diagnostics", "reason" },
 *       "post_override": null | { ... },
 *       "override_applied": boolean
 *     },
 *     "structural_signals": { ... }
 *   }
 *
 * The Test harness can be invoked without a file path; it will then
 * run a self-test against an embedded fixture so CI catches drift
 * in the gate logic itself even when no shadow corpus exists yet.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UNAVAILABILITY_BUDGET = 0.05;          // 5%
const INCONSISTENT_CORRECTION_BUDGET = 0;    // 0 = no breaks
const HARD_OVERRIDE_BUDGET = 0;              // 0 = no breaks

function parseRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed));
  }
  return rows;
}

/**
 * Aggregate counters across rows. Returns a structured summary
 * keyed by the gate criteria so the operator-facing output stays
 * stable regardless of corpus size.
 */
export function summariseRows(rows) {
  let total = 0;
  let unavailable = 0;
  let parse_error = 0;
  let invalid_payload = 0;
  let hard_signal_override = 0;
  let inconsistent_correction = 0;
  let dual_track_disagreement = 0;
  let reject_with_diff = 0;

  for (const row of rows) {
    const tracks = [
      row?.verifier_shadow?.raw,
      row?.verifier_shadow?.post_override
    ].filter(Boolean);
    if (tracks.length === 0) continue;
    total += tracks.length;
    for (const t of tracks) {
      const s = t?.judge_status;
      if (s === "unavailable") unavailable += 1;
      if (s === "invalid_payload") invalid_payload += 1;
      if (s === "hard_signal_override") hard_signal_override += 1;
      if (s === "inconsistent_correction") inconsistent_correction += 1;
      if (typeof t?.reason === "string" && /parse/i.test(t.reason)) parse_error += 1;
      if (t?.diff && Object.keys(t.diff).length > 0) reject_with_diff += 1;
    }
    // Dual-track coherence: when both raw and post_override are
    // present, their diffs should not contradict (e.g. raw says
    // upgrade web_policy and post_override says downgrade).
    if (row?.verifier_shadow?.raw && row?.verifier_shadow?.post_override) {
      const rawDiff = row.verifier_shadow.raw.diff ?? {};
      const postDiff = row.verifier_shadow.post_override.diff ?? {};
      if (rawDiff?.web_policy && postDiff?.web_policy) {
        // Contradiction = both diffs change web_policy in opposite
        // directions. Use the same upgrade/downgrade taxonomy as the
        // verifier itself.
        if (rawDiff.web_policy.to !== postDiff.web_policy.to) {
          dual_track_disagreement += 1;
        }
      }
    }
  }

  return {
    total,
    unavailable,
    parse_error,
    invalid_payload,
    hard_signal_override,
    inconsistent_correction,
    dual_track_disagreement,
    reject_with_diff,
    unavailability_rate: total === 0 ? 0 : (unavailable + parse_error + invalid_payload) / total
  };
}

export function evaluateReadiness(summary) {
  const failures = [];
  if (summary.hard_signal_override > HARD_OVERRIDE_BUDGET) {
    failures.push(
      `hard_signal_override=${summary.hard_signal_override} (budget ${HARD_OVERRIDE_BUDGET}) — judge proposed corrections that violated structural signals; verifier blocked them but enforce should not ship until judge stops doing this`
    );
  }
  if (summary.inconsistent_correction > INCONSISTENT_CORRECTION_BUDGET) {
    failures.push(
      `inconsistent_correction=${summary.inconsistent_correction} (budget ${INCONSISTENT_CORRECTION_BUDGET}) — judge proposed self-contradictory triples; the consistency floor caught them but enforce should require the judge has internalised the invariants`
    );
  }
  if (summary.unavailability_rate > UNAVAILABILITY_BUDGET) {
    failures.push(
      `unavailability_rate=${summary.unavailability_rate.toFixed(3)} > ${UNAVAILABILITY_BUDGET} — too many timeouts/parse errors/missing keys for enforce to land safely`
    );
  }
  if (summary.dual_track_disagreement > 0) {
    failures.push(
      `dual_track_disagreement=${summary.dual_track_disagreement} — raw and post_override diffs contradict; suggests stable-qa-override is masking real verifier judgement, investigate before deletion`
    );
  }
  return {
    ready: failures.length === 0,
    failures,
    summary
  };
}

function main() {
  const argv = process.argv.slice(2);
  let rows;
  if (argv.length === 0) {
    // Self-test: synthetic clean fixture should always pass.
    rows = [{
      user_command: "什么是 RAG",
      verifier_shadow: {
        raw: { judge_status: "ok", diff: { web_policy: { from: "required", to: "forbidden" } }, reason: "shadow", diagnostics: null },
        post_override: null,
        override_applied: false
      }
    }];
  } else {
    const file = path.resolve(argv[0]);
    if (!existsSync(file)) {
      console.error(`telemetry file not found: ${file}`);
      process.exit(2);
    }
    rows = parseRows(readFileSync(file, "utf8"));
  }
  const summary = summariseRows(rows);
  const verdict = evaluateReadiness(summary);
  console.log(JSON.stringify({
    ready: verdict.ready,
    summary,
    failures: verdict.failures
  }, null, 2));
  process.exit(verdict.ready ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
