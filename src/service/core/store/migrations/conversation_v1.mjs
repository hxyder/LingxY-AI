import crypto from "node:crypto";

export const MIGRATION_ID = "conversation_v1";

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function backfillMetadata() {
  return JSON.stringify({
    backfilled: true,
    source: "tasks",
    partial: true,
    migration_version: MIGRATION_ID
  });
}

export function applyConversationV1(db) {
  const already = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE migration_id = ?"
  ).get(MIGRATION_ID);
  if (already) return { applied: false, reason: "already_applied" };

  const tx = db.transaction(() => {
    const taskRows = db.prepare(`
      SELECT
        task_id,
        json_extract(task_json, '$.conversation_id') AS conversation_id,
        user_command,
        created_at,
        status,
        json_extract(task_json, '$.result_summary')   AS result_summary,
        json_extract(task_json, '$.result.final_text') AS result_final_text,
        json_extract(task_json, '$.failure_user_message') AS failure_user_message,
        json_extract(task_json, '$.failure_category')     AS failure_category
      FROM tasks
      WHERE json_extract(task_json, '$.conversation_id') IS NOT NULL
        AND json_extract(task_json, '$.conversation_id') != ''
      ORDER BY created_at ASC
    `).all();

    const insertConv = db.prepare(`
      INSERT OR IGNORE INTO conversations
        (conversation_id, project_id, title, created_at, updated_at,
         message_count, task_count, archived, metadata_json)
      VALUES (?, NULL, NULL, ?, ?, 0, 0, 0, ?)
    `);
    const bumpConv = db.prepare(`
      UPDATE conversations
        SET message_count = message_count + ?,
            task_count    = task_count + ?,
            updated_at    = ?
      WHERE conversation_id = ?
    `);
    const seqOf = db.prepare(`
      SELECT COALESCE(MAX(seq), -1) + 1 AS next
        FROM conversation_messages
       WHERE conversation_id = ?
    `);
    const insertMsg = db.prepare(`
      INSERT INTO conversation_messages
        (message_id, conversation_id, seq, role, content, ts, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const linkTask = db.prepare(`
      INSERT OR IGNORE INTO conversation_message_tasks
        (message_id, task_id, relation, created_at) VALUES (?, ?, ?, ?)
    `);

    const seenConv = new Set();
    let messageInserts = 0;

    for (const row of taskRows) {
      if (!seenConv.has(row.conversation_id)) {
        insertConv.run(
          row.conversation_id, row.created_at, row.created_at,
          backfillMetadata()
        );
        seenConv.add(row.conversation_id);
      }

      const userMsgId = newId("msg");
      const userSeq = seqOf.get(row.conversation_id).next;
      insertMsg.run(
        userMsgId, row.conversation_id, userSeq,
        "user", row.user_command ?? "", row.created_at, null,
        backfillMetadata()
      );
      linkTask.run(userMsgId, row.task_id, "triggered", row.created_at);
      messageInserts += 1;
      let convMsgDelta = 1;
      const convTaskDelta = 1;

      const finalText = (typeof row.result_summary === "string" && row.result_summary.trim())
        ? row.result_summary
        : (typeof row.result_final_text === "string" && row.result_final_text.trim())
          ? row.result_final_text
          : null;

      if (row.status === "success" && finalText) {
        const asstId = newId("msg");
        const asstSeq = seqOf.get(row.conversation_id).next;
        insertMsg.run(
          asstId, row.conversation_id, asstSeq,
          "assistant", finalText, row.created_at, "ok",
          backfillMetadata()
        );
        linkTask.run(asstId, row.task_id, "answered_by", row.created_at);
        messageInserts += 1;
        convMsgDelta += 1;
      } else if (row.status && row.status !== "success" && row.status !== "queued") {
        const sysId = newId("msg");
        const sysSeq = seqOf.get(row.conversation_id).next;
        const sysContent = row.status === "cancelled"
          ? "Task was cancelled."
          : row.status === "partial_success"
            ? `Task partially succeeded: ${row.failure_user_message ?? "see task for details"}`
            : `Task ended with status=${row.status}: ${row.failure_user_message ?? row.failure_category ?? "no detail"}`;
        insertMsg.run(
          sysId, row.conversation_id, sysSeq,
          "system", sysContent, row.created_at, row.status,
          backfillMetadata()
        );
        linkTask.run(sysId, row.task_id, "answered_by", row.created_at);
        messageInserts += 1;
        convMsgDelta += 1;
      }

      bumpConv.run(convMsgDelta, convTaskDelta, row.created_at, row.conversation_id);
    }

    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at, notes) VALUES (?, ?, ?)
    `).run(
      MIGRATION_ID,
      nowIso(),
      `backfilled ${taskRows.length} tasks across ${seenConv.size} conversations; inserted ${messageInserts} messages`
    );

    return { taskCount: taskRows.length, conversationCount: seenConv.size, messageCount: messageInserts };
  });

  const result = tx();
  return { applied: true, ...result };
}
