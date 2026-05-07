import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { SQLITE_SCHEMA_SQL } from "../../src/service/core/store/sqlite-schema.mjs";
import {
  createSearchIndex,
  normalisePhraseQuery,
  rebuildSearchIndex,
  splitCjk,
  __test__
} from "../../src/service/core/store/search-index.mjs";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(SQLITE_SCHEMA_SQL.unifiedSearchIndex);
  return db;
}

// ─── splitCjk ───────────────────────────────────────────────────────────────

test("splitCjk inserts spaces around CJK chars and leaves Latin alone", () => {
  assert.equal(splitCjk("hello world"), "hello world");
  // Each Han char is wrapped with surrounding spaces.
  assert.equal(splitCjk("讨论"), " 讨  论 ");
  // Mixed input still keeps Latin words contiguous.
  assert.match(splitCjk("plan 讨论 today"), /plan\s+讨\s+论\s+today/);
});

// ─── normalisePhraseQuery ─────────────────────────────────────────────────

test("normalisePhraseQuery splits keywords and quotes phrases", () => {
  assert.equal(normalisePhraseQuery(""), "");
  assert.equal(normalisePhraseQuery("  "), "");
  assert.equal(normalisePhraseQuery("alpha beta"), "alpha beta");
  // Quoted phrase becomes an FTS5 phrase query (still CJK-split inside).
  assert.equal(normalisePhraseQuery(`"plan b"`), `"plan b"`);
  // FTS5 reserved metacharacters in plain words are stripped.
  assert.equal(normalisePhraseQuery("a:b (c)"), "ab c");
  // CJK keyword split.
  assert.match(normalisePhraseQuery("讨论"), /讨\s+论/);
});

// ─── createSearchIndex CRUD ────────────────────────────────────────────────

test("upsert + search round-trip with English keyword", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({
    source_type: "note", source_id: "n1",
    title: "Today notes", body: "discussed launch plan",
    updated_at: "2026-05-01T00:00:00Z"
  });
  const hits = index.search({ q: "launch" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source_id, "n1");
  assert.match(hits[0].body_snippet, /<mark>launch<\/mark>/);
});

test("2-char Chinese keyword matches via CJK split", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({
    source_type: "note", source_id: "n1",
    title: "明日会议", body: "讨论产品发布计划",
    updated_at: "2026-05-01T00:00:00Z"
  });
  const hits = index.search({ q: "讨论" });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source_id, "n1");
  // Snippet should restore CJK contiguity.
  assert.match(hits[0].body_snippet, /<mark>讨论<\/mark>|<mark>讨<\/mark><mark>论<\/mark>/);
});

test("scope filter restricts source_type", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({ source_type: "note", source_id: "n1", title: "alpha", body: "" });
  index.upsert({ source_type: "task", source_id: "t1", title: "alpha", body: "" });
  index.upsert({ source_type: "conversation", source_id: "c1", title: "alpha", body: "" });
  const onlyNotes = index.search({ q: "alpha", scope: ["note"] });
  assert.deepEqual(onlyNotes.map((h) => h.source_type), ["note"]);
  const noteAndTask = index.search({ q: "alpha", scope: ["note", "task"] });
  assert.deepEqual(noteAndTask.map((h) => h.source_type).sort(), ["note", "task"]);
  // Empty / invalid scopes return nothing instead of falling back.
  assert.deepEqual(index.search({ q: "alpha", scope: [] }), []);
  assert.deepEqual(index.search({ q: "alpha", scope: ["bogus"] }), []);
});

test("include_deleted=false excludes soft-deleted; true includes", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({ source_type: "note", source_id: "alive", title: "alpha", body: "" });
  index.upsert({
    source_type: "note", source_id: "gone", title: "alpha", body: "",
    deleted_at: "2026-05-01T00:00:00Z"
  });
  const live = index.search({ q: "alpha" });
  assert.deepEqual(live.map((h) => h.source_id), ["alive"]);
  const all = index.search({ q: "alpha", includeDeleted: true });
  assert.deepEqual(all.map((h) => h.source_id).sort(), ["alive", "gone"]);
});

test("upsert replaces a prior entry with the same source_type+source_id", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({ source_type: "note", source_id: "n1", title: "v1 title", body: "v1 body" });
  index.upsert({ source_type: "note", source_id: "n1", title: "v2 title", body: "v2 body" });
  const hits = index.search({ q: "v2" });
  assert.equal(hits.length, 1);
  // Old version should not match.
  assert.equal(index.search({ q: "v1" }).length, 0);
});

test("remove drops the entry from results", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  index.upsert({ source_type: "note", source_id: "n1", title: "alpha", body: "" });
  assert.equal(index.search({ q: "alpha" }).length, 1);
  index.remove("note", "n1");
  assert.equal(index.search({ q: "alpha" }).length, 0);
});

test("limit caps the result set and clamps to 100", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  for (let i = 0; i < 50; i += 1) {
    index.upsert({ source_type: "note", source_id: `n${i}`, title: "alpha", body: `body ${i}` });
  }
  assert.equal(index.search({ q: "alpha", limit: 10 }).length, 10);
  assert.equal(index.search({ q: "alpha", limit: 9999 }).length, 50);
});

test("rebuildSearchIndex pulls notes / tasks / conversations from runtime stores", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  const runtime = {
    notesStore: {
      listNotes() {
        return [
          { id: "n1", title: "alpha note", body_html: "<p>hello</p>", updated_at: "2026-05-01" },
          { id: "n2", title: "deleted", body_html: "<p>x</p>", updated_at: "2026-05-02", deleted_at: "2026-05-03" }
        ];
      }
    },
    store: {
      listTasks() {
        return [
          { task_id: "t1", intent: "alpha task", user_command: "do things", updated_at: "2026-05-04" }
        ];
      },
      listConversations() {
        return [
          { conversation_id: "c1", title: "alpha chat", summary: "hello there", updated_at: "2026-05-05" }
        ];
      }
    }
  };
  const result = rebuildSearchIndex({ index, runtime });
  assert.equal(result.rebuilt, 4);
  // Live entries retrieved.
  const hits = index.search({ q: "alpha" });
  assert.deepEqual(hits.map((h) => h.source_type).sort(), ["conversation", "note", "task"]);
  // Deleted note skipped under default (includeDeleted=false).
  const liveOnly = index.search({ q: "deleted" });
  assert.equal(liveOnly.length, 0);
  const withDeleted = index.search({ q: "deleted", includeDeleted: true });
  assert.equal(withDeleted.length, 1);
});

test("invalid source_type or empty source_id is silently ignored on upsert", () => {
  const db = freshDb();
  const index = createSearchIndex(db);
  assert.equal(index.upsert({ source_type: "bogus", source_id: "x", title: "alpha", body: "" }), false);
  assert.equal(index.upsert({ source_type: "note", source_id: "", title: "alpha", body: "" }), false);
  assert.equal(index.search({ q: "alpha" }).length, 0);
});
