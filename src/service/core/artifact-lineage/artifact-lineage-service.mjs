import crypto from "node:crypto";

export const ARTIFACT_LINEAGE_SCHEMA_VERSION = "1.0";

export const ARTIFACT_ACTIONS = Object.freeze({
  CREATE_NEW: "create_new",
  TRANSFORM: "transform",
  EDIT_IN_PLACE: "edit_in_place",
  DERIVE_VIEW: "derive_view"
});

const ACTION_VALUES = new Set(Object.values(ARTIFACT_ACTIONS));
const FAKE_TARGET_PATH_PATTERNS = [
  /^sandbox:/i,
  /^fake:/i,
  /^data:/i,
  /^about:/i,
  /(^|[\\/])sandbox([\\/]|$)/i,
  /(^|[\\/])download([\\/]|$)/i
];

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireStoreMethod(store, method) {
  if (typeof store?.[method] !== "function") {
    throw new Error(`ArtifactLineageService requires store.${method}`);
  }
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeAction(action) {
  const value = String(action ?? ARTIFACT_ACTIONS.CREATE_NEW).trim();
  return ACTION_VALUES.has(value) ? value : ARTIFACT_ACTIONS.CREATE_NEW;
}

function normalizeKind(kind) {
  const value = String(kind ?? "").trim().toLowerCase();
  return value || null;
}

function artifactKindMatches(actualKind, requestedKind) {
  const actual = normalizeKind(actualKind);
  const requested = normalizeKind(requestedKind);
  if (!requested) return true;
  return actual === requested;
}

function targetPathLooksFake(pathValue) {
  const value = String(pathValue ?? "").trim();
  if (!value) return true;
  return FAKE_TARGET_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

function sourceExtractRequirementSatisfied({
  sourceExtractIds = [],
  sourceExtractsByArtifact = new Map(),
  quality = {}
} = {}) {
  if (sourceExtractIds.length > 0) return true;
  for (const extracts of sourceExtractsByArtifact.values()) {
    if (Array.isArray(extracts) && extracts.length > 0) return true;
  }
  const extractQuality = normalizeObject(quality).source_extract ?? normalizeObject(quality).extract;
  return extractQuality?.status === "failed" && Boolean(String(extractQuality?.reason ?? "").trim());
}

export function validateArtifactTransformContract({
  action = ARTIFACT_ACTIONS.TRANSFORM,
  targetArtifact = null,
  sourceArtifactIds = [],
  sourceExtractIds = [],
  sourceExtractsByArtifact = new Map(),
  requestedKind = null,
  quality = {},
  lineage = null
} = {}) {
  const failures = [];
  const warnings = [];
  const normalizedAction = normalizeAction(action);
  const normalizedSourceArtifactIds = normalizeStringArray(sourceArtifactIds);
  const normalizedSourceExtractIds = normalizeStringArray(sourceExtractIds);

  if (normalizedAction !== ARTIFACT_ACTIONS.TRANSFORM) {
    failures.push("action_not_transform");
  }
  if (normalizedSourceArtifactIds.length === 0) {
    failures.push("missing_source_artifact");
  }
  if (!targetArtifact?.artifact_id) {
    failures.push("missing_target_artifact");
  }
  if (targetArtifact?.artifact_id && normalizedSourceArtifactIds.includes(targetArtifact.artifact_id)) {
    failures.push("target_matches_source_artifact");
  }
  if (targetArtifact && !artifactKindMatches(targetArtifact.kind, requestedKind)) {
    failures.push("target_kind_mismatch");
  }
  if (targetArtifact && targetPathLooksFake(targetArtifact.path)) {
    failures.push("fake_or_unstable_target_path");
  }
  if (!sourceExtractRequirementSatisfied({
    sourceExtractIds: normalizedSourceExtractIds,
    sourceExtractsByArtifact,
    quality
  })) {
    failures.push("missing_source_extract_or_quality_reason");
  }
  if (lineage && normalizeStringArray(lineage.source_artifact_ids).length === 0) {
    failures.push("lineage_missing_sources");
  }

  if (!requestedKind) {
    warnings.push("requested_kind_not_declared");
  }

  return {
    schema_version: ARTIFACT_LINEAGE_SCHEMA_VERSION,
    ok: failures.length === 0,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
    warnings
  };
}

export function createArtifactLineageService({ store, metrics = null } = {}) {
  for (const method of [
    "getArtifact",
    "appendArtifactLineage",
    "listArtifactLineageForArtifact",
    "listArtifactLineageForTask"
  ]) {
    requireStoreMethod(store, method);
  }

  function sourceExtractsByArtifact(sourceArtifactIds) {
    const byArtifact = new Map();
    if (typeof store.listArtifactExtractsForArtifact !== "function") return byArtifact;
    for (const artifactId of sourceArtifactIds) {
      byArtifact.set(artifactId, store.listArtifactExtractsForArtifact(artifactId, { limit: 8 }));
    }
    return byArtifact;
  }

  function appendLineage({
    lineageId = null,
    taskId = null,
    conversationId = null,
    action = ARTIFACT_ACTIONS.CREATE_NEW,
    targetArtifactId,
    targetKind = null,
    transformKind = null,
    sourceArtifactIds = [],
    sourceExtractIds = [],
    contract = {},
    validation = null,
    metadata = {},
    createdAt = null
  } = {}) {
    if (!targetArtifactId) {
      throw new Error("appendLineage: targetArtifactId required");
    }
    const normalizedAction = normalizeAction(action);
    const normalizedSourceArtifactIds = normalizeStringArray(sourceArtifactIds);
    const normalizedSourceExtractIds = normalizeStringArray(sourceExtractIds);
    const targetArtifact = store.getArtifact(targetArtifactId);
    const normalizedContract = {
      schema_version: ARTIFACT_LINEAGE_SCHEMA_VERSION,
      ...(normalizeObject(contract))
    };
    const computedValidation = validation ?? (
      normalizedAction === ARTIFACT_ACTIONS.TRANSFORM
        ? validateArtifactTransformContract({
          action: normalizedAction,
          targetArtifact,
          sourceArtifactIds: normalizedSourceArtifactIds,
          sourceExtractIds: normalizedSourceExtractIds,
          sourceExtractsByArtifact: sourceExtractsByArtifact(normalizedSourceArtifactIds),
          requestedKind: normalizedContract.requested_kind ?? targetKind,
          quality: normalizedContract.quality ?? {}
        })
        : {
          schema_version: ARTIFACT_LINEAGE_SCHEMA_VERSION,
          ok: true,
          status: "passed",
          failures: [],
          warnings: []
        }
    );
    const record = store.appendArtifactLineage({
      lineage_id: lineageId ?? newId("alineage"),
      task_id: taskId ?? targetArtifact?.task_id ?? null,
      conversation_id: conversationId ?? targetArtifact?.conversation_id ?? null,
      action: normalizedAction,
      target_artifact_id: targetArtifactId,
      target_kind: targetKind ?? targetArtifact?.kind ?? null,
      transform_kind: transformKind,
      source_artifact_ids: normalizedSourceArtifactIds,
      source_extract_ids: normalizedSourceExtractIds,
      contract: normalizedContract,
      validation: computedValidation,
      metadata: {
        schema_version: ARTIFACT_LINEAGE_SCHEMA_VERSION,
        ...(normalizeObject(metadata))
      },
      created_at: createdAt ?? nowIso()
    });
    metrics?.incrementRuntimeCounter?.("artifact.lineage.recorded", 1, {
      action: normalizedAction,
      status: computedValidation.status ?? "unknown"
    });
    return record;
  }

  function appendTransformLineage(options = {}) {
    const sourceArtifactIds = normalizeStringArray(options.sourceArtifactIds ?? options.source_artifact_ids);
    if (sourceArtifactIds.length === 0) {
      throw new Error("appendTransformLineage: sourceArtifactIds required");
    }
    return appendLineage({
      ...options,
      action: ARTIFACT_ACTIONS.TRANSFORM,
      targetArtifactId: options.targetArtifactId ?? options.target_artifact_id,
      targetKind: options.targetKind ?? options.target_kind,
      transformKind: options.transformKind ?? options.transform_kind,
      sourceArtifactIds,
      sourceExtractIds: options.sourceExtractIds ?? options.source_extract_ids
    });
  }

  return {
    appendLineage,
    appendTransformLineage,
    validateTransformContract: validateArtifactTransformContract,
    listForArtifact: (artifactId, options = {}) => store.listArtifactLineageForArtifact(artifactId, options),
    listForTask: (taskId, options = {}) => store.listArtifactLineageForTask(taskId, options)
  };
}
