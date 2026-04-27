#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SQLITE_SCHEMA_SQL, SQLITE_INDEX_SQL } from "../src/service/core/store/sqlite-schema.mjs";
import { applyConversationV1, MIGRATION_ID } from "../src/service/core/store/migrations/conversation_v1.mjs";

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

function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-conv-mig-"));
  const dbPath = path.join(dir, "uca.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const sql of Object.values(SQLITE_SCHEMA_SQL)) db.exec(sql);
  for (const sql of SQLITE_INDEX_SQL) db.exec(sql);
  return { db, dir, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function seedTask(db, { task_id, conversation_id, user_command, status, result_summary = null, parent_task_id = null, created_at }) {
  const taskJson = JSON.stringify({
    task_id,
    conversation_id,
    parent_task_id,
    result_summary,
    failure_user_message: status !== "success" ? "synthetic failure" : null,
    failure_category: status !== "success" ? "test_failure" : null
  });
  db.prepare(`INSERT INTO tasks
    (task_id, created_at, updated_at, status, sub_status, intent, executor,
     source_type, user_command, execution_mode, source_dedupe_key,
     context_packet_json, task_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task_id, created_at, created_at, status, status,
    "general", "tool_using", "clipboard", user_command, "interactive",
    null, "{}", taskJson
  );
}

it("backfill: empty tasks table → migration runs once, records version row, no messages", () => {
  const { db, dispose } = freshDb();
  try {
    const r = applyConversationV1(db);
    assert.equal(r.applied, true);
    assert.equal(r.taskCount, 0);
    const row = db.prepare("SELECT * FROM schema_migrations WHERE migration_id = ?").get(MIGRATION_ID);
    assert.ok(row, "schema_migrations row must be inserted");
    const r2 = applyConversationV1(db);
    assert.equal(r2.applied, false, "second run must early-exit");
  } finally { dispose(); }
});

it("backfill: success task → user message + assistant message + 'triggered'/'answered_by' links", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_s1",
      conversation_id: "conv_a",
      user_command: "天气怎么样",
      status: "success",
      result_summary: "今天 21 度",
      created_at: "2026-04-26T10:00:00.000Z"
    });
    applyConversationV1(db);

    const conv = db.prepare("SELECT * FROM conversations WHERE conversation_id = ?").get("conv_a");
    assert.ok(conv, "conversation row must be inserted");
    assert.equal(conv.message_count, 2);
    assert.equal(conv.task_count, 1);

    const msgs = db.prepare(
      "SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY seq"
    ).all("conv_a");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[0].content, "天气怎么样");
    assert.equal(msgs[0].seq, 0);
    assert.equal(msgs[1].role, "assistant");
    assert.equal(msgs[1].content, "今天 21 度");
    assert.equal(msgs[1].status, "ok");
    assert.equal(msgs[1].seq, 1);

    const meta = JSON.parse(msgs[0].metadata_json);
    assert.equal(meta.backfilled, true);
    assert.equal(meta.partial, true);
    assert.equal(meta.migration_version, MIGRATION_ID);

    const links = db.prepare(
      "SELECT relation FROM conversation_message_tasks WHERE task_id = ? ORDER BY relation"
    ).all("task_s1");
    assert.deepEqual(links.map((l) => l.relation).sort(), ["answered_by", "triggered"]);
  } finally { dispose(); }
});

it("backfill: failed task → user message + system status message", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_f1",
      conversation_id: "conv_b",
      user_command: "do impossible",
      status: "failed",
      created_at: "2026-04-26T11:00:00.000Z"
    });
    applyConversationV1(db);
    const msgs = db.prepare(
      "SELECT role, status, content FROM conversation_messages WHERE conversation_id = ? ORDER BY seq"
    ).all("conv_b");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "system");
    assert.equal(msgs[1].status, "failed");
    assert.match(msgs[1].content, /Task ended with status=failed/);
  } finally { dispose(); }
});

it("backfill: cancelled task → system status with cancellation copy", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_c1",
      conversation_id: "conv_c",
      user_command: "stop",
      status: "cancelled",
      created_at: "2026-04-26T12:00:00.000Z"
    });
    applyConversationV1(db);
    const sys = db.prepare(
      "SELECT * FROM conversation_messages WHERE conversation_id = ? AND role='system'"
    ).get("conv_c");
    assert.equal(sys.status, "cancelled");
    assert.equal(sys.content, "Task was cancelled.");
  } finally { dispose(); }
});

it("backfill: success without result_summary → only user message (no synthetic assistant)", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_s2",
      conversation_id: "conv_d",
      user_command: "ack",
      status: "success",
      result_summary: null,
      created_at: "2026-04-26T13:00:00.000Z"
    });
    applyConversationV1(db);
    const msgs = db.prepare(
      "SELECT role FROM conversation_messages WHERE conversation_id = ? ORDER BY seq"
    ).all("conv_d");
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].role, "user");
  } finally { dispose(); }
});

it("backfill: tasks without conversation_id are skipped entirely", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_orphan",
      conversation_id: null,
      user_command: "no group",
      status: "success",
      result_summary: "ok",
      created_at: "2026-04-26T14:00:00.000Z"
    });
    applyConversationV1(db);
    const conv = db.prepare("SELECT COUNT(*) AS n FROM conversations").get();
    assert.equal(conv.n, 0);
    const msgs = db.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get();
    assert.equal(msgs.n, 0);
  } finally { dispose(); }
});

it("backfill: idempotent — re-running does not duplicate messages", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_idem",
      conversation_id: "conv_idem",
      user_command: "again",
      status: "success",
      result_summary: "fine",
      created_at: "2026-04-26T15:00:00.000Z"
    });
    applyConversationV1(db);
    const r2 = applyConversationV1(db);
    assert.equal(r2.applied, false);
    const n = db.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get();
    assert.equal(n.n, 2, "messages must not be duplicated");
  } finally { dispose(); }
});

it("backfill: message_count and task_count match per-conversation actuals", () => {
  const { db, dispose } = freshDb();
  try {
    seedTask(db, {
      task_id: "task_q1", conversation_id: "conv_q", user_command: "q1",
      status: "success", result_summary: "a1", created_at: "2026-04-26T16:00:00.000Z"
    });
    seedTask(db, {
      task_id: "task_q2", conversation_id: "conv_q", user_command: "q2",
      status: "success", result_summary: "a2", created_at: "2026-04-26T16:01:00.000Z"
    });
    seedTask(db, {
      task_id: "task_q3", conversation_id: "conv_q", user_command: "q3",
      status: "failed", created_at: "2026-04-26T16:02:00.000Z"
    });
    applyConversationV1(db);
    const conv = db.prepare("SELECT * FROM conversations WHERE conversation_id = ?").get("conv_q");
    assert.equal(conv.task_count, 3);
    assert.equal(conv.message_count, 6, "3 user + 2 assistant + 1 system = 6");
    const counts = db.prepare(
      "SELECT role, COUNT(*) AS n FROM conversation_messages WHERE conversation_id = ? GROUP BY role"
    ).all("conv_q");
    const byRole = Object.fromEntries(counts.map((c) => [c.role, c.n]));
    assert.equal(byRole.user, 3);
    assert.equal(byRole.assistant, 2);
    assert.equal(byRole.system, 1);
  } finally { dispose(); }
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
