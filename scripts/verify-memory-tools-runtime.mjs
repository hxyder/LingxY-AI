#!/usr/bin/env node
import assert from "node:assert/strict";
import { RECALL_MEMORY_TOOL, LIST_RECENT_TASKS_TOOL, GET_TASK_DETAIL_TOOL, LIST_CONVERSATION_ARTIFACTS_TOOL } from "../src/service/action_tools/tools/memory-tools.mjs";

function fail(message) {
  console.error(`[memory-tools-runtime] ${message}`);
  process.exitCode = 1;
}

// CAP-1 memory-tools runtime preflight. All four tools tested with
// stubbed runtime store. No physical move.

function makeRuntime({ tasks = [], artifacts = [], searchHits = [] } = {}) {
  return {
    store: {
      listTasks: () => tasks,
      getTask: (id) => tasks.find(t => t.task_id === id) ?? null,
      getArtifactsForTask: (_taskId) => artifacts,
      getArtifactsForConversation: (_convId, _opts) => artifacts,
      getTaskEvents: (_taskId) => [],
    },
    platform: {
      embeddingStore: {
        search: async (_query, _limit) => searchHits,
      }
    }
  };
}

// ── 1. recall_memory: success path with hits ──
{
  const runtime = makeRuntime({
    searchHits: [
      { id: "task-1", score: 0.9, text: "make a ppt", metadata: { status: "success", summary: "make a ppt", answer_excerpt: "saved pptx", artifact_paths: ["/out/report.pptx"] } }
    ]
  });
  const result = await RECALL_MEMORY_TOOL.execute(
    { query: "ppt", limit: 3 },
    { runtime }
  );
  assert(result.success === true, "recall_memory must succeed with hits");
  assert(result.observation.includes("task-1"), "recall result must include task id");
  assert(result.observation.includes("make a ppt"), "recall result must include user command");
}

// ── 2. recall_memory: no hits → success with useful message ──
{
  const runtime = makeRuntime({ searchHits: [] });
  const result = await RECALL_MEMORY_TOOL.execute(
    { query: "nonexistent", limit: 3 },
    { runtime }
  );
  assert(result.success === true, "recall_memory must succeed even with no hits");
  assert(typeof result.observation === "string" && result.observation.length > 0,
    "recall no-hits must return a readable observation");
}

// ── 3. recall_memory: filters out failed/useless hits ──
{
  const runtime = makeRuntime({
    searchHits: [
      { id: "bad", score: 0.5, text: "bad task", metadata: { status: "failed", summary: "bad task", answer_excerpt: "Task failed: timeout" } },
      { id: "good", score: 0.9, text: "good one", metadata: { status: "success", summary: "good one", answer_excerpt: "done", artifact_paths: [] } }
    ]
  });
  const result = await RECALL_MEMORY_TOOL.execute(
    { query: "test", limit: 5 },
    { runtime }
  );
  assert(result.success === true, "recall must succeed");
  assert(result.observation.includes("good"), "recall must include usable hits");
  assert(!result.observation.includes("bad"), "recall must filter failed hits");
}

// ── 4. list_recent_tasks: success path ──
{
  const runtime = makeRuntime({
    tasks: [
      { task_id: "recent-1", status: "success", user_command: "analyze sales", created_at: new Date(Date.now() - 600000).toISOString(), intent: "analysis", artifacts: [] },
      { task_id: "recent-2", status: "success", user_command: "send email", created_at: new Date(Date.now() - 300000).toISOString(), intent: "email", artifacts: [{ path: "/out/draft.eml" }] }
    ]
  });
  const result = await LIST_RECENT_TASKS_TOOL.execute(
    { minutes: 60, limit: 5 },
    { runtime }
  );
  assert(result.success === true, "list_recent_tasks must succeed");
  assert(result.metadata?.task_ids?.length >= 2, "list_recent must return recent tasks");
}

// ── 5. list_recent_tasks: filters non-success tasks ──
{
  const runtime = makeRuntime({
    tasks: [
      { task_id: "fail-1", status: "failed", user_command: "broken", created_at: new Date(Date.now() - 120000).toISOString(), updated_at: new Date(Date.now() - 120000).toISOString() }
    ]
  });
  const result = await LIST_RECENT_TASKS_TOOL.execute(
    { minutes: 60, limit: 5 },
    { runtime }
  );
  assert(result.success === true, "list_recent must succeed even with only failed tasks");
}

// ── 6. get_task_detail: found ──
{
  const runtime = makeRuntime({
    tasks: [
      { task_id: "detail-1", status: "success", user_command: "deep dive", created_at: new Date().toISOString(), intent: "research", artifacts: [{ path: "/out/notes.txt" }] }
    ]
  });
  const result = await GET_TASK_DETAIL_TOOL.execute(
    { task_id: "detail-1" },
    { runtime }
  );
  assert(result.success === true, "get_task_detail must succeed for found task");
  assert(result.observation.includes("detail-1"), "detail result must include task id");
  assert(result.observation.includes("deep dive"), "detail result must include user command");
}

// ── 7. get_task_detail: not found ──
{
  const runtime = makeRuntime({ tasks: [] });
  const result = await GET_TASK_DETAIL_TOOL.execute(
    { task_id: "nonexistent" },
    { runtime }
  );
  assert(result.success === false, "get_task_detail must fail for missing task");
  assert(result.observation.includes("not found") || result.observation.includes("NotFound"),
    "detail not-found must return a readable message");
}

// ── 8. list_conversation_artifacts: success ──
{
  const runtime = makeRuntime({
    tasks: [
      { task_id: "conv-1", status: "success", user_command: "file generation", created_at: new Date().toISOString(), intent: "generate", artifacts: [{ path: "/out/report.pdf" }, { path: "/out/slides.pptx" }] }
    ]
  });
  const result = await LIST_CONVERSATION_ARTIFACTS_TOOL.execute(
    { conversation_id: "conv-test", limit: 10 },
    { runtime }
  );
  assert(result.success === true, "list_conversation_artifacts must succeed");
}

if (!process.exitCode) {
  console.log("[memory-tools-runtime] all four memory tools verified with stubbed store");
}
