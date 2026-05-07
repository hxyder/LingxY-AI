#!/usr/bin/env node
/**
 * diff-runs.mjs — Plan P1 #1 (业界对照 #1: 跨 run 回归 diff)
 *
 * Compares two corpus run reports and surfaces what changed:
 *   - newly failing cases (regressions)
 *   - newly passing cases (fixes / lucky improvements)
 *   - latency drift outside a tolerance band
 *   - reason-shape changes when both runs failed
 *
 * Usage:
 *   node scripts/real-llm-test/diff-runs.mjs <baseline.json> <candidate.json>
 *
 * Both reports are full corpus reports written by run-corpus.mjs:
 *   { summary: { ... }, results: [{ id, grade, elapsedMs, taskId, ... }] }
 *
 * Why this script exists (industry-harness gap #1, plan line 474):
 *   Corpus reports until now were standalone snapshots — to find a
 *   regression you had to read two markdown files side by side. The
 *   diff hands the operator a punch list:
 *     "K.url_only newly fails (was passing); N.schedule_4 newly
 *      passes; D.compare_frameworks_doc latency +400% from 1.2s to
 *      6.0s; A.bubblesort same status, same reasons (no signal)."
 *
 * Output is structured JSON by default; pass --markdown for a human
 * report. Exit code: 1 when there are NEW regressions (newly-failing
 * cases), 0 otherwise. Latency drift alone does NOT fail the gate —
 * runtime variance is expected; surface it as a warning.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LATENCY_TOLERANCE_FACTOR = 2.5;        // ratio above 2.5x is flagged
const LATENCY_FLOOR_MS = 500;                // ignore <500ms cases (noise)

function loadReport(p) {
  const raw = readFileSync(path.resolve(p), "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.results)) {
    throw new Error(`expected results[] in ${p}, got ${typeof parsed?.results}`);
  }
  return parsed;
}

function indexResults(report) {
  const map = new Map();
  for (const r of report.results) {
    if (!r?.id) continue;
    map.set(r.id, r);
  }
  return map;
}

function passReason(grade) {
  if (!grade) return "no_grade";
  if (grade.passed) return null;
  if (Array.isArray(grade.reasons) && grade.reasons.length > 0) {
    return grade.reasons[0];
  }
  return grade.status ?? "failed";
}

export function diffReports(baseline, candidate) {
  const a = indexResults(baseline);
  const b = indexResults(candidate);

  const onlyInBaseline = [];
  const onlyInCandidate = [];
  const newRegressions = [];
  const newPasses = [];
  const reasonChanges = [];
  const latencyDrift = [];
  const stableFailing = [];
  const stablePassing = [];

  for (const [id, ra] of a) {
    const rb = b.get(id);
    if (!rb) {
      onlyInBaseline.push({ id });
      continue;
    }
    const passA = ra.grade?.passed === true;
    const passB = rb.grade?.passed === true;
    if (passA && !passB) {
      newRegressions.push({
        id,
        was: "pass",
        now: "fail",
        reason: passReason(rb.grade),
        baselineMs: ra.elapsedMs ?? null,
        candidateMs: rb.elapsedMs ?? null
      });
    } else if (!passA && passB) {
      newPasses.push({
        id,
        was: "fail",
        now: "pass",
        previousReason: passReason(ra.grade)
      });
    } else if (!passA && !passB) {
      const ra1 = passReason(ra.grade);
      const rb1 = passReason(rb.grade);
      if (ra1 !== rb1) {
        reasonChanges.push({ id, before: ra1, after: rb1 });
      }
      stableFailing.push({ id, reason: rb1 });
    } else {
      stablePassing.push({ id });
    }

    const baseMs = Number(ra.elapsedMs);
    const candMs = Number(rb.elapsedMs);
    if (Number.isFinite(baseMs) && Number.isFinite(candMs)
        && Math.max(baseMs, candMs) >= LATENCY_FLOOR_MS) {
      const ratio = baseMs > 0 ? candMs / baseMs : Infinity;
      if (ratio >= LATENCY_TOLERANCE_FACTOR || ratio <= 1 / LATENCY_TOLERANCE_FACTOR) {
        latencyDrift.push({
          id,
          baselineMs: baseMs,
          candidateMs: candMs,
          ratio: Math.round(ratio * 100) / 100
        });
      }
    }
  }
  for (const [id] of b) {
    if (!a.has(id)) onlyInCandidate.push({ id });
  }

  return {
    summary: {
      baseline_total: baseline.results.length,
      candidate_total: candidate.results.length,
      stable_passing: stablePassing.length,
      stable_failing: stableFailing.length,
      new_regressions: newRegressions.length,
      new_passes: newPasses.length,
      reason_changes: reasonChanges.length,
      latency_drift_count: latencyDrift.length,
      only_in_baseline: onlyInBaseline.length,
      only_in_candidate: onlyInCandidate.length
    },
    new_regressions: newRegressions,
    new_passes: newPasses,
    reason_changes: reasonChanges,
    latency_drift: latencyDrift,
    only_in_baseline: onlyInBaseline,
    only_in_candidate: onlyInCandidate
  };
}

function formatMarkdown(diff) {
  const lines = [];
  const s = diff.summary;
  lines.push(`# Corpus diff`);
  lines.push("");
  lines.push(`- baseline: ${s.baseline_total} cases`);
  lines.push(`- candidate: ${s.candidate_total} cases`);
  lines.push(`- stable passing: ${s.stable_passing}`);
  lines.push(`- stable failing: ${s.stable_failing}`);
  lines.push(`- **new regressions**: ${s.new_regressions}`);
  lines.push(`- new passes: ${s.new_passes}`);
  lines.push(`- reason changes (failing↔failing): ${s.reason_changes}`);
  lines.push(`- latency drift outside ±${LATENCY_TOLERANCE_FACTOR}× band: ${s.latency_drift_count}`);
  lines.push(`- only in baseline: ${s.only_in_baseline}`);
  lines.push(`- only in candidate: ${s.only_in_candidate}`);
  lines.push("");

  if (diff.new_regressions.length > 0) {
    lines.push("## ❌ New regressions");
    lines.push("");
    for (const r of diff.new_regressions) {
      lines.push(`- **${r.id}** — ${r.reason} (baseline ${r.baselineMs}ms → candidate ${r.candidateMs}ms)`);
    }
    lines.push("");
  }
  if (diff.new_passes.length > 0) {
    lines.push("## ✅ Newly passing");
    lines.push("");
    for (const r of diff.new_passes) {
      lines.push(`- **${r.id}** — was failing with: ${r.previousReason}`);
    }
    lines.push("");
  }
  if (diff.reason_changes.length > 0) {
    lines.push("## 🔄 Reason changes (still failing, different reason)");
    lines.push("");
    for (const r of diff.reason_changes) {
      lines.push(`- **${r.id}**: ${r.before} → ${r.after}`);
    }
    lines.push("");
  }
  if (diff.latency_drift.length > 0) {
    lines.push("## ⏱ Latency drift");
    lines.push("");
    for (const r of diff.latency_drift) {
      const arrow = r.ratio > 1 ? "↑" : "↓";
      lines.push(`- **${r.id}** ${arrow} ${r.baselineMs}ms → ${r.candidateMs}ms (${r.ratio}×)`);
    }
    lines.push("");
  }
  if (diff.only_in_baseline.length > 0 || diff.only_in_candidate.length > 0) {
    lines.push("## ⚠ Corpus drift");
    lines.push("");
    for (const r of diff.only_in_baseline) lines.push(`- baseline-only: ${r.id} (case removed?)`);
    for (const r of diff.only_in_candidate) lines.push(`- candidate-only: ${r.id} (case added)`);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const wantMarkdown = argv.includes("--markdown");
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 2) {
    console.error("usage: node scripts/real-llm-test/diff-runs.mjs <baseline.json> <candidate.json> [--markdown]");
    process.exit(2);
  }
  const baseline = loadReport(positional[0]);
  const candidate = loadReport(positional[1]);
  const diff = diffReports(baseline, candidate);
  if (wantMarkdown) {
    console.log(formatMarkdown(diff));
  } else {
    console.log(JSON.stringify(diff, null, 2));
  }
  process.exit(diff.new_regressions.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
