#!/usr/bin/env node
/**
 * UCA-077 P4-09 K1: routing distribution monitor.
 *
 * Locks in the snapshot shape + aggregation correctness over the
 * existing task store + audit log. Pure aggregator — no streaming
 * counters, no new persistence.
 *
 * Run: node scripts/verify-routing-monitor.mjs
 */

import assert from "node:assert/strict";
import { getRoutingDistribution, formatRoutingDistribution }
  from "../src/service/core/runtime/routing-monitor.mjs";

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

/** Tiny in-memory store stub matching the surface routing-monitor reads. */
function makeStore({ tasks = [], audit = [] } = {}) {
  return {
    listTasks: () => tasks.slice(),
    listAuditLogs: () => audit.slice()
  };
}

function makeTask(over = {}) {
  return {
    task_id: over.task_id ?? `task_${Math.random().toString(36).slice(2, 8)}`,
    created_at: over.created_at ?? "2026-04-26T10:00:00Z",
    status: over.status ?? "success",
    task_spec: {
      goal: over.goal ?? "qa",
      executor: over.executor ?? "fast",
      routing_status: over.routing_status ?? "ok",
      routing_degraded: over.routing_degraded ?? false,
      tool_policy: {
        policy_groups: {
          external_web_read: { mode: over.web_mode ?? "forbidden" }
        }
      },
      research_quality: over.research_quality ?? null,
      ...over.specExtras
    }
  };
}

// ── 1. Empty store → all-zero snapshot ─────────────────────────────
it("empty store: snapshot has zero counts and empty maps", () => {
  const snap = getRoutingDistribution({ store: makeStore() });
  assert.equal(snap.window.total_tasks, 0);
  assert.deepEqual(snap.by_executor, {});
  assert.deepEqual(snap.by_goal, {});
  assert.deepEqual(snap.by_web_policy, {});
  assert.deepEqual(snap.by_routing_status, {});
  assert.equal(snap.routing_degraded_count, 0);
  assert.deepEqual(snap.by_task_status, {});
  assert.deepEqual(snap.by_violation_kind, {});
  assert.deepEqual(snap.by_runbook_suggested, {});
  assert.equal(snap.tasks_with_research_quality, 0);
  assert.deepEqual(snap.by_research_profile, {});
});

// ── 2. Per-executor / per-goal / per-web_policy counts ─────────────
it("counts split correctly across executors, goals, web policies", () => {
  const tasks = [
    makeTask({ executor: "fast", goal: "qa", web_mode: "forbidden" }),
    makeTask({ executor: "fast", goal: "qa", web_mode: "forbidden" }),
    makeTask({ executor: "tool_using", goal: "search_and_answer", web_mode: "required" }),
    makeTask({ executor: "agentic", goal: "generate_document", web_mode: "optional" })
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks }) });
  assert.equal(snap.window.total_tasks, 4);
  assert.deepEqual(snap.by_executor, { fast: 2, tool_using: 1, agentic: 1 });
  assert.deepEqual(snap.by_goal, { qa: 2, search_and_answer: 1, generate_document: 1 });
  assert.deepEqual(snap.by_web_policy, { forbidden: 2, required: 1, optional: 1 });
});

// ── 3. routing_status + routing_degraded ──────────────────────────
it("routing_status and routing_degraded counts", () => {
  const tasks = [
    makeTask({ routing_status: "ok", routing_degraded: false }),
    makeTask({ routing_status: "ok", routing_degraded: false }),
    makeTask({ routing_status: "sr_timeout", routing_degraded: true }),
    makeTask({ routing_status: "sr_no_provider", routing_degraded: true }),
    makeTask({ routing_status: "sr_disabled", routing_degraded: false }),
    makeTask({ routing_status: "sr_low_confidence", routing_degraded: false })
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks }) });
  assert.deepEqual(snap.by_routing_status, {
    ok: 2,
    sr_timeout: 1,
    sr_no_provider: 1,
    sr_disabled: 1,
    sr_low_confidence: 1
  });
  assert.equal(snap.routing_degraded_count, 2);
});

// ── 4. by_task_status: success / partial_success / failed ─────────
it("task status distribution", () => {
  const tasks = [
    makeTask({ status: "success" }),
    makeTask({ status: "success" }),
    makeTask({ status: "partial_success" }),
    makeTask({ status: "failed" }),
    makeTask({ status: "cancelled" })
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks }) });
  assert.deepEqual(snap.by_task_status, {
    success: 2,
    partial_success: 1,
    failed: 1,
    cancelled: 1
  });
});

