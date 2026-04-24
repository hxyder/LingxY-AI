// Memory introspection tools (UCA-182 Phase 21).
//
// Framework decision: instead of the runtime pre-injecting a digest
// of "maybe-relevant prior tasks" into every prompt (fragile, wastes
// tokens, needs regex to guess deictic references), we expose three
// small tools and let the model call them when it actually needs
// memory. The same embedding store + sqlite tasks table powers
// semantic + time-window + by-id lookups.
//
// Tools:
//   recall_memory(query, limit)     — semantic search the task store
//   list_recent_tasks(minutes, limit) — freshest successful tasks
//   get_task_detail(task_id)        — full context for a specific id
//
// All three are low-risk (read-only), run against runtime.store and
// runtime.platform.embeddingStore, and return a compact observation
// the planner can reason over. The agent's system prompt tells it to
// call recall_memory whenever the user refers to a prior turn by
// pronoun ("上个问题", "刚才那份", "之前的 ppt", "last one") — the
// AI decides, we don't.

import { createActionResult } from "../types.mjs";

const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_RECENT_MINUTES = 30;
const DEFAULT_RECENT_LIMIT = 5;
const MAX_LIMIT = 20;

function clampLimit(raw, fallback, max = MAX_LIMIT) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function summariseTaskRow(task) {
  if (!task) return null;
  const summary = task.result_summary ?? null;
  return {
    task_id: task.task_id,
    user_command: task.user_command ?? null,
    status: task.status ?? null,
    intent: task.intent ?? null,
    created_at: task.created_at ?? null,
    updated_at: task.updated_at ?? null,
    result_summary: summary ? String(summary).slice(0, 400) : null,
    artifact_paths: extractArtifactPaths(task)
  };
}

function extractArtifactPaths(task) {
  const paths = new Set();
  const list = Array.isArray(task.artifacts) ? task.artifacts : [];
  for (const a of list) {
    if (a?.path) paths.add(a.path);
  }
  return [...paths].slice(0, 8);
}

function formatObservation(lines) {
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────
// recall_memory
// ──────────────────────────────────────────────────────────────────
export const RECALL_MEMORY_TOOL = {
  id: "recall_memory",
  name: "Recall Memory",
  description: `Semantically search prior completed tasks from the user's history store. Use this when you need background on a topic the user has discussed before, or when they refer to past work with vague language ("the last one", "刚才那份", "之前的报告"). Returns top matching tasks with user_command + a short result excerpt + any artifact paths.`,
  parameters: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "Free text. The more descriptive, the better the match — include the topic, artefact kind, and any distinguishing words." },
      limit: { type: "number", description: `Max results (default ${DEFAULT_RECALL_LIMIT}, capped at ${MAX_LIMIT}).` }
    }
  },
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx.runtime;
    const store = runtime?.platform?.embeddingStore;
    const query = String(args.query ?? "").trim();
    if (!store?.search) {
      return createActionResult({ success: false, observation: "Memory store is not available in this runtime." });
    }
    if (!query) {
      return createActionResult({ success: false, observation: "recall_memory requires a non-empty query." });
    }
    const limit = clampLimit(args.limit, DEFAULT_RECALL_LIMIT);
    let results;
    try {
      results = await store.search(query, limit + 2);
    } catch (error) {
      return createActionResult({ success: false, observation: `Memory search failed: ${error.message}` });
    }
    const hits = (results ?? [])
      .filter((r) => r?.id && (r.score ?? 0) > 0.05)
      .slice(0, limit);
    if (hits.length === 0) {
      return createActionResult({ success: true, observation: `No prior tasks matched "${query}".` });
    }
    const lines = [`Found ${hits.length} prior task(s) matching "${query}":`];
    for (const hit of hits) {
      const meta = hit.metadata ?? {};
      lines.push(`- task_id=${hit.id} (score=${(hit.score ?? 0).toFixed(2)})`);
      lines.push(`    command: ${String(meta.summary ?? hit.text ?? "").slice(0, 160)}`);
      if (meta.answer_excerpt) lines.push(`    result: ${String(meta.answer_excerpt).slice(0, 280).replace(/\s+/g, " ")}`);
      if (Array.isArray(meta.artifact_paths) && meta.artifact_paths.length) {
        lines.push(`    artifacts: ${meta.artifact_paths.slice(0, 3).join(" · ")}`);
      }
    }
    return createActionResult({
      success: true,
      observation: formatObservation(lines),
      metadata: { recall_ids: hits.map((h) => h.id) }
    });
  }
};

