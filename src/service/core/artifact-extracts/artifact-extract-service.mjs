import crypto from "node:crypto";

export const ARTIFACT_EXTRACT_SCHEMA_VERSION = "1.0";

export const ARTIFACT_EXTRACT_KINDS = Object.freeze({
  TEXT: "text",
  SECTION: "section",
  TABLE: "table",
  IMAGE: "image",
  METADATA: "metadata",
  SUMMARY: "summary"
});

const MAX_EXTRACT_TEXT_CHARS = 20000;

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireStoreMethod(store, method) {
  if (typeof store?.[method] !== "function") {
    throw new Error(`ArtifactExtractService requires store.${method}`);
  }
}

function normalizeKind(kind) {
  const value = String(kind ?? ARTIFACT_EXTRACT_KINDS.TEXT).trim();
  return value || ARTIFACT_EXTRACT_KINDS.TEXT;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function truncateText(value) {
  const text = String(value ?? "");
  if (text.length <= MAX_EXTRACT_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACT_TEXT_CHARS)}...[truncated ${text.length} chars]`;
}

export function createArtifactExtractService({ store, metrics = null } = {}) {
  for (const method of [
    "appendArtifactExtract",
    "listArtifactExtractsForArtifact",
    "listArtifactExtractsForTask"
  ]) {
    requireStoreMethod(store, method);
  }

  function appendExtract({
    extractId = null,
    artifactId,
    taskId = null,
    conversationId = null,
    kind = ARTIFACT_EXTRACT_KINDS.TEXT,
    label = null,
    locator = {},
    content = null,
    contentText = null,
    data = null,
    source = "artifact_extract_service",
    confidence = null,
    metadata = {},
    createdAt = null
  } = {}) {
    if (!artifactId) {
      throw new Error("appendExtract: artifactId required");
    }
    const record = store.appendArtifactExtract({
      extract_id: extractId ?? newId("aext"),
      artifact_id: artifactId,
      task_id: taskId,
      conversation_id: conversationId,
      kind: normalizeKind(kind),
      label,
      locator: normalizeObject(locator),
      content_text: truncateText(contentText ?? content),
      data,
      source,
      confidence: Number.isFinite(confidence) ? confidence : null,
      metadata: {
        schema_version: ARTIFACT_EXTRACT_SCHEMA_VERSION,
        ...(normalizeObject(metadata))
      },
      created_at: createdAt ?? nowIso()
    });
    metrics?.incrementRuntimeCounter?.("artifact.extract.recorded", 1, {
      source: "artifact_extract_service",
      status: record.kind
    });
    return record;
  }

  return {
    appendExtract,
    listForArtifact: (artifactId, options = {}) => store.listArtifactExtractsForArtifact(artifactId, options),
    listForTask: (taskId, options = {}) => store.listArtifactExtractsForTask(taskId, options)
  };
}