// ── 5. research_quality counts + per-profile split ────────────────
it("research_quality presence + profile split", () => {
  const tasks = [
    makeTask({}),  // no research_quality
    makeTask({ research_quality: { profile: "single_lookup", min_sources: 1, min_distinct_domains: 1 } }),
    makeTask({ research_quality: { profile: "multi_source_research", min_sources: 3, min_distinct_domains: 2 } }),
    makeTask({ research_quality: { profile: "multi_source_research", min_sources: 3, min_distinct_domains: 2 } })
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks }) });
  assert.equal(snap.tasks_with_research_quality, 3);
  assert.deepEqual(snap.by_research_profile, {
    single_lookup: 1,
    multi_source_research: 2
  });
});

// ── 6. Audit-log walk: violation_kinds + runbook_suggested ────────
it("audit log: violation kinds and runbook suggestions are aggregated", () => {
  const tasks = [makeTask({ task_id: "t1" }), makeTask({ task_id: "t2" })];
  const audit = [
    { event_subtype: "tool_loop.phase_gate", task_id: "t1", payload: {
      violation_kinds: ["external_web_read_required_not_called", "external_web_read_insufficient_sources"]
    } },
    { event_subtype: "tool_loop.phase_gate", task_id: "t2", payload: {
      violations: [{ kind: "external_web_read_required_not_called" }]
    } },
    { event_subtype: "tool_loop.runbook_suggested", task_id: "t1", payload: {
      runbook_id: "INSUFFICIENT_RESEARCH_SOURCES"
    } },
    { event_subtype: "tool_loop.runbook_suggested", task_id: "t2", payload: {
      runbook_id: "INSUFFICIENT_RESEARCH_SOURCES"
    } },
    // Unrelated audit entry — must not be counted.
    { event_subtype: "ai.provider_resolved", task_id: "t1", payload: { provider_id: "anthropic" } }
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks, audit }) });
  assert.deepEqual(snap.by_violation_kind, {
    external_web_read_required_not_called: 2,
    external_web_read_insufficient_sources: 1
  });
  assert.deepEqual(snap.by_runbook_suggested, {
    INSUFFICIENT_RESEARCH_SOURCES: 2
  });
});

// ── 7. Audit entries for tasks OUTSIDE the window are excluded ────
it("window filter: audit entries for excluded tasks don't leak into counts", () => {
  const tasks = [
    makeTask({ task_id: "in", created_at: "2026-04-26T10:00:00Z" }),
    makeTask({ task_id: "out", created_at: "2026-04-25T10:00:00Z" })
  ];
  const audit = [
    { event_subtype: "tool_loop.phase_gate", task_id: "in",  payload: { violation_kinds: ["a"] } },
    { event_subtype: "tool_loop.phase_gate", task_id: "out", payload: { violation_kinds: ["b"] } }
  ];
  const snap = getRoutingDistribution(
    { store: makeStore({ tasks, audit }) },
    { from: "2026-04-26T00:00:00Z", to: "2026-04-26T23:59:59Z" }
  );
  assert.equal(snap.window.total_tasks, 1);
  assert.deepEqual(snap.by_violation_kind, { a: 1 },
    `out-of-window task's audit entry must NOT be counted; got ${JSON.stringify(snap.by_violation_kind)}`);
});

// ── 8. Window filter: from/to are honoured ───────────────────────
it("window filter: from + to", () => {
  const tasks = [
    makeTask({ created_at: "2026-04-25T08:00:00Z" }),
    makeTask({ created_at: "2026-04-26T10:00:00Z" }),
    makeTask({ created_at: "2026-04-27T12:00:00Z" })
  ];
  const snap = getRoutingDistribution(
    { store: makeStore({ tasks }) },
    { from: "2026-04-26T00:00:00Z", to: "2026-04-26T23:59:59Z" }
  );
  assert.equal(snap.window.total_tasks, 1);
  assert.equal(snap.window.from, "2026-04-26T00:00:00Z");
  assert.equal(snap.window.to, "2026-04-26T23:59:59Z");
});

