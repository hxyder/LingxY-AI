import { performance } from "node:perf_hooks";
import { SESSION_ITEM_KINDS } from "../session/conversation-session-service.mjs";

export const COMPILED_CONTEXT_SCHEMA_VERSION = "1.0";
export const CONTEXT_COMPILER_OWNER = "service/runtime";
export const CONTEXT_ITEM_PRIORITIES = Object.freeze({
  current_user_command: 1000,
  follow_up_resolution: 950,
  parent_task_summary: 900,
  attached_file: 850,
  attached_image: 840,
  latest_artifact: 830,
  recent_artifact: 820,
  artifact_extract_summary: 815,
  artifact_extract_text: 810,
  artifact_extract_section: 808,
  artifact_extract_table: 806,
  artifact_extract_metadata: 804,
  project_scope: 790,
  session_task_anchor: 760,
  session_artifact_reference: 750,
  session_compaction: 735,
  session_tool_observation: 720,
  session_tool_call: 700,
  prior_message: 520,
  captured_text: 500,
  background_context: 450,
  extra: 300
});

const DEFAULT_LIMITS = Object.freeze({
  maxItems: 32,
  maxTextChars: 8000,
  maxOmissions: 64,
  sessionItemLimit: 200,
  artifactExtractLimit: 24,
  perArtifactExtractLimit: 4
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

function stableItemId(kind, source, index) {
  return `ctx_${kind}_${source}_${index}`;
}

function priorityForKind(kind) {
  return CONTEXT_ITEM_PRIORITIES[kind] ?? CONTEXT_ITEM_PRIORITIES.extra;
}

function estimateChars(item = {}) {
  return JSON.stringify(item.content ?? item.value ?? item.path ?? "").length;
}

function maybeTruncateText(text, maxChars) {
  const raw = String(text ?? "");
  if (raw.length <= maxChars) return { text: raw, truncated: false };
  return {
    text: raw.slice(0, Math.max(0, maxChars)),
    truncated: true
  };
}

function pushCandidate(candidates, item) {
  if (!item?.kind || !item?.reason) return;
  candidates.push({
    id: item.id ?? stableItemId(item.kind, item.source ?? "runtime", candidates.length),
    source: item.source ?? "runtime",
    trust: item.trust ?? "runtime",
    priority: Number.isFinite(item.priority) ? item.priority : priorityForKind(item.kind),
    inclusion_reason: item.inclusion_reason ?? item.reason,
    ...item
  });
}

function getLatestSessionForTask(task, runtime) {
  const conversationId = task?.conversation_id;
  if (!conversationId) return null;
  try {
    return runtime?.conversationSessions?.getLatestForConversation?.(conversationId)
      ?? runtime?.store?.getLatestConversationSession?.(conversationId)
      ?? null;
  } catch {
    return null;
  }
}

function listSessionItems(sessionId, runtime, limits) {
  if (!sessionId) return [];
  try {
    const items = runtime?.conversationSessions?.listItems?.(sessionId, {
      limit: limits.sessionItemLimit
    }) ?? runtime?.store?.listSessionItems?.(sessionId, {
      limit: limits.sessionItemLimit
    }) ?? [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function getLatestSessionCompaction(sessionId, runtime) {
  if (!sessionId) return null;
  try {
    return runtime?.sessionCompactions?.latestForSession?.(sessionId)
      ?? runtime?.store?.getLatestSessionCompaction?.(sessionId)
      ?? null;
  } catch {
    return null;
  }
}

function sessionItemCandidateKind(item) {
  switch (item?.kind) {
    case SESSION_ITEM_KINDS.TASK_ANCHOR:
      return "session_task_anchor";
    case SESSION_ITEM_KINDS.TOOL_CALL:
      return "session_tool_call";
    case SESSION_ITEM_KINDS.TOOL_OBSERVATION:
      return "session_tool_observation";
    case SESSION_ITEM_KINDS.ARTIFACT_REFERENCE:
      return "session_artifact_reference";
    default:
      return null;
  }
}

function sessionItemReason(kind) {
  switch (kind) {
    case "session_task_anchor":
      return "typed session task anchor links the conversation work thread to a task";
    case "session_tool_call":
      return "typed session tool call records what action was attempted";
    case "session_tool_observation":
      return "typed session tool observation records execution evidence for continuity";
    case "session_artifact_reference":
      return "typed session artifact reference can be a follow-up target";
    default:
      return "typed session item is available to the context compiler";
  }
}

function collectSessionCandidates(candidates, { task = {}, runtime = null, limits }) {
  const session = getLatestSessionForTask(task, runtime);
  const compaction = getLatestSessionCompaction(session?.session_id, runtime);
  if (compaction?.summary_text) {
    pushCandidate(candidates, {
      id: compaction.compaction_id ? `ctx_session_compaction_${compaction.compaction_id}` : undefined,
      kind: "session_compaction",
      source: "conversation_session.session_compactions",
      trust: "runtime_session_compaction",
      content: cleanText(compaction.summary_text),
      value: {
        compaction_id: compaction.compaction_id ?? null,
        session_id: compaction.session_id ?? session?.session_id ?? null,
        conversation_id: compaction.conversation_id ?? session?.conversation_id ?? null,
        source_start_order: compaction.source_start_order ?? null,
        source_end_order: compaction.source_end_order ?? null,
        source_item_count: compaction.source_item_count ?? null,
        facts: Array.isArray(compaction.facts) ? compaction.facts.slice(0, 12) : [],
        open_threads: Array.isArray(compaction.open_threads) ? compaction.open_threads.slice(0, 8) : [],
        artifact_ids: Array.isArray(compaction.artifact_ids) ? compaction.artifact_ids.slice(0, 12) : [],
        task_ids: Array.isArray(compaction.task_ids) ? compaction.task_ids.slice(0, 12) : []
      },
      reason: "deterministic session compaction summarizes older typed session items without reading transcript tails"
    });
  }
  const items = listSessionItems(session?.session_id, runtime, limits);
  for (const [index, item] of items.entries()) {
    const kind = sessionItemCandidateKind(item);
    if (!kind) continue;
    pushCandidate(candidates, {
      id: item.item_id ? `ctx_session_${item.item_id}` : stableItemId(kind, "session_items", index),
      kind,
      source: "conversation_session.session_items",
      trust: "runtime_session",
      role: item.role ?? null,
      content: cleanText(item.content_text),
      value: {
        session_id: item.session_id ?? session?.session_id ?? null,
        item_id: item.item_id ?? null,
        order_index: Number.isInteger(item.order_index) ? item.order_index : null,
        task_id: item.task_id ?? null,
        artifact_id: item.artifact_id ?? null,
        tool_id: item.payload?.tool_id ?? null,
        tool_call_id: item.payload?.tool_call_id ?? null,
        success: item.payload?.success ?? null,
        parent_task_id: item.payload?.parent_task_id ?? null,
        is_continuation: item.payload?.is_continuation ?? null
      },
      reason: sessionItemReason(kind)
    });
  }
}

function artifactExtractCandidateKind(extract) {
  switch (extract?.kind) {
    case "summary":
      return "artifact_extract_summary";
    case "section":
      return "artifact_extract_section";
    case "table":
      return "artifact_extract_table";
    case "metadata":
      return "artifact_extract_metadata";
    default:
      return "artifact_extract_text";
  }
}

function listArtifactExtractsForArtifact(artifactId, runtime, limits) {
  if (!artifactId) return [];
  try {
    const extracts = runtime?.artifactExtracts?.listForArtifact?.(artifactId, {
      limit: limits.perArtifactExtractLimit
    }) ?? runtime?.store?.listArtifactExtractsForArtifact?.(artifactId, {
      limit: limits.perArtifactExtractLimit
    }) ?? [];
    return Array.isArray(extracts) ? extracts : [];
  } catch {
    return [];
  }
}

function collectArtifactExtractCandidates(candidates, { artifacts = [], runtime = null, limits }) {
  let count = 0;
  for (const artifact of artifacts) {
    if (count >= limits.artifactExtractLimit) break;
    const extracts = listArtifactExtractsForArtifact(artifact?.artifact_id, runtime, limits);
    for (const extract of extracts) {
      if (count >= limits.artifactExtractLimit) break;
      const kind = artifactExtractCandidateKind(extract);
      pushCandidate(candidates, {
        id: extract.extract_id ? `ctx_artifact_extract_${extract.extract_id}` : undefined,
        kind,
        source: "artifact_extracts",
        trust: "runtime_artifact_extract",
        content: cleanText(extract.content_text),
        value: {
          extract_id: extract.extract_id ?? null,
          artifact_id: extract.artifact_id ?? artifact?.artifact_id ?? null,
          task_id: extract.task_id ?? artifact?.task_id ?? null,
          conversation_id: extract.conversation_id ?? null,
          extract_kind: extract.kind ?? null,
          label: extract.label ?? null,
          locator: extract.locator ?? {},
          data: extract.data ?? null,
          confidence: extract.confidence ?? null
        },
        reason: "typed artifact extract exposes artifact content without reading the file on the task hot path"
      });
      count += 1;
    }
  }
}

function collectProjectScopeCandidate(candidates, { task = {}, runtime = null } = {}) {
  const projectId = task?.project_id ?? task?.context_packet?.selection_metadata?.project_id ?? null;
  if (!projectId) return;
  let workspace = null;
  try {
    workspace = runtime?.projectWorkspaces?.getProjectWorkspace?.(projectId, {
      conversationLimit: 20,
      fileLimit: 50,
      artifactLimit: 20
    }) ?? null;
  } catch {
    workspace = null;
  }
  if (!workspace?.project) return;
  pushCandidate(candidates, {
    kind: "project_scope",
    source: "project_workspace",
    trust: "runtime_project",
    value: {
      project_id: workspace.project_id,
      name: workspace.project.name ?? null,
      instructions: typeof workspace.project.metadata?.instructions === "string"
        ? workspace.project.metadata.instructions.slice(0, 4000)
        : "",
      file_paths: workspace.files.map((file) => file.path).slice(0, 20),
      conversation_ids: workspace.conversations.map((conversation) => conversation.conversation_id).slice(0, 20),
      artifact_ids: workspace.artifacts.map((artifact) => artifact.artifact_id).filter(Boolean).slice(0, 20),
      stats: workspace.stats
    },
    reason: "service-owned project workspace groups this task with project conversations and files"
  });
}

function suppressesPriorContext(contextPacket = {}) {
  return contextPacket?.selection_metadata?.context_focus?.prior_context_suppressed === true;
}

function collectCandidates({ task = {}, runtime = null, extraItems = [], limits = DEFAULT_LIMITS } = {}) {
  const ctx = task.context_packet ?? {};
  const candidates = [];
  const suppressPrior = suppressesPriorContext(ctx);

  pushCandidate(candidates, {
    kind: "current_user_command",
    source: "task",
    trust: "user",
    content: cleanText(task.user_command),
    reason: "current task command is always the active intent anchor"
  });

  const followUpResolution = ctx.selection_metadata?.follow_up_resolution;
  if (followUpResolution && typeof followUpResolution === "object") {
    pushCandidate(candidates, {
      kind: "follow_up_resolution",
      source: "context_packet.selection_metadata.follow_up_resolution",
      trust: "runtime_decision",
      value: {
        mode: followUpResolution.mode ?? null,
        parent_task_id: followUpResolution.parent_task_id ?? null,
        confidence: followUpResolution.confidence ?? null,
        should_continue: followUpResolution.should_continue ?? null,
        anchors: Array.isArray(followUpResolution.anchors)
          ? followUpResolution.anchors.slice(0, 4)
          : []
      },
      reason: "FollowUpResolver decision determines whether prior work is an active context target"
    });
  }

  if (ctx.parent_task_summary && typeof ctx.parent_task_summary === "object") {
    pushCandidate(candidates, {
      kind: "parent_task_summary",
      source: "context_packet.parent_task_summary",
      trust: "runtime_summary",
      content: cleanText(ctx.parent_task_summary.assistant_final_text),
      value: {
        parent_task_id: ctx.parent_task_summary.parent_task_id ?? task.parent_task_id ?? null
      },
      reason: "parent task summary is the bounded result text for the selected follow-up parent"
    });
  }

  if (!suppressPrior) {
    for (const [index, message] of toArray(ctx.prior_messages).entries()) {
      pushCandidate(candidates, {
        kind: "prior_message",
        source: "context_packet.prior_messages",
        trust: "conversation",
        role: message?.role ?? "unknown",
        content: cleanText(message?.content ?? message?.text ?? ""),
        reason: "prior message supplied by conversation context"
      });
      if (index >= 11) break;
    }
  }

  for (const [index, background] of toArray(ctx.background_contexts).entries()) {
    pushCandidate(candidates, {
      kind: background?.kind ?? "background_context",
      source: "context_packet.background_contexts",
      trust: background?.trust ?? "runtime",
      value: background,
      reason: background?.reason ?? "runtime background context"
    });
    if (index >= 15) break;
  }

  for (const [index, filePath] of toArray(ctx.file_paths).entries()) {
    pushCandidate(candidates, {
      kind: "attached_file",
      source: "context_packet.file_paths",
      trust: "user_selected_path",
      path: String(filePath),
      reason: "user-selected file path is an explicit context anchor"
    });
    if (index >= 15) break;
  }

  for (const [index, imagePath] of toArray(ctx.image_paths).entries()) {
    pushCandidate(candidates, {
      kind: "attached_image",
      source: "context_packet.image_paths",
      trust: "user_selected_path",
      path: String(imagePath),
      reason: "user-selected image path is an explicit context anchor"
    });
    if (index >= 15) break;
  }

  const recentArtifacts = suppressPrior ? [] : toArray(ctx.recent_conversation_artifacts);
  for (const [index, artifact] of recentArtifacts.entries()) {
    pushCandidate(candidates, {
      kind: index === 0 ? "latest_artifact" : "recent_artifact",
      source: "context_packet.recent_conversation_artifacts",
      trust: "runtime",
      value: {
        artifact_id: artifact?.artifact_id ?? null,
        task_id: artifact?.task_id ?? null,
        kind: artifact?.kind ?? null,
        path: artifact?.path ?? null,
        created_at: artifact?.created_at ?? null
      },
      reason: "recent conversation artifact may be the target of a follow-up"
    });
    if (index >= 15) break;
  }

  collectArtifactExtractCandidates(candidates, {
    artifacts: recentArtifacts,
    runtime,
    limits
  });

  collectProjectScopeCandidate(candidates, { task, runtime });

  if (!suppressPrior) {
    collectSessionCandidates(candidates, { task, runtime, limits });
  }

  const capturedText = cleanText(ctx.text);
  if (capturedText) {
    pushCandidate(candidates, {
      kind: "captured_text",
      source: "context_packet.text",
      trust: "untrusted_source",
      content: capturedText,
      reason: "captured text is available as source material, not instructions"
    });
  }

  for (const [index, item] of toArray(extraItems).entries()) {
    pushCandidate(candidates, {
      ...item,
      source: item?.source ?? "extra_items",
      reason: item?.reason ?? "explicit extra context item",
      id: item?.id ?? stableItemId(item?.kind ?? "extra", "extra_items", index)
    });
  }

  return candidates.filter((item) => {
    const hasPath = typeof item.path === "string" && item.path.trim();
    const hasContent = typeof item.content === "string" && item.content.trim();
    const hasValue = item.value !== undefined && item.value !== null;
    return hasPath || hasContent || hasValue;
  });
}

function rankCandidates(candidates) {
  return candidates
    .map((candidate, originalIndex) => ({ ...candidate, original_index: originalIndex }))
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.original_index - right.original_index;
    });
}

function selectCandidates(candidates, limits) {
  const selected = [];
  const omissions = [];
  let textChars = 0;

  for (const candidate of candidates) {
    if (selected.length >= limits.maxItems) {
      omissions.push({
        id: candidate.id,
        kind: candidate.kind,
        source: candidate.source,
        reason: "omitted_by_item_budget"
      });
      continue;
    }

    const item = { ...candidate };
    const candidateChars = estimateChars(item);
    if (typeof item.content === "string" && textChars + candidateChars > limits.maxTextChars) {
      const remaining = Math.max(0, limits.maxTextChars - textChars);
      const truncated = maybeTruncateText(item.content, remaining);
      if (!truncated.text.trim()) {
        omissions.push({
          id: item.id,
          kind: item.kind,
          source: item.source,
          reason: "omitted_by_text_budget"
        });
        continue;
      }
      item.content = truncated.text;
      item.truncated = true;
      textChars = limits.maxTextChars;
    } else {
      textChars += candidateChars;
    }

    selected.push({
      ...item,
      decision: "selected",
      inclusion_reason: item.inclusion_reason ?? item.reason
    });
  }

  return {
    selected,
    omissions: omissions.slice(0, limits.maxOmissions),
    omitted_count: omissions.length,
    text_chars: textChars
  };
}

function recordMetrics(metrics, durationMs, compiled) {
  metrics?.recordRuntimeTiming?.("context.compile", durationMs, {
    source: "context_compiler",
    status: "success"
  });
  metrics?.incrementRuntimeCounter?.("context.selected_items", compiled.selected.length, {
    source: "context_compiler"
  });
  if (compiled.omitted_count > 0) {
    metrics?.incrementRuntimeCounter?.("context.omitted_items", compiled.omitted_count, {
      source: "context_compiler"
    });
  }
}

export function compileContextForTask({
  task,
  runtime = null,
  extraItems = [],
  limits = {},
  debug = false,
  now = new Date()
} = {}) {
  const startedAt = performance.now();
  const resolvedLimits = {
    ...DEFAULT_LIMITS,
    ...limits
  };
  const candidates = rankCandidates(collectCandidates({ task, runtime, extraItems, limits: resolvedLimits }));
  const selection = selectCandidates(candidates, resolvedLimits);
  const compiled = {
    schema_version: COMPILED_CONTEXT_SCHEMA_VERSION,
    owner: CONTEXT_COMPILER_OWNER,
    compiled_at: now.toISOString(),
    task_id: task?.task_id ?? null,
    conversation_id: task?.conversation_id ?? null,
    project_id: task?.project_id ?? task?.context_packet?.selection_metadata?.project_id ?? null,
    parent_task_id: task?.parent_task_id ?? null,
    limits: resolvedLimits,
    selected: selection.selected,
    omissions: selection.omissions,
    omitted_count: selection.omitted_count,
    stats: {
      candidate_count: candidates.length,
      selected_count: selection.selected.length,
      omitted_count: selection.omitted_count,
      text_chars: selection.text_chars
    }
  };

  if (debug) {
    compiled.debug_trace = {
      candidates
    };
  }

  recordMetrics(runtime?.metrics, performance.now() - startedAt, compiled);
  return compiled;
}
