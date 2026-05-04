import test from "node:test";
import assert from "node:assert/strict";

import { buildFileContentIndexRecords } from "../../src/service/core/file-content-index-records.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";
import { EMBEDDING_NAMESPACES } from "../../src/service/embeddings/store.mjs";

test("file content index records preserve coverage and lineage metadata", () => {
  const [record] = buildFileContentIndexRecords({
    task: { task_id: "task_a", conversation_id: "conv_a", project_id: "project_a" },
    toolId: "read_folder_text",
    result: {
      success: true,
      observation: "Extracted text from files\n\n--- a.md ---\nAlpha",
      metadata: {
        path: "E:\\workspace",
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        content_extracted: true,
        recursive: true,
        chars_extracted: 42,
        truncated: true,
        files: [
          { path: "E:\\workspace\\a.md", success: true, chars_extracted: 5, truncated: false }
        ]
      }
    },
    artifact: {
      artifact_id: "artifact_a",
      revision_of: "artifact_root"
    },
    createdAt: "2026-05-04T00:00:00.000Z"
  });

  assert.equal(record.namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
  assert.equal(record.metadata.namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
  assert.equal(record.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT);
  assert.equal(record.metadata.task_id, "task_a");
  assert.equal(record.metadata.conversation_id, "conv_a");
  assert.equal(record.metadata.project_id, "project_a");
  assert.equal(record.metadata.artifact_id, "artifact_a");
  assert.equal(record.metadata.revision_of, "artifact_root");
  assert.equal(record.metadata.files[0].path, "E:\\workspace\\a.md");
  assert.equal(record.metadata.truncated, true);
  assert.match(record.text, /Alpha/);
});

test("file content index records ignore shallow file listings", () => {
  const records = buildFileContentIndexRecords({
    task: { task_id: "task_b" },
    toolId: "list_files",
    result: {
      success: true,
      observation: "a.md",
      metadata: {
        coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
        content_extracted: false
      }
    }
  });

  assert.deepEqual(records, []);
});

test("file content index records use stable ids for the same evidence", () => {
  const input = {
    task: { task_id: "task_c", conversation_id: "conv_c" },
    toolId: "read_file_text",
    result: {
      success: true,
      observation: "Extracted file text",
      metadata: {
        path: "E:\\workspace\\note.md",
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
        content_extracted: true,
        chars_extracted: 20,
        truncated: false
      }
    }
  };

  const [first] = buildFileContentIndexRecords(input);
  const [second] = buildFileContentIndexRecords(input);
  assert.equal(first.id, second.id);
});

test("file content index records chunk long extracted text with positional metadata", () => {
  const sections = Array.from({ length: 12 }, (_, index) =>
    `Section ${index + 1}\n${"general context ".repeat(30)}\n${index === 8 ? "needle project risk mitigation " : ""}${"details ".repeat(40)}`
  );
  const records = buildFileContentIndexRecords({
    task: { task_id: "task_long", conversation_id: "conv_long", project_id: "project_long" },
    toolId: "read_file_text",
    result: {
      success: true,
      observation: sections.join("\n\n"),
      metadata: {
        path: "E:\\workspace\\long.md",
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
        content_extracted: true,
        chars_extracted: sections.join("\n\n").length,
        truncated: false
      }
    },
    createdAt: "2026-05-04T00:00:00.000Z"
  });

  assert.ok(records.length > 1);
  assert.ok(records.some((record) => record.text.includes("needle project risk mitigation")));
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  assert.deepEqual(records.map((record) => record.metadata.chunk_index), records.map((_, index) => index));
  assert.ok(records.every((record) => record.metadata.chunk_count === records.length));
  assert.ok(records.every((record) => record.metadata.project_id === "project_long"));
  assert.ok(records.every((record) => Number.isInteger(record.metadata.char_start)));
  assert.ok(records.every((record) => Number.isInteger(record.metadata.char_end)));
});