// ── 9. Defensive shape: missing task_spec / missing tool_policy ───
it("defensive: task without task_spec defaults to 'unknown' / 'absent'", () => {
  const tasks = [
    { task_id: "x", status: "success", created_at: "2026-04-26T10:00:00Z" },  // no task_spec
    { task_id: "y", status: "success", created_at: "2026-04-26T10:00:00Z", task_spec: {} }  // empty spec
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks }) });
  assert.equal(snap.window.total_tasks, 2);
  assert.equal(snap.by_executor.unknown, 2);
  assert.equal(snap.by_goal.unknown, 2);
  assert.equal(snap.by_web_policy.absent, 2);
  assert.equal(snap.by_routing_status.unknown, 2);
});

// ── 10. formatRoutingDistribution renders a stable, readable string ─
it("formatRoutingDistribution: human-readable output with sections", () => {
  const tasks = [
    makeTask({ executor: "fast", goal: "qa", routing_status: "ok" }),
    makeTask({ executor: "tool_using", goal: "search_and_answer", routing_status: "sr_timeout", routing_degraded: true })
  ];
  const audit = [
    { event_subtype: "tool_loop.runbook_suggested", task_id: tasks[0].task_id, payload: { runbook_id: "INSUFFICIENT_RESEARCH_SOURCES" } }
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks, audit }) });
  const text = formatRoutingDistribution(snap);
  assert.match(text, /Window: .* total_tasks=2/);
  assert.match(text, /by_executor:/);
  assert.match(text, /  fast: 1/);
  assert.match(text, /  tool_using: 1/);
  assert.match(text, /by_routing_status:/);
  assert.match(text, /  ok: 1/);
  assert.match(text, /  sr_timeout: 1/);
  assert.match(text, /routing_degraded_count: 1/);
  assert.match(text, /by_runbook_suggested:/);
  assert.match(text, /  INSUFFICIENT_RESEARCH_SOURCES: 1/);
});

// ── 11. Defensive: empty / null runtime ───────────────────────────
it("defensive: missing runtime returns an empty snapshot, no throw", () => {
  const snap = getRoutingDistribution({});
  assert.equal(snap.window.total_tasks, 0);
});

it("defensive: null runtime", () => {
  const snap = getRoutingDistribution(null);
  assert.equal(snap.window.total_tasks, 0);
});

// ── 12. K5: audit entries WITHOUT task_id are excluded ─────────────
it("K5: audit entries without task_id are excluded from violation/runbook counts", () => {
  // Pre-K5 the filter was `entry.task_id && !taskIdsInWindow.has(...)`
  // which let entries WITHOUT task_id fall through and pollute the
  // counts. The correct gate excludes them entirely — un-attributed
  // audit entries can't be assigned to any window of tasks.
  const tasks = [makeTask({ task_id: "t1" })];
  const audit = [
    // Legitimate entry with matching task_id — counts.
    { event_subtype: "tool_loop.phase_gate", task_id: "t1", payload: {
      violation_kinds: ["external_web_read_required_not_called"]
    } },
    // No task_id — pre-K5 leaked into counts; post-K5 must be excluded.
    { event_subtype: "tool_loop.phase_gate", payload: {
      violation_kinds: ["should_not_appear_in_counts"]
    } },
    // Empty-string task_id — same exclusion.
    { event_subtype: "tool_loop.runbook_suggested", task_id: "", payload: {
      runbook_id: "should_not_appear_either"
    } },
    // task_id null — same exclusion.
    { event_subtype: "tool_loop.runbook_suggested", task_id: null, payload: {
      runbook_id: "also_should_not_appear"
    } },
    // Legitimate runbook entry for the in-window task — counts.
    { event_subtype: "tool_loop.runbook_suggested", task_id: "t1", payload: {
      runbook_id: "INSUFFICIENT_RESEARCH_SOURCES"
    } }
  ];
  const snap = getRoutingDistribution({ store: makeStore({ tasks, audit }) });
  assert.deepEqual(snap.by_violation_kind, {
    external_web_read_required_not_called: 1
  }, `audit entries without task_id must NOT be counted; got ${JSON.stringify(snap.by_violation_kind)}`);
  assert.deepEqual(snap.by_runbook_suggested, {
    INSUFFICIENT_RESEARCH_SOURCES: 1
  }, `runbook entries without task_id must NOT be counted; got ${JSON.stringify(snap.by_runbook_suggested)}`);
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
