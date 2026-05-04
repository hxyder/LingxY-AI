#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildFileContentIndexRecords } from "../src/service/core/file-content-index-records.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../src/service/core/file-evidence-coverage.mjs";
import { EMBEDDING_NAMESPACES } from "../src/service/embeddings/store.mjs";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

const [record] = buildFileContentIndexRecords({
  task: { task_id: "task_verify", conversation_id: "conv_verify" },
  toolId: "read_file_text",
  result: {
    success: true,
    observation: "Extracted content for index verification.",
    metadata: {
      path: "E:\\workspace\\verify.md",
      coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
      content_extracted: true,
      chars_extracted: 40,
      truncated: false
    }
  }
});

assert.equal(record.namespace, EMBEDDING_NAMESPACES.FILE_CONTENT);
assert.equal(record.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT);
assert.equal(record.metadata.path, "E:\\workspace\\verify.md");
assert.equal(record.metadata.task_id, "task_verify");
assert.equal(record.metadata.conversation_id, "conv_verify");

assert.deepEqual(buildFileContentIndexRecords({
  toolId: "glob_files",
  result: {
    success: true,
    observation: "verify.md",
    metadata: {
      coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE,
      content_extracted: false
    }
  }
}), []);

const source = read("src/service/core/file-content-index-records.mjs");
assert.match(source, /EMBEDDING_NAMESPACES\.FILE_CONTENT/);
assert.match(source, /isFileTextCoverageScope/);
for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(source.includes(banned), false,
    `file content index records must not encode task topic ${banned}`);
}

console.log("file content index records verification passed");
