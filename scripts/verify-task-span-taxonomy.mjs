#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { buildTaskTraceSummary } from "../src/shared/task-trace-summary.mjs";
import {
  buildTaskSpanExport,
  classifyTaskTraceEvent
} from "../src/shared/task-span-taxonomy.mjs";

const taxonomy = readFileSync("src/shared/task-span-taxonomy.mjs", "utf8");
const summary = readFileSync("src/shared/task-trace-summary.mjs", "utf8");
const tests = readFileSync("tests/behavior/task-span-taxonomy.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const manifest = readFileSync("scripts/check-manifest.mjs", "utf8");

for (const required of [
  "TASK_SPAN_TAXONOMY_SCHEMA_VERSION",
  "TASK_TRACE_PHASES",
  "classifyTaskTraceEvent",
  "normalizeTaskTraceSpan",
  "buildTaskSpanExport",
  "local_otel_span_v1",
  "planning.decision",
  "model.call",
  "tool.call",
  "artifact.event",
  "approval.decision",
  "recovery.event"
]) {
  assert.match(taxonomy, new RegExp(required), `span taxonomy missing ${required}`);
}

for (const required of [
  "classifyTaskTraceEvent",
  "normalizeTaskTraceSpan",
  "TASK_TRACE_PHASES",
  "TASK_TRACE_PHASE_LABELS"
]) {
  assert.match(summary, new RegExp(required), `trace summary must consume taxonomy: ${required}`);
}

for (const required of [
  "stable task event phases",
  "normalized span names",
  "local_otel_span_v1"
]) {
  assert.match(tests, new RegExp(required), `span taxonomy tests missing ${required}`);
}

assert.equal(classifyTaskTraceEvent("llm_usage").span_name, "model.call");
const trace = buildTaskTraceSummary([
  { ts: "2026-05-12T00:00:00.000Z", event_type: "tool_call_started", payload: { tool_id: "read_file", tool_call_id: "a" } },
  { ts: "2026-05-12T00:00:00.100Z", event_type: "tool_call_completed", payload: { tool_id: "read_file", tool_call_id: "a", success: true } },
  { ts: "2026-05-12T00:00:00.200Z", event_type: "llm_usage", payload: { call_site: "planner", provider_id: "openai" } }
]);
const exported = buildTaskSpanExport(trace, { taskId: "task_taxonomy" });
assert.equal(exported.span_count, 2);
assert.equal(exported.spans[0].name, "tool.call");
assert.equal(exported.spans[1].name, "model.call");
assert.ok(!taxonomy.includes("fetch("), "span taxonomy must not export OTEL over network");

assert.match(roadmap, /OQ-002: Span Taxonomy And Optional OTEL Export/u,
  "roadmap must keep OQ-002 section");
assert.match(roadmap, /src\/shared\/task-span-taxonomy\.mjs/u,
  "roadmap must document span taxonomy implementation");

const command = "node scripts/verify-task-span-taxonomy.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include span taxonomy verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include span taxonomy verifier");
assert.match(manifest, /node scripts\/verify-task-span-taxonomy\.mjs/u,
  "manifest text must include span taxonomy verifier");

console.log("[verify-task-span-taxonomy] task span taxonomy contract OK");
