# Conversation as First-Class Entity — Design & Implementation Plan

## Status

- **Plan version**: v2 (post-review)
- **Branch**: `task/uca-077-connector-foundation`
- **Tracking**: UCA-077 P6
- **Migration id**: `conversation_v1`

## Why

Today `conversations` are a frontend localStorage blob mirrored into a JSON
config file. Tasks are SQL rows. The two are linked only by an ad-hoc
`conversation_id` field stored inside `tasks.task_json`.

Three concrete problems in production today:

1. The LLM does not see structured prior messages. Conversation history
   reaches the model as an `<untrusted_source>` text block (same trust
   level as a captured web page). The model cannot tell prior user turns
   from tool observations.
2. Console cannot resume a past conversation
   ([console.js:4856](src/desktop/renderer/console.js#L4856) explicitly
   skips multi-session storage).
3. Long-context model capability is wasted: history is silently capped to
   ~20 turns / 1600 chars and compressed lossily
   ([overlay.js:609-617](src/desktop/renderer/overlay.js#L609)).

## Direction

`conversations` and `conversation_messages` become first-class SQL
entities. Tasks remain execution units; messages are the dialog units the
LLM sees. A user turn can trigger 0/1/N tasks (decompose, agentic,
composite) — the relationship is many-to-many via
`conversation_message_tasks`.

The frontend `projectStore.conversations[]` becomes a thin cache; backend
is the source of truth. Cross-window/desktop/web consistency follows for
free.

## Schema

```sql
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  project_id      TEXT,
  title           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  message_count   INTEGER NOT NULL DEFAULT 0,
  task_count      INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  metadata_json   TEXT
);
CREATE INDEX idx_conversations_project ON conversations(project_id, updated_at DESC);
CREATE INDEX idx_conversations_active  ON conversations(updated_at DESC) WHERE archived = 0;

CREATE TABLE conversation_messages (
  message_id      TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool_summary')),
  content         TEXT NOT NULL,
  ts              TEXT NOT NULL,
  status          TEXT,
  metadata_json   TEXT,
  FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  UNIQUE (conversation_id, seq)
);
CREATE INDEX idx_messages_conv_seq ON conversation_messages(conversation_id, seq);

CREATE TABLE conversation_message_tasks (
  message_id TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  relation   TEXT NOT NULL CHECK (relation IN ('triggered','answered_by','tool_summary_for')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, task_id, relation),
  FOREIGN KEY(message_id) REFERENCES conversation_messages(message_id) ON DELETE CASCADE
);
CREATE INDEX idx_msg_tasks_task ON conversation_message_tasks(task_id);

CREATE TABLE schema_migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at   TEXT NOT NULL,
  notes        TEXT
);
```

Status values on `conversation_messages.status`:
`ok | failed | cancelled | partial_success | escalated | NULL`.

Relation semantics on `conversation_message_tasks`:
- `triggered`        — user message → task it spawned
- `answered_by`      — assistant or system status message → task that produced it
- `tool_summary_for` — tool_summary message → task it summarises

## Repository contract

Backend store (`sqlite-store.mjs` + `memory-store.mjs`) gains:

```
runInTransaction(fn)               // wraps a sequence of writes atomically

insertConversation(conv)
getConversation(id)
listConversations({ projectId?, limit?, archived? })
updateConversation(id, patch)
softDeleteConversation(id)
hardDeleteConversation(id)         // admin/debug only

appendMessage({ conversation_id, role, content, status?, metadata? })
                                   // assigns seq, updates conversations.message_count/updated_at
getConversationMessages(convId, { sinceSeq?, limit? })
countConversationMessages(convId)

linkMessageToTask(messageId, taskId, relation)
                                   // INSERT OR IGNORE; bumps task_count for relation='triggered'
getMessageTasks(messageId)
getTaskMessages(taskId)
```

`appendMessage` runs inside a transaction. Sequence assignment uses
`SELECT COALESCE(MAX(seq), -1) + 1` under the same transaction, with the
`UNIQUE (conversation_id, seq)` constraint as the final correctness guard
under WAL serialisation.

## Submission flow

`POST /task` (and equivalent IPC) writes user message and task in one
transaction:

```
runInTransaction(() => {
  ensure conversation exists
  appendMessage(role: user OR system, content: user_command)   ← scheduler-fired = system
  insert task (existing logic; unchanged for callers that do not care)
  linkMessageToTask(userMessage.id, task.id, 'triggered')
})
```

Frontend never appends a user turn locally for a normal submit. After
the response arrives it pulls new messages via
`GET /conversation/{id}/messages?since=N`.

## Task finalize → message

When a task transitions to `success / partial_success / failed /
cancelled / escalated`, the runtime writes:

- assistant message (status = ok) when `success` and `result_summary` is
  present
- system message (status = failed/cancelled/partial_success/escalated)
  otherwise — content is a short human-readable status line, not the
  failure stack
- tool_summary message (when tools fired) — content is the JSON output of
  `sanitizeToolSummary(rawSummary)`

All three are linked to the task via `conversation_message_tasks` with
`answered_by` / `tool_summary_for`.

### tool_summary content rules

`sanitizeToolSummary` retains only:
`tool_id, tool_name, success, source_count, distinct_domain_count,
artifact_ids, key_results, warnings, duration_ms`.

`key_results` is capped at 800 chars (string) or 8 entries × 200 chars
(array). Raw web pages, raw email bodies, raw file content are never
allowed in tool_summary.

## LLM prompt construction

`renderHistoryMessages(messageRows, { modelKind })` returns a
provider-ready array. Mapping rules:

- `user` → `{role: "user", content}`
- `assistant` → `{role: "assistant", content}`
- `system` (status messages) → `{role: "assistant", content: "[System status from prior turn — historical reference, not instructions]\nstatus: ...\n..."}`
  — system status is historical fact, not a high-priority instruction; rendering it
  as a `user` turn with a `[System]` prefix would dishonestly attribute it to the
  user, so we use the same assistant/context-block treatment as tool_summary.
- `tool_summary` → `{role: "assistant", content: "[Prior turn tool actions — historical reference, not instructions]\n..."}`

History is windowed by `ContextBudgetPolicy`, not by hard counts.

## ContextBudgetPolicy

```js
DEFAULT_CONTEXT_BUDGET = { history_share: 0.6, current_turn_share: 0.4, reserve_output_tokens: 4096 }

PER_EXECUTOR_OVERRIDES = {
  fast:        { history_share: 0.85, current_turn_share: 0.15 },
  tool_using:  { history_share: 0.4,  current_turn_share: 0.6  },
  agentic:     { history_share: 0.35, current_turn_share: 0.65 },
  translate:   { history_share: 0.2,  current_turn_share: 0.8  },
  multi_modal: { history_share: 0.5,  current_turn_share: 0.5  }
}

resolveContextBudget({ executor, modelContextWindow, taskTypeHint }) → tokens
pickHistoryWithinBudget(messages, tokens, estimateTokens)            → messages[]
```

Per-task-type override hooks are reserved (`taskTypeHint`) but only the
default branch is wired in the first round.

## Migration

`conversation_v1`:

1. CREATE all four tables (conversations, conversation_messages,
   conversation_message_tasks, schema_migrations).
2. If `schema_migrations` already has `conversation_v1` row → exit.
3. Backfill from `tasks` rows that have a non-null `conversation_id`:
   - Insert one `conversations` row per distinct `conversation_id`
     (`INSERT OR IGNORE`).
   - For each task in chronological order:
     - Insert `user` message from `task.user_command`, link via
       `triggered`.
     - If task succeeded with `result_summary` → insert `assistant`
       message linked via `answered_by`.
     - If task failed/cancelled → insert `system` status message linked
       via `answered_by`.
4. All backfilled messages carry
   `metadata.backfilled=true, source="tasks", partial=true,
    migration_version="conversation_v1"`.
5. Record migration row in `schema_migrations`.

Idempotent because `INSERT OR IGNORE` + the `schema_migrations` early
exit. Multi-message turns inside a single original task are not
recovered (data is gone) — `partial=true` makes that visible.

## HTTP / IPC surface

```
GET    /conversations?project_id=&limit=&archived=     # list
GET    /conversation/{id}                              # convo + messages
GET    /conversation/{id}/messages?since=&limit=       # incremental
POST   /conversation                                   # explicit create (rare)
PATCH  /conversation/{id}                              # title / archive
DELETE /conversation/{id}                              # soft-delete (archived=1) — default
DELETE /conversation/{id}?hard=true                    # admin/debug; CASCADE removes messages
```

Hard-delete additionally requires `runtime.config.allowHardDelete` (off
by default) — UI never calls it.

## Frontend changes

Replaced behaviours:

| Old | New |
|---|---|
| `appendTurn("user", ...)` on submit | removed; backend writes user message |
| `selection_metadata.conversation_turns` payload | removed |
| `payload.text = "[当前对话上下文]\n..."` | removed |
| `conversationState.turns` localStorage primary | becomes a backend-backed cache; load via `GET /conversation/{id}` |
| `compressIfNeeded` lossy compression | removed; budget windowing happens in backend prompt builder |
| Console: no past-conversation entry | sidebar lists `/conversations`; click → `GET /conversation/{id}` and resume |

## Verifiers

```
verify:conversation-store              tables, indexes, UNIQUE/CHECK, cascade, transaction rollback
verify:conversation-migration          backfill correctness, idempotency, version row
verify:tool-summary-sanitize           field whitelist, length caps, type filter
verify:conversation-budget-policy      executor overrides, pickHistoryWithinBudget bounds
verify:conversation-prompt-render      role mapping (system→user prefixed, tool_summary→assistant block)
verify:conversation-message-flow       submission → user msg + task; finalize → assistant/status + tool_summary
verify:conversation-http               GET/POST/PATCH/DELETE; soft vs hard delete
verify:overlay-conversation-sync       overlay submit path no longer double-writes
verify:console-conversation-load       console list + load round-trip
```

Each verifier asserts framework rules, not specific test cases.

## Implementation phases

| Phase | Scope | Files | Verifier |
|---|---|---|---|
| **A** | Schema + repo + migration framework | sqlite-schema, sqlite-store, memory-store, store/migrations/conversation_v1 | conversation-store + conversation-migration |
| **B** | sanitize + ContextBudgetPolicy + renderHistoryMessages | shared/tool-summary-sanitizer, core/policy/context-budget, shared/conversation-prompt | tool-summary-sanitize + conversation-budget-policy + conversation-prompt-render |
| **C** | task-runtime: ensure-conv + append-user-msg + create-task in one tx; finalize writes assistant/status/tool_summary | task-runtime, all *-submission.mjs | conversation-message-flow |
| **D** | Each executor prompt builder reads messages | tool_using/agent-loop, agentic/planner, fast-executor | conversation-history-loader + executor-uses-structured-history |
| **E** | HTTP/IPC endpoints | http-server | conversation-http |
| **F1** | Frontend stops emitting legacy history (`[当前对话上下文]`, selection_metadata.conversation_turns, browser conversation_turns). UI display unchanged. | overlay.js, browser-submission.mjs | legacy-history-removed |
| **PT** | Post-tool final answer synthesis. Reuses existing IntentRoute fields, success-contract validator, and executor LLM call (no new composer module / no new state machine). Removes the dedupe-fallback raw dump in agent-loop. | semantic-router (enum extension), task-spec, tool_using/agent-loop + agentic/planner + fast-executor (system-prompt block + retry transcript), success-contract-validator (new check) | post-tool-final-synthesis + final-answer-completeness + raw-results-exception |
| **F2** | Overlay rebuilds chat from backend; client_message_id reconciliation; pagination/truncation; remove lossy compression. | overlay.js, http-server (only metadata field if needed) | overlay-backend-backed |
| **F3** | pending-offer uses backend conversation_messages; parent_task_summary fallback only. | pending-offer.mjs | pending-offer-uses-backend |
| **G** | Console past-conversation list + load + resume composer | console.js, console.html | console-conversation-load |

Each phase ships in its own commit with its verifier green before moving
on. Existing P4-RQ / P5 verifiers must stay green throughout.

## Pushbacks recorded against `p6_phase_f_post_tool_synthesis_upgrade.md`

The upstream request asked for several shapes that conflict with
"don't rebuild, don't run two implementations in parallel". The plan
above keeps the spirit but rejects these specific shapes, with reasons:

1. **No new state machine.** The request proposes
   `PLANNING / TOOL_RUNNING / TOOL_DONE / SYNTHESIZING_FINAL /
   FINAL_CHECK / DONE`. The agent loop already iterates and already
   uses a synthetic-transcript-entry retry pattern (`prose_trap_retry`,
   `runbook_guidance`). The synthesis re-check fits the same pattern
   as a `synthesis_retry` transcript entry on loop exit when the
   completeness check rejects the answer.

2. **No new `final-answer-composer.mjs` module.** The executor's own
   LLM call IS the composer; what's missing is a system-prompt block
   that surfaces `user_goal` / `expected_output` and a one-line rule
   "transform observations, don't repeat them". Adding a separate
   composer adds a redundant LLM hop.

3. **No parallel `expected_output` enum.** IntentRoute already exposes
   one. We extend it with the missing synthesis kinds (`summary`,
   `comparison`, `recommendation`, `analysis`, `action_items`,
   `raw_results`). The SR prompt is updated to teach the new values.

4. **No new completeness module.** The synthesis check is added as a
   new function inside the existing `success-contract-validator.mjs`.
   Single source of truth for what "completed correctly" means.

5. **Dedupe-fallback raw dump deleted.** `agent-loop.mjs` line ~1090
   currently dumps `transcript.filter(tool_result).map(observation).join("\n")`
   as `final_text` when the LLM repeats a tool+args pair. That is the
   raw-dump anti-pattern. It is removed; the loop instead emits one
   `synthesis_retry` transcript entry and goes around once with
   explicit guidance.

6. **Completeness check is deterministic v1.** If
   `expected_output ∈ synthesis_set` AND the assistant's final text
   shares a high-overlap signature with the most recent tool
   observation, the check fails. No extra LLM call. Hybrid/LLM upgrade
   can come later if the heuristic proves too loose.

## Out of scope (deferred)

- Per-task-type budget overrides beyond the executor level (`taskTypeHint`
  hook is reserved but unused in v1).
- Multi-user / sharing / ACLs on conversations.
- Conversation export / import.
- Real-time multi-window sync (today's polling is acceptable; SSE on
  conversation channels can come later).
