import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";
import {
  SESSION_ITEM_KINDS,
  createConversationSessionService
} from "../../src/service/core/session/conversation-session-service.mjs";
import {
  SESSION_COMPACTION_SCHEMA_VERSION,
  createSessionCompactionService
} from "../../src/service/core/session/session-compaction-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../../src/service/core/store/sqlite-store.mjs";

function withSqliteStore(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lingxy-session-compaction-"));
  const store = createSqliteStore({ dbPath: path.join(dir, "store.sqlite") });
  try {
    fn(store);
  } finally {
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
}

function runForBothStores(label, fn) {
  test(`memory: ${label}`, () => fn(createInMemoryStoreScaffold()));
  test(`sqlite: ${label}`, () => withSqliteStore(fn));
}

function seedSession(store) {
  store.insertConversation({ conversation_id: "conv_compact", project_id: "proj_runtime" });
  const sessions = createConversationSessionService({ store });
  const session = sessions.ensureSession({
    conversationId: "conv_compact",
    projectId: "proj_runtime",
    activeTaskId: "task_seed"
  });
  for (let index = 0; index < 6; index += 1) {
    sessions.appendItem({
      sessionId: session.session_id,
      kind: index % 2 === 0 ? SESSION_ITEM_KINDS.TASK_ANCHOR : SESSION_ITEM_KINDS.TOOL_OBSERVATION,
      taskId: `task_${index}`,
      artifactId: index === 3 ? "artifact_notes_xlsx" : null,
      content: `Observation ${index} created workbook and preserved task scope.`,
      payload: {
        tool_id: index % 2 === 0 ? "planner" : "write_file",
        success: index !== 5,
        parent_task_id: index > 0 ? `task_${index - 1}` : null
      }
    });
  }
  return { sessions, session };
}

runForBothStores("compacts typed session items into a deterministic session_compaction record", (store) => {
  const { session } = seedSession(store);
  const compactions = createSessionCompactionService({ store });
  const result = compactions.compactSession({
    sessionId: session.session_id,
    minItems: 4,
    maxLines: 4
  });

  assert.equal(result.compacted, true);
  assert.equal(result.compaction.session_id, session.session_id);
  assert.equal(result.compaction.conversation_id, "conv_compact");
  assert.equal(result.compaction.project_id, "proj_runtime");
  assert.equal(result.compaction.source_start_order, 0);
  assert.equal(result.compaction.source_end_order, 5);
  assert.equal(result.compaction.source_item_count, 6);
  assert.equal(result.compaction.metadata.schema_version, SESSION_COMPACTION_SCHEMA_VERSION);
  assert.match(result.compaction.summary_text, /Session compaction 0-5/);
  assert.ok(result.compaction.summary_text.includes("Observation 5"));
  assert.ok(result.compaction.task_ids.includes("task_3"));
  assert.ok(result.compaction.artifact_ids.includes("artifact_notes_xlsx"));
  assert.ok(result.compaction.open_threads.some((thread) => thread.includes("failed tool observation")));

  const latest = compactions.latestForSession(session.session_id);
  assert.equal(latest.compaction_id, result.compaction.compaction_id);
});

test("session compaction advances incrementally and skips when no new range meets the gate", () => {
  const store = createInMemoryStoreScaffold();
  const { sessions, session } = seedSession(store);
  const compactions = createSessionCompactionService({ store });

  const first = compactions.compactSession({ sessionId: session.session_id, minItems: 4 });
  assert.equal(first.compacted, true);

  sessions.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TOOL_OBSERVATION,
    taskId: "task_6",
    content: "One new item is not enough to compact.",
    payload: { tool_id: "write_file", success: true }
  });

  const skipped = compactions.compactSession({ sessionId: session.session_id, minItems: 2 });
  assert.equal(skipped.compacted, false);
  assert.equal(skipped.reason, "not_enough_items");
  assert.equal(skipped.since_order, 6);
});

test("runtime services wires sessionCompactions only when store contract exists", () => {
  const runtime = ensureRuntimeServices({
    store: createInMemoryStoreScaffold()
  });

  assert.equal(typeof runtime.sessionCompactions?.compactSession, "function");
  assert.equal(typeof runtime.sessionCompactions?.latestForSession, "function");
});
