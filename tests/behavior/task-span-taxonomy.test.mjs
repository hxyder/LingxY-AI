import test from "node:test";
import assert from "node:assert/strict";

import { buildTaskTraceSummary } from "../../src/shared/task-trace-summary.mjs";
import {
  TASK_TRACE_PHASES,
  buildTaskSpanExport,
  classifyTaskTraceEvent
} from "../../src/shared/task-span-taxonomy.mjs";

test("task span taxonomy classifies stable task event phases", () => {
  assert.deepEqual(TASK_TRACE_PHASES, [
    "lifecycle",
    "planning",
    "model",
    "tool",
    "artifact",
    "approval",
    "recovery",
    "system"
  ]);
  assert.equal(classifyTaskTraceEvent("task_created").phase, "lifecycle");
  assert.equal(classifyTaskTraceEvent("context_compiled").span_name, "planning.decision");
  assert.equal(classifyTaskTraceEvent("llm_usage").span_name, "model.call");
  assert.equal(classifyTaskTraceEvent("tool_call_completed").span_name, "tool.call");
  assert.equal(classifyTaskTraceEvent("artifact_created").phase, "artifact");
  assert.equal(classifyTaskTraceEvent("pending_approval_created").phase, "approval");
  assert.equal(classifyTaskTraceEvent("tool_call_completed", { success: false }).phase, "tool");
  assert.equal(classifyTaskTraceEvent("custom_step", { success: false }).phase, "recovery");
});

test("task trace summary attaches normalized span names for local export", () => {
  const trace = buildTaskTraceSummary([
    { ts: "2026-05-12T10:00:00.000Z", event_type: "task_created", payload: {} },
    { ts: "2026-05-12T10:00:00.010Z", event_type: "tool_call_started", payload: { tool_id: "read_file", tool_call_id: "c1" } },
    { ts: "2026-05-12T10:00:00.040Z", event_type: "tool_call_completed", payload: { tool_id: "read_file", tool_call_id: "c1", success: true } },
    { ts: "2026-05-12T10:00:00.050Z", event_type: "llm_usage", payload: { call_site: "final_composer", provider_id: "openai", model: "gpt-5.4-mini" } }
  ]);

  assert.equal(trace.spans[0].name, "tool.call");
  assert.equal(trace.spans[0].phase, "tool");
  assert.equal(trace.spans[1].name, "model.call");
  assert.equal(trace.spans[1].phase, "model");

  const spanExport = buildTaskSpanExport(trace, { taskId: "task_1" });
  assert.equal(spanExport.export_shape, "local_otel_span_v1");
  assert.equal(spanExport.task_id, "task_1");
  assert.equal(spanExport.spans[0].name, "tool.call");
  assert.equal(spanExport.spans[0].attributes.label, "read_file");
});
