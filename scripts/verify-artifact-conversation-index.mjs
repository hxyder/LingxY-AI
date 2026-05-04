#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createSqliteStore } from "../src/service/core/store/sqlite-store.mjs";
import { SQLITE_SCHEMA_SQL } from "../src/service/core/store/sqlite-schema.mjs";
import {
  applyArtifactConversationIndexV1,
  MIGRATION_ID
} from "../src/service/core/store/migrations/artifact_conversation_index_v1.mjs";
import {
  applyArtifactMetadataV1,
  MIGRATION_ID as ARTIFACT_METADATA_MIGRATION_ID
} from "../src/service/core/store/migrations/artifact_metadata_v1.mjs";
import {
  applyArtifactVersioningV1,
  MIGRATION_ID as ARTIFACT_VERSIONING_MIGRATION_ID
} from "../src/service/core/store/migrations/artifact_versioning_v1.mjs";

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

function disposeDb(db, dir) {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
}

function seedTask(db, { taskId, conversationId, createdAt = "2026-05-01T10:00:00.000Z" }) {
  const taskJson = JSON.stringify({
    task_id: taskId,
    conversation_id: conversationId,
    status: "success",
    user_command: `task ${taskId}`
  });
  db.prepare(`INSERT INTO tasks
    (task_id, created_at, updated_at, status, sub_status, intent, executor,
     source_type, user_command, execution_mode, source_dedupe_key,
     context_packet_json, task_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    taskId, createdAt, createdAt, "success", "completed",
    "general", "tool_using", "clipboard", `task ${taskId}`,
    "interactive", null, "{}", taskJson
  );
}

function createOldArtifactSchemaDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-artifact-conv-index-"));
  const dbPath = path.join(dir, "uca.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_SCHEMA_SQL.tasks);
  db.exec(`CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    path TEXT NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL
  );`);
  db.exec(SQLITE_SCHEMA_SQL.schemaMigrations);
  return { db, dir, dbPath };
}

it("migration upgrades old artifacts table, backfills conversation_id, and is idempotent", () => {
  const { db, dir } = createOldArtifactSchemaDb();
  try {
    seedTask(db, { taskId: "task_a", conversationId: "conv_a" });
    seedTask(db, { taskId: "task_b", conversationId: null });
    db.prepare(`INSERT INTO artifacts
      (artifact_id, task_id, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("artifact_a", "task_a", "E:\\out\\a.docx", null, "2026-05-01T10:01:00.000Z");
    db.prepare(`INSERT INTO artifacts
      (artifact_id, task_id, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("artifact_b", "task_b", "E:\\out\\b.docx", null, "2026-05-01T10:02:00.000Z");

    const result = applyArtifactConversationIndexV1(db);
    assert.equal(result.applied, true);
    assert.equal(result.backfilled, 1);
    const columns = db.prepare("PRAGMA table_info(artifacts)").all().map((column) => column.name);
    assert.ok(columns.includes("conversation_id"), "conversation_id column must be added");
    assert.equal(
      db.prepare("SELECT conversation_id FROM artifacts WHERE artifact_id = ?").get("artifact_a").conversation_id,
      "conv_a"
    );
    assert.equal(
      db.prepare("SELECT conversation_id FROM artifacts WHERE artifact_id = ?").get("artifact_b").conversation_id,
      null
    );
    const index = db.prepare("PRAGMA index_list(artifacts)").all()
      .find((row) => row.name === "idx_artifacts_conversation_created");
    assert.ok(index, "conversation artifact index must exist");
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = ?").get(MIGRATION_ID));
    assert.equal(applyArtifactConversationIndexV1(db).applied, false);
  } finally {
    disposeDb(db, dir);
  }
});

it("artifact metadata migration adds stable metadata columns and defaults", () => {
  const { db, dir } = createOldArtifactSchemaDb();
  try {
    seedTask(db, { taskId: "task_meta_migration", conversationId: "conv_meta_migration" });
    db.prepare(`INSERT INTO artifacts
      (artifact_id, task_id, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run(
      "artifact_meta_migration",
      "task_meta_migration",
      "E:\\out\\migration.pdf",
      "application/pdf",
      "2026-05-01T10:04:00.000Z"
    );

    const result = applyArtifactMetadataV1(db);
    assert.equal(result.applied, true);
    assert.equal(result.backfilled, 1);
    const columns = db.prepare("PRAGMA table_info(artifacts)").all().map((column) => column.name);
    for (const column of ["kind", "source", "bytes", "sha256", "status"]) {
      assert.ok(columns.includes(column), `${column} column must be added`);
    }
    const row = db.prepare("SELECT kind, source, bytes, sha256, status FROM artifacts WHERE artifact_id = ?")
      .get("artifact_meta_migration");
    assert.equal(row.kind, "file");
    assert.equal(row.source, "generated");
    assert.equal(row.bytes, null);
    assert.equal(row.sha256, null);
    assert.equal(row.status, "unknown");
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = ?").get(ARTIFACT_METADATA_MIGRATION_ID));
    assert.equal(applyArtifactMetadataV1(db).applied, false);
  } finally {
    disposeDb(db, dir);
  }
});

it("artifact versioning migration adds lineage columns and index", () => {
  const { db, dir } = createOldArtifactSchemaDb();
  try {
    seedTask(db, { taskId: "task_version_migration", conversationId: "conv_version_migration" });
    db.prepare(`INSERT INTO artifacts
      (artifact_id, task_id, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run(
      "artifact_version_migration",
      "task_version_migration",
      "E:\\out\\versioned.md",
      "text/markdown",
      "2026-05-01T10:08:00.000Z"
    );

    const result = applyArtifactVersioningV1(db);
    assert.equal(result.applied, true);
    const columns = db.prepare("PRAGMA table_info(artifacts)").all().map((column) => column.name);
    for (const column of ["parent_artifact_id", "revision_of", "version_label"]) {
      assert.ok(columns.includes(column), `${column} column must be added`);
    }
    const index = db.prepare("PRAGMA index_list(artifacts)").all()
      .find((row) => row.name === "idx_artifacts_revision_of_created");
    assert.ok(index, "artifact revision lookup index must exist");
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE migration_id = ?").get(ARTIFACT_VERSIONING_MIGRATION_ID));
    assert.equal(applyArtifactVersioningV1(db).applied, false);
  } finally {
    disposeDb(db, dir);
  }
});

it("registerArtifact does not hash artifact contents on the synchronous hot path", () => {
  const source = readFileSync(path.join(process.cwd(), "src/service/store/artifact-store.mjs"), "utf8");
  assert.ok(/statSync/.test(source), "registerArtifact may stat generated files for size/status");
  assert.ok(!/readFileSync/.test(source), "registerArtifact must not synchronously read artifact contents");
  assert.ok(!/createHash/.test(source), "registerArtifact must not synchronously hash artifacts");
});

it("createSqliteStore can open an old DB and expose getArtifactsForConversation", () => {
  const { db, dir, dbPath } = createOldArtifactSchemaDb();
  try {
    seedTask(db, { taskId: "task_open", conversationId: "conv_open" });
    db.prepare(`INSERT INTO artifacts
      (artifact_id, task_id, path, mime_type, created_at)
      VALUES (?, ?, ?, ?, ?)`
    ).run("artifact_open", "task_open", "E:\\out\\open.pdf", null, "2026-05-01T10:03:00.000Z");
    db.close();

    const store = createSqliteStore({ dbPath });
    try {
      assert.deepEqual(
        store.getArtifactsForConversation("conv_open").map((artifact) => artifact.path),
        ["E:\\out\\open.pdf"]
      );
      const [artifact] = store.getArtifactsForConversation("conv_open");
      assert.equal(artifact.kind, "file");
      assert.equal(artifact.source, "generated");
      assert.equal(artifact.status, "unknown");
      assert.equal(artifact.revision_of, null);
      store.appendArtifact({
        artifact_id: "artifact_revision",
        task_id: "task_open",
        path: "E:\\out\\open-v2.pdf",
        revision_of: "artifact_open",
        parent_artifact_id: "artifact_open",
        version_label: "v2",
        created_at: "2026-05-01T10:05:00.000Z"
      });
      const revision = store.getArtifactsForTask("task_open")
        .find((row) => row.artifact_id === "artifact_revision");
      assert.equal(revision.revision_of, "artifact_open");
      assert.equal(revision.parent_artifact_id, "artifact_open");
      assert.equal(revision.version_label, "v2");
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (fail > 0) {
  console.error(`${fail} artifact conversation index verification(s) failed.`);
  process.exit(1);
}
console.log(`${pass} artifact conversation index verification(s) passed.`);
