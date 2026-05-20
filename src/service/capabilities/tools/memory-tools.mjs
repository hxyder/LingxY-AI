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
//   list_conversation_artifacts(conversation_id?, limit) — files from this thread
//
// All four are low-risk (read-only), run against runtime.store and
// runtime.platform.embeddingStore, and return a compact observation
// the planner can reason over. The agent's system prompt tells it to
// call recall_memory whenever the user refers to a prior turn by
// pronoun ("上个问题", "刚才那份", "之前的 ppt", "last one") — the
// AI decides, we don't.

import { createActionResult } from "../registry/types.mjs";

const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_RECENT_MINUTES = 30;
const DEFAULT_RECENT_LIMIT = 5;
const MAX_LIMIT = 20;
const MAX_SIDE_EFFECT_BODY_CHARS = 6000;

const EMAIL_WORKFLOW_RE = /(?:gmail|outlook|email|mail).*(?:send|draft)|draft_confirm_send|email\.draft/i;
const EMAIL_SEND_TOOL_RE = /(?:^|\.)(?:send_email|mail_send)$|account_send_email|gmail\.send_email|outlook.*send/i;

function clampLimit(raw, fallback, max = MAX_LIMIT) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function summariseTaskRow(task, runtime = null) {
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
    artifact_paths: extractArtifactPaths(task, runtime)
  };
}

function extractArtifactPaths(task, runtime = null) {
  const paths = new Set();
  if (runtime?.store?.getArtifactsForTask && task?.task_id) {
    try {
      for (const artifact of runtime.store.getArtifactsForTask(task.task_id) ?? []) {
        if (artifact?.path) paths.add(artifact.path);
      }
    } catch {
      // Fall back to the task JSON shape below.
    }
  }
  const list = Array.isArray(task.artifacts) ? task.artifacts : [];
  for (const a of list) {
    if (a?.path) paths.add(a.path);
  }
  return [...paths].slice(0, 8);
}

function formatObservation(lines) {
  return lines.join("\n");
}

