#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildTaskTraceSummary } from "../src/shared/task-trace-summary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const traceSummary = read("src/shared/task-trace-summary.mjs");
const taskDetailVm = read("src/desktop/console/task-detail/view-model.mjs");
const taskDetailRenderer = read("src/desktop/renderer/console-task-detail.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const css = read("src/desktop/renderer/shared-tasks.css");
const behaviorTest = read("tests/behavior/task-trace-summary.test.mjs");
const plan = read("FUNCTION_AUDIT_AND_UPGRADE_PLAN.md");

assert.match(
  traceSummary,
  /buildTaskTraceSummary/u,
  "trace summary helper should be shared and deterministic"
);
assert.match(
  traceSummary,
  /first_token_ms/u,
  "trace summary should expose first-token latency"
);
assert.match(
  traceSummary,
  /first_visible_ms/u,
  "trace summary should expose first-visible latency"
);
assert.match(
  traceSummary,
  /slowest_spans/u,
  "trace summary should expose slowest spans for diagnosis"
);
assert.match(
  traceSummary,
  /timeline/u,
  "trace summary should expose a phase timeline"
);
assert.match(
  traceSummary,
  /attention_flags/u,
  "trace summary should expose attention flags"
);
assert.match(
  taskDetailVm,
  /trace = buildTaskTraceSummary\(events\)/u,
  "task detail view-model should expose trace summary"
);
assert.match(
  taskDetailRenderer,
  /renderTaskTracePanel/u,
  "task detail renderer should include a trace panel"
);
assert.match(
  taskDetailRenderer,
  /data-task-trace-copy="1"/u,
  "trace panel should expose a copy/export control"
);
assert.match(
  taskDetailRenderer,
  /renderTraceTimeline/u,
  "trace panel should render the shared phase timeline"
);
assert.match(
  taskDetailRenderer,
  /renderTraceAttention/u,
  "trace panel should render attention flags"
);
assert.match(
  consoleJs,
  /renderTaskTracePanel\(detail\.events \?\? \[\]\)/u,
  "console task detail should render the trace panel from task events"
);
assert.match(
  consoleJs,
  /writeClipboardText\(traceJson\)/u,
  "console should wire trace export to the clipboard bridge"
);
assert.match(css, /\.task-trace-panel/u, "trace panel should have stable CSS");
assert.match(css, /\.trace-phase-list/u, "trace panel should style phase timeline rows");
assert.match(css, /\.trace-attention-pill/u, "trace panel should style attention flags");
assert.match(
  behaviorTest,
  /without raw event JSON/u,
  "behavior test should prove trace panel avoids raw event JSON dumps"
);
assert.match(
  plan,
  /FW-024[\s\S]*Trace\/timeline observability[\s\S]*PARTIAL/u,
  "upgrade plan should track FW-024 trace/timeline progress"
);

const trace = buildTaskTraceSummary([
  { ts: "2026-05-08T00:00:00.000Z", event_type: "task_created", payload: {} },
  { ts: "2026-05-08T00:00:00.050Z", event_type: "text_delta", payload: { text: "x" } },
  { ts: "2026-05-08T00:00:00.100Z", event_type: "tool_call_started", payload: { tool_id: "read_file", tool_call_id: "a" } },
  { ts: "2026-05-08T00:00:00.400Z", event_type: "tool_call_completed", payload: { tool_id: "read_file", tool_call_id: "a", success: true } },
  { ts: "2026-05-08T00:00:00.500Z", event_type: "success", payload: { text: "done" } }
]);
assert.equal(trace.duration_ms, 500);
assert.equal(trace.first_token_ms, 50);
assert.equal(trace.first_visible_ms, 500);
assert.equal(trace.tool_calls.total, 1);
assert.equal(trace.slowest_spans[0]?.label, "read_file");
assert.ok(trace.timeline.some((phase) => phase.id === "tool" && phase.count === 2));

console.log("task trace timeline verification passed");
