import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildXlsxToPptxOutline,
  validateXlsxToPptxOutline
} from "../../src/service/core/artifact-transforms/artifact-transform-service.mjs";
import { createArtifactExtractService } from "../../src/service/core/artifact-extracts/artifact-extract-service.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { ensureRuntimeServices } from "../../src/service/core/task-runtime/runtime-services.mjs";

function taskRecord(taskId, conversationId) {
  return {
    task_id: taskId,
    conversation_id: conversationId,
    created_at: "2026-05-09T06:00:00.000Z",
    updated_at: "2026-05-09T06:00:00.000Z",
    status: "running",
    sub_status: "executing",
    intent: "general",
    executor: "agentic",
    source_type: "conversation",
    user_command: "把上一个 Excel 转成 PPT",
    execution_mode: "interactive",
    context_packet: { source_type: "conversation" }
  };
}

function seedWorkbook(store) {
  store.insertTask(taskRecord("task_transform_seed", "conv_transform_seed"));
  return store.appendArtifact({
    artifact_id: "artifact_workbook_seed",
    task_id: "task_transform_seed",
    conversation_id: "conv_transform_seed",
    path: "E:\\linxiDoc\\task_transform_seed\\budget.xlsx",
    kind: "xlsx",
    created_at: "2026-05-09T06:01:00.000Z"
  });
}

function seedWorkbookExtracts(store, artifactId) {
  const extracts = createArtifactExtractService({ store });
  extracts.appendExtract({
    artifactId,
    kind: "summary",
    label: "Workbook summary",
    content: "Budget workbook contains revenue and expense tables by quarter.",
    createdAt: "2026-05-09T06:02:00.000Z"
  });
  extracts.appendExtract({
    artifactId,
    kind: "table",
    label: "Revenue",
    locator: { sheet: "Revenue", rows: [1, 4] },
    data: {
      headers: ["Region", "Q1 Revenue", "Q2 Revenue"],
      rows: [
        ["North", 120, 150],
        ["South", 90, 110]
      ],
      row_count: 2,
      column_count: 3
    },
    content: "Region,Q1 Revenue,Q2 Revenue\nNorth,120,150\nSouth,90,110",
    createdAt: "2026-05-09T06:03:00.000Z"
  });
  extracts.appendExtract({
    artifactId,
    kind: "table",
    label: "Expenses",
    locator: { sheet: "Expenses", rows: [1, 4] },
    data: {
      headers: ["Department", "Budget", "Spend"],
      rows: [
        ["Product", 75, 68],
        ["Sales", 64, 70]
      ],
      row_count: 2,
      column_count: 3
    },
    content: "Department,Budget,Spend\nProduct,75,68\nSales,64,70",
    createdAt: "2026-05-09T06:04:00.000Z"
  });
}

function countPptxSlides(buffer) {
  const names = new Set(String(buffer).match(/ppt\/slides\/slide\d+\.xml/g) ?? []);
  return names.size;
}

test("typed xlsx to pptx transform creates a real PPTX, lineage, and session artifact reference", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-xlsx-pptx-"));
  try {
    const store = createInMemoryStoreScaffold();
    const source = seedWorkbook(store);
    seedWorkbookExtracts(store, source.artifact_id);
    const runtime = {
      store,
      queue: { snapshot() { return { queued: 0, running: 0 }; } },
      eventBus: { publish() {} }
    };
    ensureRuntimeServices(runtime);

    const result = await runtime.artifactTransforms.transformXlsxToPptx({
      taskId: "task_transform_seed",
      sourceArtifactId: source.artifact_id,
      outputDir,
      filename: "budget-transform.pptx",
      createdAt: "2026-05-09T06:05:00.000Z"
    });

    assert.equal(result.success, true);
    assert.equal(result.transform_kind, "xlsx_to_pptx");
    assert.equal(result.targetArtifact.kind, "pptx");
    assert.equal(result.targetArtifact.parent_artifact_id, source.artifact_id);
    assert.equal(result.lineage.validation.ok, true);
    assert.deepEqual(result.lineage.source_artifact_ids, [source.artifact_id]);
    assert.equal(result.lineage.target_artifact_id, result.targetArtifact.artifact_id);
    assert.ok(result.outline.slides.length >= 3);

    const pptx = await readFile(result.targetArtifact.path);
    assert.ok(countPptxSlides(pptx) >= 3);
    const preview = await readFile(result.toolResult.metadata.preview_html_path, "utf8");
    assert.match(preview, /Revenue/);
    assert.match(preview, /Q1 Revenue/);
    assert.match(preview, /Expenses/);
    assert.match(preview, /Budget/);

    const session = runtime.conversationSessions.getLatestForConversation("conv_transform_seed");
    const items = runtime.conversationSessions.listItems(session.session_id);
    const artifactReference = items.find((item) => item.kind === "artifact_reference");
    assert.ok(artifactReference);
    assert.equal(artifactReference.artifact_id, result.targetArtifact.artifact_id);
    assert.equal(artifactReference.payload.lineage_id, result.lineage.lineage_id);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("xlsx to pptx outline builder requires table extracts and preserves headers", () => {
  const sourceArtifact = {
    artifact_id: "artifact_source",
    path: "E:\\source.xlsx",
    kind: "xlsx"
  };
  const missing = buildXlsxToPptxOutline({ sourceArtifact, extracts: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_table_extract");

  const built = buildXlsxToPptxOutline({
    sourceArtifact,
    extracts: [{
      extract_id: "extract_table",
      kind: "table",
      label: "Sheet1",
      content_text: "Name,Total\nAda,42"
    }]
  });
  assert.equal(built.ok, true);
  assert.deepEqual(built.outline.slides[1].table.headers, ["Name", "Total"]);
});

test("xlsx to pptx validator rejects one-slide prose dumps", () => {
  const validation = validateXlsxToPptxOutline({
    title: "Fake deck",
    slides: [{ heading: "Summary", bullets: ["A prose-only slide."] }]
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.failures.includes("one_slide_prose_dump"));
  assert.ok(validation.failures.includes("missing_table_slide"));
});
