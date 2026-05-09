import crypto from "node:crypto";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

export const ARTIFACT_TRANSFORM_SCHEMA_VERSION = "1.0";
export const ARTIFACT_TRANSFORM_KINDS = Object.freeze({
  XLSX_TO_PPTX: "xlsx_to_pptx"
});

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_TABLE_ROWS_PER_SLIDE = 8;
const MAX_TABLE_COLUMNS_PER_SLIDE = 6;

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function requireStoreMethod(store, method) {
  if (typeof store?.[method] !== "function") {
    throw new Error(`ArtifactTransformService requires store.${method}`);
  }
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactText(value, max = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function safeSheetName(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeRows(rows, width) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => Array.isArray(row) || row != null)
    .map((row) => (Array.isArray(row) ? row : [row])
      .slice(0, width)
      .map((cell) => compactText(cell, 90)))
    .filter((row) => row.some((cell) => cell !== ""));
}

function parseDelimitedRows(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,|\|/).map((cell) => cell.trim()).filter(Boolean))
    .filter((row) => row.length >= 2);
}

function tableFromExtract(extract, index) {
  const data = normalizeObject(extract?.data);
  const locator = normalizeObject(extract?.locator);
  const parsedRows = parseDelimitedRows(extract?.content_text);
  const headers = Array.isArray(data.headers) ? data.headers
    : Array.isArray(data.columns) ? data.columns
      : parsedRows[0] ?? [];
  const rows = Array.isArray(data.rows) ? data.rows
    : Array.isArray(data.sample_rows) ? data.sample_rows
      : parsedRows.slice(headers === parsedRows[0] ? 1 : 0);
  const normalizedHeaders = headers
    .slice(0, MAX_TABLE_COLUMNS_PER_SLIDE)
    .map((header, headerIndex) => compactText(header || `Column ${headerIndex + 1}`, 80));
  const normalizedRows = normalizeRows(rows, normalizedHeaders.length || MAX_TABLE_COLUMNS_PER_SLIDE)
    .slice(0, MAX_TABLE_ROWS_PER_SLIDE);
  return {
    extract_id: extract.extract_id,
    label: extract.label ?? safeSheetName(locator.sheet, `Table ${index + 1}`),
    sheet: safeSheetName(locator.sheet, extract.label ?? `Table ${index + 1}`),
    headers: normalizedHeaders,
    rows: normalizedRows,
    row_count: Number.isFinite(data.row_count) ? data.row_count : rows.length,
    column_count: Number.isFinite(data.column_count) ? data.column_count : normalizedHeaders.length
  };
}

function extractSummary(extracts) {
  const summary = extracts.find((extract) => extract.kind === "summary" && extract.content_text);
  if (summary) return compactText(summary.content_text, 360);
  const metadata = extracts.find((extract) => extract.kind === "metadata" && extract.content_text);
  if (metadata) return compactText(metadata.content_text, 360);
  return "";
}

export function buildXlsxToPptxOutline({ sourceArtifact, extracts = [] } = {}) {
  if (!sourceArtifact?.artifact_id) {
    return {
      ok: false,
      reason: "missing_source_artifact",
      outline: null,
      sourceExtractIds: []
    };
  }
  const tables = extracts
    .filter((extract) => extract?.kind === "table")
    .map((extract, index) => tableFromExtract(extract, index))
    .filter((table) => table.headers.length >= 2 && table.rows.length > 0);
  if (tables.length === 0) {
    return {
      ok: false,
      reason: "missing_table_extract",
      outline: null,
      sourceExtractIds: []
    };
  }

  const sourceName = path.basename(sourceArtifact.path ?? "workbook.xlsx");
  const summary = extractSummary(extracts);
  const slides = [
    {
      heading: "Workbook Summary",
      bullets: [
        `Source workbook: ${sourceName}`,
        `Detected table candidates: ${tables.length}`,
        summary || "Typed extracts were used to preserve workbook structure."
      ]
    },
    ...tables.map((table) => ({
      heading: table.sheet,
      body: `Rows: ${table.row_count}; Columns: ${table.column_count}`,
      table: {
        headers: table.headers,
        rows: table.rows
      }
    }))
  ];

  return {
    ok: true,
    reason: "ok",
    outline: {
      schema_version: ARTIFACT_TRANSFORM_SCHEMA_VERSION,
      transform_kind: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
      title: `Workbook Presentation: ${sourceName}`,
      subtitle: "Generated from typed workbook extracts",
      author: "LingxY",
      date: new Date().toISOString().slice(0, 10),
      slides
    },
    sourceExtractIds: tables.map((table) => table.extract_id).filter(Boolean),
    tables
  };
}

export function validateXlsxToPptxOutline(outline = {}) {
  const failures = [];
  const slides = Array.isArray(outline.slides) ? outline.slides : [];
  const tableSlides = slides.filter((slide) =>
    Array.isArray(slide?.table?.headers)
    && slide.table.headers.length >= 2
    && Array.isArray(slide?.table?.rows)
    && slide.table.rows.length > 0
  );
  if (slides.length < 2) failures.push("missing_summary_or_table_slides");
  if (tableSlides.length === 0) failures.push("missing_table_slide");
  if (slides.length === 1 && !slides[0]?.table) failures.push("one_slide_prose_dump");
  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? "passed" : "failed",
    failures
  };
}

