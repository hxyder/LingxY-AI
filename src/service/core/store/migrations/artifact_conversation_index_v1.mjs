export const MIGRATION_ID = "artifact_conversation_index_v1";

function nowIso() {
  return new Date().toISOString();
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

export function applyArtifactConversationIndexV1(db) {
  const already = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE migration_id = ?"
  ).get(MIGRATION_ID);
  if (already) return { applied: false, reason: "already_applied" };

  const tx = db.transaction(() => {
    if (!hasColumn(db, "artifacts", "conversation_id")) {
      db.exec("ALTER TABLE artifacts ADD COLUMN conversation_id TEXT");
    }

    const result = db.prepare(`
      UPDATE artifacts
         SET conversation_id = (
           SELECT json_extract(tasks.task_json, '$.conversation_id')
             FROM tasks
            WHERE tasks.task_id = artifacts.task_id
         )
       WHERE (conversation_id IS NULL OR conversation_id = '')
         AND EXISTS (
           SELECT 1
             FROM tasks
            WHERE tasks.task_id = artifacts.task_id
              AND json_extract(tasks.task_json, '$.conversation_id') IS NOT NULL
              AND json_extract(tasks.task_json, '$.conversation_id') != ''
         )
    `).run();

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_created
        ON artifacts(conversation_id, created_at DESC)
    `);

    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at, notes) VALUES (?, ?, ?)
    `).run(
      MIGRATION_ID,
      nowIso(),
      `backfilled ${result.changes ?? 0} artifacts with conversation_id`
    );

    return { backfilled: result.changes ?? 0 };
  });

  const result = tx();
  return { applied: true, ...result };
}
