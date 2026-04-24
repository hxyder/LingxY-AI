// Phase 21 verifier (UCA-182) — memory tools instead of guess-injection.
//
// The earlier approach (regex-detect deictic language, prepend a
// digest) was a patch. The framework-correct answer is: give the
// model memory introspection tools and let it ask for what it needs.
// This verifier proves the three tools work end-to-end against a
// minimal mock runtime, and that the two system prompts (agentic
// planner + tool_using agent-loop) actually mention them so the
// model knows they exist.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECALL_MEMORY_TOOL,
  LIST_RECENT_TASKS_TOOL,
  GET_TASK_DETAIL_TOOL,
  MEMORY_TOOLS
} from "../src/service/action_tools/tools/memory-tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 0. MEMORY_TOOLS is an array of 3 with stable ids ---------------
assert.equal(MEMORY_TOOLS.length, 3);
assert.deepEqual(
  MEMORY_TOOLS.map((t) => t.id).sort(),
  ["get_task_detail", "list_recent_tasks", "recall_memory"]
);
for (const tool of MEMORY_TOOLS) {
  assert.equal(tool.risk_level, "low");
  assert.equal(tool.requires_confirmation, false);
  assert.ok(typeof tool.description === "string" && tool.description.length > 30);
  assert.ok(tool.parameters?.type === "object");
}

// --- 1. recall_memory: feeds embeddingStore.search ------------------
{
  const calls = [];
  const mockStore = {
    search: async (q, k) => {
      calls.push({ q, k });
      return [
        { id: "task_A", score: 0.42, text: "AI 报告", metadata: { summary: "生成 AI 报告", answer_excerpt: "报告覆盖三部分", artifact_paths: ["E:\\foo.docx"] } },
        { id: "task_B", score: 0.01, text: "", metadata: {} } // below threshold
      ];
    }
  };
  const runtime = { platform: { embeddingStore: mockStore } };
  const result = await RECALL_MEMORY_TOOL.execute({ query: "AI report", limit: 3 }, { runtime });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.ok(result.observation.includes("task_A"));
  assert.ok(!result.observation.includes("task_B"), "score ≤ 0.05 hits must be filtered");
  assert.deepEqual(result.metadata.recall_ids, ["task_A"]);

  // empty query → tool-level failure
  const bad = await RECALL_MEMORY_TOOL.execute({ query: "" }, { runtime });
  assert.equal(bad.success, false);
  assert.ok(bad.observation.includes("non-empty"));
}

// --- 2. list_recent_tasks: time-window + order ----------------------
{
  const now = Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();
  const mockTasks = [
    { task_id: "task_oldest", status: "success", created_at: iso(60 * 60_000), updated_at: iso(60 * 60_000), user_command: "远古任务" },
    { task_id: "task_fresh_1", status: "success", created_at: iso(60_000), updated_at: iso(60_000), user_command: "最近任务 1", result_summary: "done" },
    { task_id: "task_fresh_2", status: "success", created_at: iso(120_000), updated_at: iso(120_000), user_command: "最近任务 2" },
    { task_id: "task_failed", status: "failed", created_at: iso(30_000), updated_at: iso(30_000), user_command: "失败任务" }
  ];
  const runtime = {
    store: {
      listTasks: () => [...mockTasks]
    }
  };

  // default window (30 min) + skip failed
  const result = await LIST_RECENT_TASKS_TOOL.execute({ limit: 5 }, { runtime });
  assert.equal(result.success, true);
  assert.deepEqual(result.metadata.task_ids, ["task_fresh_1", "task_fresh_2"],
    "newest first, failed + out-of-window excluded");

  // opt-in include_failed
  const withFailed = await LIST_RECENT_TASKS_TOOL.execute({ include_failed: true, limit: 5 }, { runtime });
  assert.ok(withFailed.metadata.task_ids.includes("task_failed"));

  // minutes=120 reaches the 60-min task
  const widerWindow = await LIST_RECENT_TASKS_TOOL.execute({ minutes: 120, limit: 10 }, { runtime });
  assert.ok(widerWindow.metadata.task_ids.includes("task_oldest"));

  // self-exclusion via ctx.task
  const excludingSelf = await LIST_RECENT_TASKS_TOOL.execute(
    { limit: 5 },
    { runtime, task: { task_id: "task_fresh_1" } }
  );
  assert.ok(!excludingSelf.metadata.task_ids.includes("task_fresh_1"),
    "the caller's own task must not appear in its own recall");
}

// --- 3. get_task_detail: loads row + success event text ------------
{
  const runtime = {
    store: {
      getTask: (id) => id === "task_X" ? {
        task_id: "task_X",
        status: "success",
        created_at: "2026-04-24T12:00:00Z",
        user_command: "做一份 ppt",
        result_summary: "done",
        artifacts: [{ path: "E:\\out.pptx" }]
      } : null,
      getTaskEvents: (id) => id === "task_X" ? [
        { event_type: "started", payload: {} },
        { event_type: "inline_result", payload: { text: "报告完成，三个章节" } },
        { event_type: "success", payload: { text: "FINAL TEXT" } }
      ] : []
    }
  };
  const result = await GET_TASK_DETAIL_TOOL.execute({ task_id: "task_X" }, { runtime });
  assert.equal(result.success, true);
  assert.ok(result.observation.includes("task_X"));
  assert.ok(result.observation.includes("FINAL TEXT"), "must surface the last success event's text");
  assert.ok(result.observation.includes("E:\\out.pptx"));
  assert.deepEqual(result.metadata.artifact_paths, ["E:\\out.pptx"]);

  // missing id
  const miss = await GET_TASK_DETAIL_TOOL.execute({ task_id: "task_missing" }, { runtime });
  assert.equal(miss.success, false);
}

// --- 4. System prompts tell the model about these tools ------------
{
  const ag = await readFile(path.join(ROOT, "src/service/executors/agentic/prompt-builder.mjs"), "utf8");
  assert.ok(ag.includes("list_recent_tasks"),
    "agentic system prompt must reference list_recent_tasks");
  assert.ok(ag.includes("recall_memory"),
    "agentic system prompt must reference recall_memory");
  assert.ok(ag.includes("get_task_detail"),
    "agentic system prompt must reference get_task_detail");
  assert.ok(ag.includes("上个问题"),
    "agentic prompt must call out the deictic-reference case explicitly");

  const tu = await readFile(path.join(ROOT, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.ok(tu.includes("list_recent_tasks"));
  assert.ok(tu.includes("recall_memory"));
  assert.ok(tu.includes("get_task_detail"));
}

// --- 5. Tools are registered in BUILTIN_ACTION_TOOLS ---------------
{
  const { BUILTIN_ACTION_TOOLS } = await import("../src/service/action_tools/tools/index.mjs");
  const ids = BUILTIN_ACTION_TOOLS.map((t) => t.id);
  for (const mid of ["recall_memory", "list_recent_tasks", "get_task_detail"]) {
    assert.ok(ids.includes(mid), `BUILTIN_ACTION_TOOLS must include ${mid}`);
  }
}

// --- 6. Patch-era regex is gone -----------------------------------
{
  const ctx = await readFile(path.join(ROOT, "src/service/core/context-submission.mjs"), "utf8");
  assert.ok(!ctx.includes("DEICTIC_PATTERN"),
    "regex-based deictic detection must be removed — the AI decides, not a regex");
  assert.ok(!ctx.includes("function seedRecentTasksContext"),
    "time-window seed-injection helper must be removed");
  assert.ok(!ctx.includes("function inferParentTaskId"),
    "server-side parent inference patch must be removed");
}

console.log("ok verify-deictic-recall");