async function fileMetadata(filePath) {
  const [info, bytes] = await Promise.all([
    stat(filePath),
    readFile(filePath)
  ]);
  return {
    bytes: info.size,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

export function createArtifactTransformService({
  store,
  actionToolRegistry,
  artifactLineage,
  conversationSessions = null,
  metrics = null
} = {}) {
  for (const method of [
    "getTask",
    "getArtifact",
    "appendArtifact",
    "listArtifactExtractsForArtifact"
  ]) {
    requireStoreMethod(store, method);
  }
  if (typeof actionToolRegistry?.call !== "function") {
    throw new Error("ArtifactTransformService requires actionToolRegistry.call");
  }
  if (typeof artifactLineage?.appendTransformLineage !== "function") {
    throw new Error("ArtifactTransformService requires artifactLineage.appendTransformLineage");
  }

  async function transformXlsxToPptx({
    taskId,
    sourceArtifactId,
    outputDir = null,
    filename = null,
    createdAt = null
  } = {}) {
    if (!taskId) throw new Error("transformXlsxToPptx: taskId required");
    if (!sourceArtifactId) throw new Error("transformXlsxToPptx: sourceArtifactId required");
    const task = store.getTask(taskId);
    const sourceArtifact = store.getArtifact(sourceArtifactId);
    if (!sourceArtifact) {
      return { success: false, reason: "source_artifact_not_found" };
    }
    if (sourceArtifact.kind !== "xlsx" && sourceArtifact.kind !== "spreadsheet") {
      return { success: false, reason: "source_artifact_not_xlsx", sourceArtifact };
    }
    const extracts = store.listArtifactExtractsForArtifact(sourceArtifactId, { limit: 40 });
    const built = buildXlsxToPptxOutline({ sourceArtifact, extracts });
    if (!built.ok) {
      return { success: false, reason: built.reason, sourceArtifact };
    }
    const outlineValidation = validateXlsxToPptxOutline(built.outline);
    if (!outlineValidation.ok) {
      return { success: false, reason: "outline_validation_failed", outlineValidation, outline: built.outline };
    }

    const targetFilename = filename
      ?? `${path.basename(sourceArtifact.path ?? "workbook.xlsx", path.extname(sourceArtifact.path ?? ""))}.pptx`;
    const toolResult = await actionToolRegistry.call("generate_document", {
      kind: "pptx",
      filename: targetFilename,
      outline: built.outline
    }, {
      runtime: { store },
      task,
      outputDir
    });
    if (!toolResult?.success) {
      return {
        success: false,
        reason: "generate_document_failed",
        toolResult,
        outline: built.outline
      };
    }

    const targetPath = toolResult.metadata?.path ?? toolResult.artifact_paths?.[0] ?? null;
    if (!targetPath) {
      return {
        success: false,
        reason: "missing_target_path",
        toolResult,
        outline: built.outline
      };
    }
    const metadata = await fileMetadata(targetPath);
    const targetArtifact = store.appendArtifact({
      artifact_id: newId("artifact"),
      task_id: taskId,
      conversation_id: task?.conversation_id ?? sourceArtifact.conversation_id ?? null,
      path: targetPath,
      mime_type: PPTX_MIME,
      kind: "pptx",
      source: "generated",
      status: "available",
      parent_artifact_id: sourceArtifactId,
      version_label: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
      bytes: metadata.bytes,
      sha256: metadata.sha256,
      created_at: createdAt ?? nowIso()
    });
    const lineage = artifactLineage.appendTransformLineage({
      taskId,
      conversationId: targetArtifact.conversation_id ?? null,
      targetArtifactId: targetArtifact.artifact_id,
      targetKind: "pptx",
      transformKind: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
      sourceArtifactIds: [sourceArtifactId],
      sourceExtractIds: built.sourceExtractIds,
      contract: {
        requested_kind: "pptx",
        source_kind: "xlsx",
        transform_kind: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
        outline_validation: outlineValidation,
        quality: {
          source_extract: { status: "available", count: extracts.length }
        }
      },
      metadata: {
        source_path: sourceArtifact.path ?? null,
        target_path: targetArtifact.path,
        table_count: built.tables.length
      },
      createdAt: createdAt ?? nowIso()
    });

    const conversationId = targetArtifact.conversation_id ?? task?.conversation_id ?? null;
    if (conversationId && typeof conversationSessions?.ensureSession === "function") {
      const session = conversationSessions.ensureSession({
        conversationId,
        projectId: task?.project_id ?? null,
        activeTaskId: taskId
      });
      conversationSessions.appendItem({
        sessionId: session.session_id,
        kind: "artifact_reference",
        taskId,
        artifactId: targetArtifact.artifact_id,
        content: `Transformed ${path.basename(sourceArtifact.path ?? sourceArtifactId)} to ${path.basename(targetArtifact.path)}`,
        payload: {
          action: "transform",
          transform_kind: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
          source_artifact_ids: [sourceArtifactId],
          target_artifact_id: targetArtifact.artifact_id,
          lineage_id: lineage.lineage_id
        },
        provenance: {
          source: "artifact_transform_service"
        }
      });
    }

    metrics?.incrementRuntimeCounter?.("artifact.transform.completed", 1, {
      transform: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
      status: "success"
    });

    return {
      success: true,
      transform_kind: ARTIFACT_TRANSFORM_KINDS.XLSX_TO_PPTX,
      sourceArtifact,
      targetArtifact,
      lineage,
      outline: built.outline,
      outlineValidation,
      toolResult
    };
  }

  return {
    transformXlsxToPptx,
    buildXlsxToPptxOutline,
    validateXlsxToPptxOutline
  };
}
