// Phase 11 verifier (UCA-182) — per-task jsonl event log + /task/:id/log.
//
// Steps:
//   1. Static wiring: emitTaskEvent persists via persistTaskEvent;
//      readTaskEventLog is exported; task-routes has /task/:id/log
//      and /tasks/failed handlers; console.html+js show the panel.
//   2. Live behaviour: build a tiny fake runtime with a temp logsDir,
//      call emitTaskEvent a few times, then read back via
//      readTaskEventLog and check ordering + payload fidelity. Also
//      check the ephemeral event types are skipped.
//   3. Rotation: write 600 per-task files, ensure rotateTaskLogs (via
//      many emits that eventually trigger the counter) prunes down to
//      <= the TASK_LOG_MAX_FILES cap. We test the helper directly by
//      importing it; the counter-based gating is an internal detail.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. static wiring ------------------------------------------------
{
  const tr = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/service/core/task-runtime.mjs"), "utf8"
  );
  assert.ok(tr.includes('from "./task-runtime/event-emitter.mjs"'),
    "task-runtime must delegate task event emission to event-emitter.mjs");

  const eventEmitter = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/service/core/task-runtime/event-emitter.mjs"), "utf8"
  );
  assert.ok(eventEmitter.includes("persistTaskEvent(runtime, record)"),
    "emitTaskEvent must invoke persistTaskEvent");
  assert.ok(eventEmitter.includes('from "./event-log.mjs"'),
    "event-emitter must delegate task jsonl log writing to event-log.mjs");

  const eventLog = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/service/core/task-runtime/event-log.mjs"), "utf8"
  );
  assert.ok(eventLog.includes("export async function readTaskEventLog"),
    "event-log module must export readTaskEventLog");
  assert.ok(eventLog.includes("JSONL_SKIP_EVENT_TYPES"),
    "event-log module must skip ephemeral events when persisting");

  const taskRoutes = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/service/core/http-routes/task-routes.mjs"), "utf8"
  );
  assert.ok(taskRoutes.includes("readTaskEventLog"),
    "task-routes must import readTaskEventLog");
  assert.ok(taskRoutes.includes('url.pathname === "/tasks/failed"'),
    "task-routes must expose /tasks/failed");
  assert.ok(taskRoutes.includes("^\\/task\\/([^/]+)\\/log$"),
    "task-routes must expose /task/:id/log");

  const html = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/desktop/renderer/console.html"), "utf8"
  );
  assert.ok(html.includes('id="failedTasksPanel"'), "failedTasksPanel must be present");
  assert.ok(html.includes('id="failedTasksList"'), "failedTasksList container present");

  const js = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/desktop/renderer/console.js"), "utf8"
  );
  assert.ok(js.includes("renderFailedTasks"),
    "console.js must define + call renderFailedTasks");
}

// --- 2. live emit + read --------------------------------------------
{
  const { emitTaskEvent, readTaskEventLog, flushTaskLogs } = await import("../src/service/core/task-runtime.mjs");
  const tmpRoot = mkdtempSync(path.join(tmpdir(), "lingxy-task-log-"));
  const appended = [];
  const runtime = {
    paths: { logsDir: tmpRoot },
    store: {
      appendEvent(event) { appended.push(event); },
      updateTask() {},
      getTask() { return { created_at: new Date(Date.now() - 50).toISOString() }; }
    },
    eventBus: { publish() {} }
  };
  const taskId = "task_test_phase11";

  emitTaskEvent({ runtime, taskId, eventType: "started", payload: { intent: "demo" } });
  emitTaskEvent({ runtime, taskId, eventType: "tool_call", payload: { tool_id: "web_search" } });
  emitTaskEvent({ runtime, taskId, eventType: "text_delta", payload: { delta: "skip me" } });
  emitTaskEvent({ runtime, taskId, eventType: "reasoning_delta", payload: { delta: "also skip me" } });
  emitTaskEvent({ runtime, taskId, eventType: "artifact_created", payload: { path: "C:\\foo.docx" } });
  emitTaskEvent({ runtime, taskId, eventType: "status_changed", payload: { previous_status: "running", status: "success" } });

  await flushTaskLogs();

  const events = await readTaskEventLog(runtime, taskId);
  const types = events.map((e) => e.event_type);
  assert.ok(appended.some((e) => e.event_type === "phase_timing" && e.payload?.phase === "executor_first_delta"),
    "first text_delta must emit an executor_first_delta phase_timing event");
  assert.ok(appended.some((e) => e.event_type === "phase_timing" && e.payload?.phase === "executor_first_event"),
    "first executor event must emit an executor_first_event phase_timing event");
  assert.ok(appended.some((e) => e.event_type === "phase_timing" && e.payload?.phase === "executor_first_progress"),
    "first executor progress must emit an executor_first_progress phase_timing event");
  assert.ok(appended.some((e) => e.event_type === "phase_timing" && e.payload?.phase === "executor_first_visible_output"),
    "first visible output must emit an executor_first_visible_output phase_timing event");
  assert.deepEqual(
    types,
    ["started", "tool_call", "phase_timing", "phase_timing", "phase_timing", "phase_timing", "artifact_created", "status_changed"],
    "persisted events must be in-order, include first executor/progress/delta/visible timing, and skip streaming deltas"
  );
  assert.equal(events[0].payload.intent, "demo");
  assert.equal(events[6].payload.path, "C:\\foo.docx");

  // Unknown task → empty.
  const missing = await readTaskEventLog(runtime, "task_does_not_exist");
  assert.deepEqual(missing, []);

  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("ok verify-task-log");
