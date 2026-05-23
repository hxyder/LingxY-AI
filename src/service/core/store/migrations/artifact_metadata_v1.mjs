export const MIGRATION_ID = "artifact_metadata_v1";

function nowIso() {
  return new Date().toISOString();
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

export function applyArtifactMetadataV1(db) {
  const already = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE migration_id = ?"
  ).get(MIGRATION_ID);
  if (already) return { applied: false, reason: "already_applied" };

  const tx = db.transaction(() => {
    const columns = [
      ["kind", "TEXT"],
      ["source", "TEXT"],
      ["bytes", "INTEGER"],
      ["sha256", "TEXT"],
      ["status", "TEXT"]
    ];
    for (const [name, type] of columns) {
      if (!hasColumn(db, "artifacts", name)) {
        db.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type}`);
      }
    }

    const result = db.prepare(`
      UPDATE artifacts
         SET kind = COALESCE(NULLIF(kind, ''), 'file'),
             source = COALESCE(NULLIF(source, ''), 'generated'),
             status = COALESCE(NULLIF(status, ''), 'unknown')
       WHERE kind IS NULL OR kind = ''
          OR source IS NULL OR source = ''
          OR status IS NULL OR status = ''
    `).run();

    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at, notes) VALUES (?, ?, ?)
    `).run(
      MIGRATION_ID,
      nowIso(),
      `backfilled ${result.changes ?? 0} artifact metadata rows`
    );

    return { backfilled: result.changes ?? 0 };
  });

  const result = tx();
  return { applied: true, ...result };
}
