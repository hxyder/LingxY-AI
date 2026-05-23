export const CONTEXT_SELECTION_PROJECT_PACK_VERSION = 1;

function list(value) {
  return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
}

function clean(value) {
  return `${value ?? ""}`.trim();
}

function basename(filePath = "") {
  const text = clean(filePath);
  return text.split(/[\\/]/).filter(Boolean).pop() ?? text;
}

function itemReason(item = {}, fallback = "") {
  return clean(item.reason ?? item.inclusion_reason ?? item.omission_reason ?? fallback);
}

function countBy(items = [], key = "kind") {
  const counts = {};
  for (const item of items) {
    const value = clean(item?.[key] ?? "unknown") || "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function summarizeContextItem(item = {}, fallbackReason = "") {
  const value = item.value ?? {};
  return {
    kind: clean(item.kind) || "unknown",
    source: clean(item.source) || "runtime",
    reason: itemReason(item, fallbackReason),
    provenance: {
      taskId: value.task_id ?? item.task_id ?? null,
      artifactId: value.artifact_id ?? item.artifact_id ?? null,
      sessionId: value.session_id ?? item.session_id ?? null,
      messageId: value.message_id ?? item.message_id ?? null,
      path: item.path ?? value.path ?? null
    }
  };
}

function attachmentEntries(ctx = {}) {
  return [
    ...list(ctx.file_paths).map((path) => ({
      kind: "file",
      path,
      label: basename(path),
      source: "context_packet.file_paths"
    })),
    ...list(ctx.image_paths).map((path) => ({
      kind: "image",
      path,
      label: basename(path),
      source: "context_packet.image_paths"
    }))
  ];
}

export function buildContextSelectionProjectPack(task = {}) {
  const ctx = task.context_packet ?? {};
  const metadata = ctx.selection_metadata ?? {};
  const compiled = ctx.compiled_context ?? {};
  const selected = list(compiled.selected).map((item) => summarizeContextItem(item, "selected_by_context_compiler"));
  const omitted = list(compiled.omissions).map((item) => summarizeContextItem(item, "omitted_by_context_compiler"));
  const attachments = attachmentEntries(ctx);
  const branch = task.metadata?.branch ?? metadata.branch ?? null;
  const conversationId = task.conversation_id ?? metadata.conversation_id ?? compiled.conversation_id ?? null;
  const projectId = task.project_id ?? metadata.project_id ?? null;

  return {
    schemaVersion: CONTEXT_SELECTION_PROJECT_PACK_VERSION,
    conversation: {
      conversationId,
      parentTaskId: task.parent_task_id ?? metadata.parent_task_id ?? compiled.parent_task_id ?? null,
      branch: branch && typeof branch === "object"
        ? {
            kind: branch.kind ?? "branch",
            sourceConversationId: branch.source_conversation_id ?? branch.source ?? null,
            sourceMessageId: branch.source_message_id ?? null
          }
        : null
    },
    project: {
      projectId,
      scoped: Boolean(projectId),
      memoryScope: metadata.memory_scope ?? (projectId ? "project" : "global"),
      packId: projectId ? `project:${projectId}` : "global"
    },
    attachments: {
      count: attachments.length,
      files: attachments.filter((entry) => entry.kind === "file"),
      images: attachments.filter((entry) => entry.kind === "image")
    },
    context: {
      selectedCount: selected.length,
      omittedCount: Number(compiled.omitted_count ?? omitted.length),
      candidateCount: compiled.stats?.candidate_count ?? null,
      selectedKinds: countBy(selected),
      omittedKinds: countBy(omitted),
      selected,
      omitted
    }
  };
}
