# Conversations + task observability (UCA-182 Phases 9 & 11)

Two small but load-bearing additions that together make it possible
to debug "my second message started a fresh task" and "what actually
went wrong with task_xyz". Kept in one document because they share
data flow (parent_task_id → task log).

## Phase 9 — conversation parent_task_id

### Problem

Pre-Phase-9, every overlay submit created a root task. Multi-turn
conversations had no thread link on the server, so follow-ups
couldn't skip plan/decomposition or reuse the previous task's
artifacts. Long outlines eventually blew up CLI length limits
(`task_75ddc38b`, the motivating bug).

### Solution

[overlay.js](../../src/desktop/renderer/overlay.js) tracks two fields
on each conversation:

```js
conversationState.lastCompletedTaskId  // last success's task_id
conversationState.lastArtifacts        // minimal manifest
```

Both are persisted to `projectStore` along with the conversation
itself, so switching between conversations restores the right thread
context.

On submit, the payload carries both:

```js
body: JSON.stringify({
  ...payload,
  parent_task_id: conversationState?.lastCompletedTaskId ?? null,
  conversation_id: conversationState?.id ?? null
})
```

On task success (artifacts or conversational), overlay.js updates
`lastCompletedTaskId` and refreshes `lastArtifacts`.

### Server

[http-server.mjs](../../src/service/core/http-server.mjs) `POST /task`
reads `body.parent_task_id` (or camelCase `parentTaskId`) and forwards
to `submitContextTask`. `submitContextTask` already supported the
field — it skips plan layer + decomposition when a parent is set so
follow-ups inherit context instead of re-planning.

### UI cue

(Not yet implemented — future phase) Composer shows a chip like
`💬 沿用上下文 · task_75ddc3` with an × button to reset
`lastCompletedTaskId` and start a fresh root task.

## Phase 11 — per-task jsonl event log

### Problem

`task_75ddc38b` was reported by the user but nobody could look at the
execution trace because task events only lived in sqlite plus an
in-memory SSE stream. Post-mortem was a manual `sqlite3` query and
prayer.

### Solution

[task-runtime.mjs](../../src/service/core/task-runtime.mjs) `emitTaskEvent`
now also appends to `<logsDir>/tasks/<taskId>.jsonl`. Serialized
through a per-task promise queue so same-task events land in order
while different tasks write independently.

```
runtime.paths.logsDir/
└── tasks/
    ├── task_75ddc38b-….jsonl      # one JSON record per line
    ├── task_75ddc38c-….jsonl
    └── …
```

Events skipped for readability:
- `text_delta`
- `tool_input_delta`
- `conversation_step`
- `heartbeat`

Rotation: once `>500` files, oldest `N` pruned (check fires every 128
writes to amortise the `readdir`).

### Endpoints

| HTTP | What |
|------|------|
| `GET /task/:id/log` | parsed jsonl — used by Settings panel |
| `GET /tasks/failed?limit=20` | recent failed tasks (sqlite listTasks + filter) |

### UI

Settings → 任务日志 (`#failedTasksPanel` in
[console.html](../../src/desktop/renderer/console.html)):

- List of recent failed tasks with timestamp + user_command +
  `failure_user_message` preview.
- Clicking a row fetches `/task/:id/log` and renders the full event
  stream with timestamps and payloads.
- Refresh button re-queries `/tasks/failed`.

### Contract

Imported helpers:

```js
// Await a record being persisted; used by tests + graceful shutdown.
export async function flushTaskLogs(): Promise<void>;

// Reads back the per-task log. Returns [] if the task pre-dates
// Phase 11 or its log was rotated away.
export async function readTaskEventLog(runtime, taskId): Promise<Event[]>;
```

## Verifiers

```bash
node scripts/verify-task-branch.mjs   # Phase 9: client + server wire parent_task_id
node scripts/verify-task-log.mjs      # Phase 11: emit → flush → read cycle, ephemeral skip
```