// ──────────────────────────────────────────────────────────────────
// list_recent_tasks
// ──────────────────────────────────────────────────────────────────
export const LIST_RECENT_TASKS_TOOL = {
  id: "list_recent_tasks",
  name: "List Recent Tasks",
  description: `List the most recently completed tasks. Use this when the user refers to "the last one / 刚才 / 上个问题" without enough semantic anchor for recall_memory. Returns tasks in reverse chronological order with user_command + result summary + artifact paths.`,
  parameters: {
    type: "object",
    required: [],
    properties: {
      minutes: { type: "number", description: `How far back to look, in minutes. Default ${DEFAULT_RECENT_MINUTES}.` },
      limit: { type: "number", description: `Max results (default ${DEFAULT_RECENT_LIMIT}, capped at ${MAX_LIMIT}).` },
      include_failed: { type: "boolean", description: "If true, also include failed / cancelled tasks. Default false." }
    }
  },
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx.runtime;
    if (!runtime?.store?.listTasks) {
      return createActionResult({ success: false, observation: "Task store is not available in this runtime." });
    }
    const minutes = clampLimit(args.minutes, DEFAULT_RECENT_MINUTES, 60 * 24);
    const limit = clampLimit(args.limit, DEFAULT_RECENT_LIMIT);
    const includeFailed = Boolean(args.include_failed);
    const cutoff = Date.now() - minutes * 60 * 1000;
    const self = ctx.task?.task_id ?? null;

    let tasks;
    try {
      tasks = runtime.store.listTasks()
        .filter((t) => t && t.task_id !== self)
        .filter((t) => includeFailed || t.status === "success" || t.status === "partial_success")
        .filter((t) => new Date(t.updated_at ?? t.created_at ?? 0).getTime() >= cutoff);
    } catch (error) {
      return createActionResult({ success: false, observation: `listTasks failed: ${error.message}` });
    }
    tasks.sort((a, b) =>
      String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))
    );
    tasks = tasks.slice(0, limit);
    if (tasks.length === 0) {
      return createActionResult({ success: true, observation: `No completed tasks in the last ${minutes} minute(s).` });
    }
    const lines = [`Recent ${tasks.length} completed task(s) (last ${minutes} min):`];
    for (const t of tasks) {
      const when = String(t.updated_at ?? t.created_at ?? "").slice(11, 19);
      lines.push(`- [${when}] task_id=${t.task_id}`);
      lines.push(`    command: ${String(t.user_command ?? "").slice(0, 160)}`);
      if (t.result_summary) {
        lines.push(`    result: ${String(t.result_summary).replace(/\s+/g, " ").slice(0, 240)}`);
      }
      const artifacts = extractArtifactPaths(t);
      if (artifacts.length) {
        lines.push(`    artifacts: ${artifacts.slice(0, 3).join(" · ")}`);
      }
    }
    return createActionResult({
      success: true,
      observation: formatObservation(lines),
      metadata: { task_ids: tasks.map((t) => t.task_id) }
    });
  }
};

// ──────────────────────────────────────────────────────────────────
// get_task_detail
// ──────────────────────────────────────────────────────────────────
export const GET_TASK_DETAIL_TOOL = {
  id: "get_task_detail",
  name: "Get Task Detail",
  description: `Fetch the full record of a prior task by id. Use this after recall_memory / list_recent_tasks identifies a task you want to follow up on — the returned observation carries the original user_command, the assistant's answer, and the artifact list so you can reference them directly.`,
  parameters: {
    type: "object",
    required: ["task_id"],
    properties: {
      task_id: { type: "string", description: "The task_id you got from recall_memory or list_recent_tasks." }
    }
  },
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx.runtime;
    const taskId = String(args.task_id ?? "").trim();
    if (!runtime?.store?.getTask) {
      return createActionResult({ success: false, observation: "Task store is not available in this runtime." });
    }
    if (!taskId) {
      return createActionResult({ success: false, observation: "get_task_detail requires a task_id." });
    }
    const task = runtime.store.getTask(taskId);
    if (!task) {
      return createActionResult({ success: false, observation: `task_id=${taskId} not found.` });
    }
    let answer = null;
    try {
      const events = runtime.store.getTaskEvents?.(taskId) ?? [];
      const final = [...events].reverse().find((e) => e.event_type === "success" || e.event_type === "inline_result");
      answer = final?.payload?.text ?? null;
    } catch { /* best-effort */ }
    const summary = summariseTaskRow(task);
    const lines = [
      `task_id=${summary.task_id}`,
      `status=${summary.status}`,
      `created_at=${summary.created_at}`,
      `command: ${summary.user_command ?? "(missing)"}`
    ];
    if (answer) lines.push(`final_answer:\n${String(answer).slice(0, 1200)}`);
    else if (summary.result_summary) lines.push(`result_summary: ${summary.result_summary}`);
    if (summary.artifact_paths.length) {
      lines.push(`artifacts:\n${summary.artifact_paths.map((p) => "- " + p).join("\n")}`);
    }
    return createActionResult({
      success: true,
      observation: formatObservation(lines),
      metadata: { task_id: summary.task_id, artifact_paths: summary.artifact_paths }
    });
  }
};

export const MEMORY_TOOLS = Object.freeze([
  RECALL_MEMORY_TOOL,
  LIST_RECENT_TASKS_TOOL,
  GET_TASK_DETAIL_TOOL
]);
