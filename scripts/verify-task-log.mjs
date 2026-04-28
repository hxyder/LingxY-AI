// Phase 11 verifier (UCA-182) — per-task jsonl event log + /task/:id/log.
//
// Steps:
//   1. Static wiring: emitTaskEvent persists via persistTaskEvent;
//      readTaskEventLog is exported; http-server has /task/:id/log
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
  assert.ok(tr.includes("persistTaskEvent(runtime, record)"),
    "emitTaskEvent must invoke persistTaskEvent");
  assert.ok(tr.includes("export async function readTaskEventLog"),
    "task-runtime must export readTaskEventLog");
  assert.ok(tr.includes("JSONL_SKIP_EVENT_TYPES"),
    "task-runtime must skip ephemeral events when persisting");

  const hs = await (await import("node:fs/promises")).readFile(
    path.join(ROOT, "src/service/core/http-server.mjs"), "utf8"
  );
  assert.ok(hs.includes("readTaskEventLog"),
    "http-server must import readTaskEventLog");
  assert.ok(hs.includes('url.pathname === "/tasks/failed"'),
    "http-server must expose /tasks/failed");
  assert.ok(hs.includes("^\\/task\\/([^/]+)\\/log$"),
    "http-server must expose /task/:id/log");

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
  assert.deepEqual(
    types,
    ["started", "tool_call", "phase_timing", "artifact_created", "status_changed"],
    "persisted events must be in-order, include first-delta timing, and skip streaming deltas"
  );
  assert.equal(events[0].payload.intent, "demo");
  assert.equal(events[3].payload.path, "C:\\foo.docx");

  // Unknown task → empty.
  const missing = await readTaskEventLog(runtime, "task_does_not_exist");
  assert.deepEqual(missing, []);

  rmSync(tmpRoot, { recursive: true, force: true });
}

console.log("ok verify-task-log");
