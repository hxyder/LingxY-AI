import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  flushTaskLogs,
  persistTaskEvent,
  readTaskEventLog,
  resetTaskLogStateForTests,
  rotateTaskLogs
} from "../../src/service/core/task-runtime/event-log.mjs";

function withTempLogsDir() {
  const root = mkdtempSync(path.join(tmpdir(), "lingxy-event-log-"));
  return {
    root,
    runtime: { paths: { logsDir: root } },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("event-log writer serializes same-task writes and skips streaming deltas", async () => {
  resetTaskLogStateForTests();
  const { root, runtime, cleanup } = withTempLogsDir();
  try {
    persistTaskEvent(runtime, { event_id: "1", task_id: "task_a", event_type: "started", payload: { order: 1 } });
    persistTaskEvent(runtime, { event_id: "skip", task_id: "task_a", event_type: "text_delta", payload: { delta: "skip" } });
    persistTaskEvent(runtime, { event_id: "2", task_id: "task_a", event_type: "artifact_created", payload: { order: 2 } });

    await flushTaskLogs();

    const events = await readTaskEventLog(runtime, "task_a");
    assert.deepEqual(events.map((event) => event.event_id), ["1", "2"]);
    assert.deepEqual(events.map((event) => event.payload.order), [1, 2]);
    assert.ok(await stat(path.join(root, "tasks", "task_a.jsonl")));
  } finally {
    cleanup();
  }
});

test("event-log reader tolerates missing files and malformed jsonl lines", async () => {
  resetTaskLogStateForTests();
  const { root, runtime, cleanup } = withTempLogsDir();
  try {
    assert.deepEqual(await readTaskEventLog(runtime, "missing"), []);

    const dir = path.join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    writeFileSync(
      path.join(dir, "task_bad.jsonl"),
      "{\"event_id\":\"ok\",\"task_id\":\"task_bad\",\"event_type\":\"started\",\"payload\":{}}\nnot-json\n",
      "utf8"
    );

    const events = await readTaskEventLog(runtime, "task_bad");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_id, "ok");
  } finally {
    cleanup();
  }
});

test("event-log rotation removes oldest task logs first", async () => {
  resetTaskLogStateForTests();
  const { root, cleanup } = withTempLogsDir();
  try {
    const dir = path.join(root, "tasks");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    const names = ["oldest.jsonl", "middle.jsonl", "newest.jsonl"];
    for (const [index, name] of names.entries()) {
      const file = path.join(dir, name);
      writeFileSync(file, `${name}\n`, "utf8");
      const time = new Date(2026, 0, index + 1);
      await utimes(file, time, time);
    }

    await rotateTaskLogs(dir, { maxFiles: 2 });

    const remaining = (await readdir(dir)).sort();
    assert.deepEqual(remaining, ["middle.jsonl", "newest.jsonl"]);
  } finally {
    cleanup();
  }
});
