import test from "node:test";
import assert from "node:assert/strict";

import { buildTaskDetailViewModel } from "../../src/desktop/console/task-detail/view-model.mjs";
import { renderTaskTracePanel } from "../../src/desktop/renderer/console-task-detail.mjs";
import { buildTaskTraceSummary } from "../../src/shared/task-trace-summary.mjs";

const events = [
  { event_id: "e1", ts: "2026-05-08T10:00:00.000Z", event_type: "task_created", payload: {} },
  {
    event_id: "e1b",
    ts: "2026-05-08T10:00:00.050Z",
    event_type: "skill_context_loaded",
    payload: {
      executor: "tool_using",
      active_count: 1,
      skills: [{ id: "xlsx", name: "XLSX" }],
      workflow_hints: ["spreadsheet: structured generate_document outline"]
    }
  },
  { event_id: "e2", ts: "2026-05-08T10:00:00.120Z", event_type: "text_delta", payload: { text: "hi" } },
  { event_id: "e3", ts: "2026-05-08T10:00:00.250Z", event_type: "tool_call_started", payload: { tool_id: "web_search_fetch", tool_call_id: "call_1" } },
  { event_id: "e4", ts: "2026-05-08T10:00:00.900Z", event_type: "tool_call_completed", payload: { tool_id: "web_search_fetch", tool_call_id: "call_1", success: false, error: "timeout" } },
  { event_id: "e5", ts: "2026-05-08T10:00:01.050Z", event_type: "llm_usage", payload: { call_site: "final_composer", provider_id: "openai", model: "gpt-5.4-mini" } },
  { event_id: "e6", ts: "2026-05-08T10:00:01.200Z", event_type: "partial_success", payload: { text: "Partial" } }
];

test("task trace summary derives latency, tool failures, provider calls, and slow spans", () => {
  const trace = buildTaskTraceSummary(events);

  assert.equal(trace.event_count, 7);
  assert.equal(trace.duration_ms, 1200);
  assert.equal(trace.first_token_ms, 120);
  assert.equal(trace.first_visible_ms, 1200);
  assert.equal(trace.terminal_status, "partial_success");
  assert.equal(trace.tool_calls.total, 1);
  assert.equal(trace.tool_calls.failed, 1);
  assert.equal(trace.provider_calls.total, 1);
  assert.equal(trace.skill_context.active_count, 1);
  assert.equal(trace.skill_context.skills[0].id, "xlsx");
  assert.ok(trace.timeline.some((phase) => phase.id === "planning" && phase.labels.includes("skill_context_loaded:tool_using")));
  assert.ok(trace.timeline.some((phase) => phase.id === "tool" && phase.failures === 1));
  assert.equal(trace.attention_flags[0]?.id, "tool_failures");
  assert.equal(trace.slowest_spans[0]?.label, "web_search_fetch");
});

test("task detail view-model exposes local trace summary", () => {
  const vm = buildTaskDetailViewModel({
    task_id: "task_trace",
    status: "partial_success",
    progress: 1
  }, events, []);

  assert.equal(vm.trace.duration_ms, 1200);
  assert.equal(vm.trace.tool_calls.failed, 1);
});

test("task trace panel renders diagnosis metrics without raw event JSON", () => {
  const html = renderTaskTracePanel(events);

  assert.match(html, /Task trace|Trace/);
  assert.match(html, /First token/);
  assert.match(html, /Trace phase timeline/);
  assert.match(html, /Planning · 1 event/);
  assert.match(html, /Tools · 2 events/);
  assert.match(html, /1 failed tool call/);
  assert.match(html, /web_search_fetch/);
  assert.match(html, /XLSX/);
  assert.match(html, /structured generate_document outline/);
  assert.match(html, /1 \/ 1 failed/);
  assert.match(html, /data-task-trace-copy="1"/);
  assert.match(html, /data-trace-json=/);
  assert.doesNotMatch(html, /"event_type"|tool_call_id/u);
});
