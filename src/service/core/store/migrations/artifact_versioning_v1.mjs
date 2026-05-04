export const MIGRATION_ID = "artifact_versioning_v1";

function nowIso() {
  return new Date().toISOString();
}

function hasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

export function applyArtifactVersioningV1(db) {
  const already = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE migration_id = ?"
  ).get(MIGRATION_ID);
  if (already) return { applied: false, reason: "already_applied" };

  const tx = db.transaction(() => {
    const columns = [
      ["parent_artifact_id", "TEXT"],
      ["revision_of", "TEXT"],
      ["version_label", "TEXT"]
    ];
    let added = 0;
    for (const [name, type] of columns) {
      if (!hasColumn(db, "artifacts", name)) {
        db.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type}`);
        added += 1;
      }
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_artifacts_revision_of_created
      ON artifacts (revision_of, created_at DESC)
    `);

    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at, notes) VALUES (?, ?, ?)
    `).run(
      MIGRATION_ID,
      nowIso(),
      `added ${added} artifact versioning column(s)`
    );

    return { added };
  });

  const result = tx();
  return { applied: true, ...result };
}
