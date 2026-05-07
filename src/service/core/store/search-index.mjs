// Cross-source FTS5 search index. Codex review (2026-05-03):
// - Tokenize via unicode61 + pre-split CJK chars in the application layer
//   so 2-char Chinese keywords match (FTS5 `trigram` requires 3+ chars).
// - Write through the application's mutators (notes-store / sqlite-store
//   on insert / update / delete / restore) rather than DB triggers; gives
//   us deterministic behaviour against soft-delete and easier debugging.
// - Schema is intentionally minimal — the FTS table holds source_type +
//   source_id so result rendering reads canonical title/body from the
//   actual store, which avoids stale-copy drift when the user edits.

const CJK_RE = /[㐀-䶿一-鿿぀-ゟ゠-ヿ]/g;

export function splitCjk(value) {
  // Insert spaces around every CJK codepoint so unicode61 tokenises each
  // ideograph / kana into its own token. Latin words stay untouched.
  return String(value ?? "").replace(CJK_RE, (c) => ` ${c} `);
}

export function normalisePhraseQuery(query) {
  // FTS5's MATCH syntax is powerful but exposing it directly to users is a
  // UX trap (`"`, `*`, `^` all change semantics). Translate user input into
  // a safe MATCH expression: split on whitespace, strip FTS5 metacharacters,
  // require every token (AND), and prefix-match. Quoted spans become FTS5
  // phrase queries.
  const raw = String(query ?? "").trim();
  if (!raw) return "";
  const tokens = [];
  // Pull out "quoted phrases" first.
  const phraseRe = /"([^"]+)"/g;
  let consumed = "";
  let m;
  while ((m = phraseRe.exec(raw)) !== null) {
    const phrase = m[1].trim();
    if (phrase) tokens.push(`"${splitCjk(phrase).trim().replace(/"/g, "")}"`);
    consumed = `${consumed}${raw.slice(0, m.index)} `;
  }
  const remainder = raw.replace(phraseRe, " ");
  for (const word of remainder.split(/\s+/).filter(Boolean)) {
    const safe = splitCjk(word).trim()
      // FTS5 reserved tokens stripped (we already control quotes via the
      // phrase loop). Keep `*` so prefix queries are at least theoretically
      // possible, but never inject them ourselves.
      .replace(/[():"]/g, "");
    if (!safe) continue;
    tokens.push(safe);
  }
  return tokens.join(" ");
}

const SOURCE_TYPES = Object.freeze(["note", "task", "conversation"]);

export function isValidSourceType(value) {
  return SOURCE_TYPES.includes(value);
}

export function createSearchIndex(db) {
  const upsertStmt = db.prepare(`INSERT INTO unified_search_index
    (title, body, source_type, source_id, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const deleteStmt = db.prepare(
    `DELETE FROM unified_search_index WHERE source_type = ? AND source_id = ?`
  );
  const clearStmt = db.prepare(`DELETE FROM unified_search_index`);

  function upsert({ source_type, source_id, title, body, updated_at = "", deleted_at = "" }) {
    if (!isValidSourceType(source_type) || !source_id) return false;
    deleteStmt.run(source_type, String(source_id));
    upsertStmt.run(
      splitCjk(title),
      splitCjk(body),
      source_type,
      String(source_id),
      String(updated_at ?? ""),
      String(deleted_at ?? "")
    );
    return true;
  }

  function remove(source_type, source_id) {
    if (!isValidSourceType(source_type) || !source_id) return false;
    return deleteStmt.run(source_type, String(source_id)).changes > 0;
  }

  function clear() {
    clearStmt.run();
  }

  function search({
    q = "",
    scope = SOURCE_TYPES,
    includeDeleted = false,
    limit = 30
  } = {}) {
    const matchExpr = normalisePhraseQuery(q);
    if (!matchExpr) return [];
    // Codex review: an explicit empty scope means "search nothing" and is
    // the correct empty result, not a fallback to all sources. Only fall
    // back to SOURCE_TYPES when the caller did not supply scope at all.
    if (Array.isArray(scope) && scope.length === 0) return [];
    const validScope = Array.isArray(scope) && scope.length > 0
      ? scope.filter(isValidSourceType)
      : SOURCE_TYPES;
    if (validScope.length === 0) return [];
    const cap = Math.max(1, Math.min(100, Number(limit) || 30));
    const placeholders = validScope.map(() => "?").join(",");
    const deletedClause = includeDeleted
      ? ""
      : ` AND (deleted_at IS NULL OR deleted_at = '')`;
    const sql = `SELECT
        source_type,
        source_id,
        updated_at,
        deleted_at,
        snippet(unified_search_index, 0, '<mark>', '</mark>', '...', 16) AS title_snippet,
        snippet(unified_search_index, 1, '<mark>', '</mark>', '...', 32) AS body_snippet,
        rank
      FROM unified_search_index
      WHERE unified_search_index MATCH ?
        AND source_type IN (${placeholders})
        ${deletedClause}
      ORDER BY rank
      LIMIT ?`;
    const stmt = db.prepare(sql);
    return stmt.all(matchExpr, ...validScope, cap).map((row) => ({
      source_type: row.source_type,
      source_id: row.source_id,
      updated_at: row.updated_at || null,
      deleted_at: row.deleted_at || null,
      title_snippet: cleanSnippet(row.title_snippet),
      body_snippet: cleanSnippet(row.body_snippet),
      rank: row.rank
    }));
  }

  return { upsert, remove, clear, search };
}

function cleanSnippet(value) {
  // The CJK-split inserts space around each ideograph, which leaks into
  // FTS5's snippet output. We:
  //   1. Collapse "<mark>X</mark>" leading/trailing spaces around the mark.
  //   2. Merge adjacent <mark>X</mark><space>+<mark>Y</mark> spans into
  //      one <mark>XY</mark> so 2-char Chinese keywords render as a single
  //      highlighted phrase rather than two separate ideograph marks.
  //   3. Collapse the leftover whitespace pattern that the splitter
  //      created between contiguous CJK characters.
  return String(value ?? "")
    .replace(/<mark>\s+/g, "<mark>")
    .replace(/\s+<\/mark>/g, "</mark>")
    .replace(/<\/mark>\s*<mark>/g, "")
    .replace(/(?<=[一-鿿぀-ヿ])\s+(?=[一-鿿぀-ヿ])/g, "")
    .replace(/\s{2,}/g, " ");
}

export function rebuildSearchIndex({ index, runtime }) {
  if (!index || !runtime) return { rebuilt: 0 };
  index.clear();
  let rebuilt = 0;
  // Notes
  const notes = runtime.notesStore?.listNotes?.({ deleted: "any" }) ?? [];
  for (const note of notes) {
    if (index.upsert({
      source_type: "note",
      source_id: note.id,
      title: note.title ?? "",
      body: stripHtml(note.body_html ?? ""),
      updated_at: note.updated_at ?? note.created_at ?? "",
      deleted_at: note.deleted_at ?? ""
    })) rebuilt += 1;
  }
  // Tasks (metadata only — events are not indexed)
  const tasks = runtime.store?.listTasks?.({ deleted: "any" }) ?? [];
  for (const task of tasks) {
    if (index.upsert({
      source_type: "task",
      source_id: task.task_id,
      title: task.intent ?? task.user_command?.slice(0, 80) ?? "",
      body: task.user_command ?? "",
      updated_at: task.updated_at ?? task.created_at ?? "",
      deleted_at: task.deleted_at ?? ""
    })) rebuilt += 1;
  }
  // Conversations (title + most recent message text if available)
  const conversations = runtime.store?.listConversations?.({ limit: 10_000, archived: 1 }) ?? [];
  for (const convo of conversations) {
    if (index.upsert({
      source_type: "conversation",
      source_id: convo.conversation_id,
      title: convo.title ?? "",
      body: convo.summary ?? convo.last_message_preview ?? "",
      updated_at: convo.updated_at ?? convo.created_at ?? "",
      deleted_at: convo.deleted_at ?? ""
    })) rebuilt += 1;
  }
  return { rebuilt };
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ");
}

// Convenience adapters used by mutator hooks. These accept a runtime so the
// route layer can pass it once and not have to know whether searchIndex is
// available. Missing index / record / id is silently treated as a no-op
// because the index is best-effort — startup rebuild covers any miss.
export function indexNote(runtime, note) {
  if (!runtime?.searchIndex || !note?.id) return;
  runtime.searchIndex.upsert({
    source_type: "note",
    source_id: note.id,
    title: note.title ?? "",
    body: stripHtml(note.body_html ?? ""),
    updated_at: note.updated_at ?? note.created_at ?? "",
    deleted_at: note.deleted_at ?? ""
  });
}

export function unindexNote(runtime, id) {
  if (!runtime?.searchIndex || !id) return;
  runtime.searchIndex.remove("note", id);
}

export function reindexNotesArray(runtime, notes) {
  if (!runtime?.searchIndex) return;
  for (const note of notes ?? []) indexNote(runtime, note);
}

export function indexTask(runtime, task) {
  if (!runtime?.searchIndex || !task?.task_id) return;
  runtime.searchIndex.upsert({
    source_type: "task",
    source_id: task.task_id,
    title: task.intent ?? task.user_command?.slice(0, 80) ?? "",
    body: task.user_command ?? "",
    updated_at: task.updated_at ?? task.created_at ?? "",
    deleted_at: task.deleted_at ?? ""
  });
}

export function unindexTask(runtime, taskId) {
  if (!runtime?.searchIndex || !taskId) return;
  runtime.searchIndex.remove("task", taskId);
}

export function indexConversation(runtime, conversation) {
  if (!runtime?.searchIndex || !conversation?.conversation_id) return;
  runtime.searchIndex.upsert({
    source_type: "conversation",
    source_id: conversation.conversation_id,
    title: conversation.title ?? "",
    body: conversation.summary ?? conversation.last_message_preview ?? "",
    updated_at: conversation.updated_at ?? conversation.created_at ?? "",
    deleted_at: conversation.deleted_at ?? ""
  });
}

export function unindexConversation(runtime, conversationId) {
  if (!runtime?.searchIndex || !conversationId) return;
  runtime.searchIndex.remove("conversation", conversationId);
}

export const __test__ = { splitCjk, normalisePhraseQuery, cleanSnippet, SOURCE_TYPES };