function asObject(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function compactString(value, max = 1000) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[truncated ${text.length - max} chars]`;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function emailInputFromPayload(payload = {}) {
  const args = asObject(payload.args) ?? {};
  const pending = asObject(payload.pendingApproval)
    ?? asObject(payload.pending_approval)
    ?? asObject(payload.approval)
    ?? {};
  const proposed = asObject(payload.proposed_params)
    ?? asObject(pending.proposed_params)
    ?? {};
  const state = asObject(args.state) ?? asObject(proposed.state) ?? asObject(pending.state) ?? {};
  const candidates = [
    asObject(args.input),
    asObject(args),
    asObject(proposed.input),
    asObject(proposed),
    asObject(state.outputs?.draft),
    asObject(state.draft)
  ].filter(Boolean);
  const input = candidates.find((candidate) =>
    candidate.to !== undefined || candidate.subject !== undefined || candidate.body !== undefined
  );
  if (!input) return null;
  const to = normalizeRecipients(input.to ?? input.recipients);
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body : "";
  if (to.length === 0 && !subject && !body) return null;
  return { to, subject, body };
}

function payloadLooksLikeEmailWorkflow(payload = {}) {
  const args = asObject(payload.args) ?? {};
  const workflowId = String(
    payload.workflow_id
      ?? payload.workflowId
      ?? args.workflowId
      ?? args.workflow_id
      ?? payload.proposed_target
      ?? ""
  );
  const toolId = String(payload.tool_id ?? payload.toolId ?? "");
  return EMAIL_WORKFLOW_RE.test(workflowId) || EMAIL_SEND_TOOL_RE.test(toolId);
}

function mergeEmailRecord(record, patch = {}) {
  if (!record) return patch;
  const to = normalizeRecipients(patch.to);
  if (to.length) record.to = to;
  if (patch.subject) record.subject = patch.subject;
  if (patch.body) record.body = patch.body;
  if (patch.workflow_id) record.workflow_id = patch.workflow_id;
  if (patch.tool_id) record.tool_id = patch.tool_id;
  if (patch.approval_id) record.approval_id = patch.approval_id;
  if (patch.status) record.status = patch.status;
  if (patch.ts) record.ts = patch.ts;
  return record;
}

function latestEmailRecord(records) {
  return records.length ? records[records.length - 1] : null;
}

export function extractTaskSideEffectsFromEvents(events = []) {
  const emailRecords = [];
  for (const event of events ?? []) {
    const payload = asObject(event?.payload) ?? {};
    const eventType = String(event?.event_type ?? "");
    const args = asObject(payload.args) ?? {};
    const workflowId = String(payload.workflow_id ?? payload.workflowId ?? args.workflowId ?? args.workflow_id ?? "");
    const toolId = String(payload.tool_id ?? payload.toolId ?? "");
    const approvalId = String(
      payload.approval_id
        ?? payload.approvalId
        ?? payload.pendingApproval?.approval_id
        ?? payload.pending_approval?.approval_id
        ?? ""
    );

    const input = emailInputFromPayload(payload);
    if (input && payloadLooksLikeEmailWorkflow(payload)) {
      emailRecords.push({
        group: "email_send",
        status: eventType === "pending_approval_created" ? "waiting_confirmation" : "prepared",
        workflow_id: workflowId || null,
        tool_id: toolId || (workflowId ? "connector_workflow_run" : null),
        approval_id: approvalId || null,
        to: input.to,
        subject: input.subject,
        body: input.body,
        ts: event?.ts ?? null
      });
      continue;
    }

    if (eventType === "tool_call_completed"
        && payload.success !== false
        && (EMAIL_SEND_TOOL_RE.test(toolId) || EMAIL_WORKFLOW_RE.test(workflowId))) {
      const record = latestEmailRecord(emailRecords) ?? {};
      if (emailRecords.length === 0) emailRecords.push(record);
      mergeEmailRecord(record, {
        status: "sent",
        workflow_id: workflowId || record.workflow_id || null,
        tool_id: toolId || record.tool_id || null,
        approval_id: approvalId || record.approval_id || null,
        ts: event?.ts ?? record.ts ?? null
      });
    }

    if (eventType === "success" && (EMAIL_WORKFLOW_RE.test(workflowId) || approvalId)) {
      const record = latestEmailRecord(emailRecords);
      if (record) {
        mergeEmailRecord(record, {
          status: "sent",
          workflow_id: workflowId || record.workflow_id || null,
          approval_id: approvalId || record.approval_id || null,
          ts: event?.ts ?? record.ts ?? null
        });
      }
    }
  }

  return emailRecords
    .filter((record) => record.to?.length || record.subject || record.body || record.status === "sent")
    .map((record) => ({
      ...record,
      status: record.status === "prepared" ? "prepared" : record.status,
      to: normalizeRecipients(record.to),
      subject: compactString(record.subject, 500),
      body: compactString(record.body, MAX_SIDE_EFFECT_BODY_CHARS)
    }));
}

function formatSideEffectLines(sideEffects = []) {
  if (!sideEffects.length) return [];
  const lines = ["side_effects:"];
  for (const effect of sideEffects) {
    const parts = [
      `group=${effect.group}`,
      `status=${effect.status}`,
      effect.workflow_id ? `workflow_id=${effect.workflow_id}` : null,
      effect.tool_id ? `tool_id=${effect.tool_id}` : null,
      effect.approval_id ? `approval_id=${effect.approval_id}` : null
    ].filter(Boolean);
    lines.push(`- ${parts.join(" ")}`);
    if (effect.to?.length) lines.push(`  to: ${effect.to.join(", ")}`);
    if (effect.subject) lines.push(`  subject: ${effect.subject}`);
    if (effect.body) {
      lines.push("  body:");
      lines.push(...String(effect.body).split(/\r?\n/).map((line) => `    ${line}`));
    }
  }
  return lines;
}

function isUsableMemoryHit(hit) {
  const meta = hit?.metadata ?? {};
  const status = meta.status ?? "success";
  if (!["success", "partial_success"].includes(status)) return false;
  const answer = String(meta.answer_excerpt ?? "");
  if (/Unknown tool requested|执行器出错|Task failed:/i.test(answer)) return false;
  return true;
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
      .filter(isUsableMemoryHit)
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
      const artifacts = extractArtifactPaths(t, runtime);
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
    let events = [];
    try {
      events = runtime.store.getTaskEvents?.(taskId) ?? [];
      const final = [...events].reverse().find((e) => e.event_type === "success" || e.event_type === "inline_result");
      answer = final?.payload?.text ?? null;
    } catch { /* best-effort */ }
    const summary = summariseTaskRow(task, runtime);
    const sideEffects = extractTaskSideEffectsFromEvents(events);
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
    lines.push(...formatSideEffectLines(sideEffects));
    return createActionResult({
      success: true,
      observation: formatObservation(lines),
      metadata: { task_id: summary.task_id, artifact_paths: summary.artifact_paths, side_effects: sideEffects }
    });
  }
};

// ──────────────────────────────────────────────────────────────────
// list_conversation_artifacts
// ──────────────────────────────────────────────────────────────────
export const LIST_CONVERSATION_ARTIFACTS_TOOL = {
  id: "list_conversation_artifacts",
  name: "List Conversation Artifacts",
  description: `List files produced in the current conversation. Use this before revising, emailing, comparing, or continuing work on an artifact from this same chat. Defaults to the active conversation_id and does not search unrelated conversations.`,
  parameters: {
    type: "object",
    required: [],
    properties: {
      conversation_id: { type: "string", description: "Optional. Defaults to the current task's conversation_id." },
      limit: { type: "number", description: `Max results (default ${DEFAULT_RECENT_LIMIT}, capped at ${MAX_LIMIT}).` }
    }
  },
  risk_level: "low",
  requires_confirmation: false,
  async execute(args = {}, ctx = {}) {
    const runtime = ctx.runtime;
    const conversationId = String(args.conversation_id ?? ctx.task?.conversation_id ?? "").trim();
    if (!runtime?.store?.getArtifactsForConversation) {
      return createActionResult({ success: false, observation: "Conversation artifact index is not available in this runtime." });
    }
    if (!conversationId) {
      return createActionResult({ success: false, observation: "list_conversation_artifacts requires an active conversation_id." });
    }
    const limit = clampLimit(args.limit, DEFAULT_RECENT_LIMIT);
    let artifacts;
    try {
      artifacts = runtime.store.getArtifactsForConversation(conversationId, { limit });
    } catch (error) {
      return createActionResult({ success: false, observation: `Conversation artifact lookup failed: ${error.message}` });
    }
    if (!artifacts.length) {
      return createActionResult({ success: true, observation: `No artifacts found for conversation_id=${conversationId}.` });
    }
    const lines = [`Artifacts for conversation_id=${conversationId}:`];
    for (const artifact of artifacts) {
      lines.push(`- ${artifact.path}`);
      lines.push(`    task_id=${artifact.task_id} created_at=${artifact.created_at ?? "(unknown)"}`);
    }
    return createActionResult({
      success: true,
      observation: formatObservation(lines),
      metadata: {
        conversation_id: conversationId,
        artifact_paths: artifacts.map((artifact) => artifact.path)
      }
    });
  }
};

export const MEMORY_TOOLS = Object.freeze([
  RECALL_MEMORY_TOOL,
  LIST_RECENT_TASKS_TOOL,
  GET_TASK_DETAIL_TOOL,
  LIST_CONVERSATION_ARTIFACTS_TOOL
]);
