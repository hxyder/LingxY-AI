import { performance } from "node:perf_hooks";

export const COMPILED_CONTEXT_SCHEMA_VERSION = "1.0";
export const CONTEXT_COMPILER_OWNER = "service/runtime";

const DEFAULT_LIMITS = Object.freeze({
  maxItems: 32,
  maxTextChars: 8000,
  maxOmissions: 64
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
    ...item
  });
}

function collectCandidates({ task = {}, extraItems = [] } = {}) {
  const ctx = task.context_packet ?? {};
  const candidates = [];

  pushCandidate(candidates, {
    kind: "current_user_command",
    source: "task",
    trust: "user",
    content: cleanText(task.user_command),
    reason: "current task command is always the active intent anchor"
  });

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

  for (const [index, artifact] of toArray(ctx.recent_conversation_artifacts).entries()) {
    pushCandidate(candidates, {
      kind: "recent_artifact",
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

    selected.push(item);
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
  const candidates = collectCandidates({ task, extraItems });
  const selection = selectCandidates(candidates, resolvedLimits);
  const compiled = {
    schema_version: COMPILED_CONTEXT_SCHEMA_VERSION,
    owner: CONTEXT_COMPILER_OWNER,
    compiled_at: now.toISOString(),
    task_id: task?.task_id ?? null,
    conversation_id: task?.conversation_id ?? null,
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
