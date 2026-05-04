#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FILE_READ_BUDGETS,
  FILE_READ_DEPTHS,
  inferFileReadBudget,
  resolveFileReadBudgetFromTask
} from "../src/service/core/file-read-budget.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

function read(relPath) {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

assert.deepEqual(Object.keys(FILE_READ_BUDGETS).sort(), ["deep", "focused", "standard"]);
assert.equal(FILE_READ_BUDGETS.deep.max_depth, 6);
assert.equal(FILE_READ_BUDGETS.deep.max_files, 60);
assert.equal(FILE_READ_BUDGETS.deep.max_total_chars, 90000);
assert.ok(FILE_READ_BUDGETS.deep.max_depth <= 8);
assert.ok(FILE_READ_BUDGETS.deep.max_files <= 80);
assert.ok(FILE_READ_BUDGETS.deep.max_total_chars <= 100000);

assert.equal(inferFileReadBudget({
  contextSources: { uploaded_files: true },
  contextPacket: { file_paths: ["E:\\local\\folder"] },
  researchQuality: null,
  srDecision: null
}).depth, FILE_READ_DEPTHS.STANDARD);

assert.equal(inferFileReadBudget({
  contextSources: { uploaded_files: true },
  contextPacket: { file_paths: ["E:\\local\\folder"] },
  researchQuality: null,
  srDecision: { source_mode: "deep_research", research_depth: "deep_research" }
}).depth, FILE_READ_DEPTHS.DEEP);

assert.equal(inferFileReadBudget({
  contextSources: { uploaded_files: true },
  contextPacket: { file_paths: ["E:\\local\\folder"] },
  researchQuality: null,
  srDecision: { source_mode: "provided_context", research_depth: "unknown", file_read_depth: "deep" }
}).depth, FILE_READ_DEPTHS.DEEP);
assert.equal(inferFileReadBudget({
  contextSources: { uploaded_files: true },
  contextPacket: { file_paths: ["E:\\local\\folder"] },
  researchQuality: null,
  srDecision: { source_mode: "deep_research", research_depth: "deep_research", file_read_depth: "focused" }
}).depth, FILE_READ_DEPTHS.FOCUSED);

assert.equal(resolveFileReadBudgetFromTask({
  task_spec: {
    file_read: { depth: FILE_READ_DEPTHS.DEEP, max_depth: 5 }
  }
}).max_depth, 5);
assert.equal(resolveFileReadBudgetFromTask({
  task_spec: {
    file_read: { depth: FILE_READ_DEPTHS.DEEP, max_depth: undefined }
  }
}).max_depth, FILE_READ_BUDGETS.deep.max_depth);

const spec = createTaskSpec("Analyze local materials", {
  file_paths: ["E:\\local\\folder"],
  semantic_router_decision: {
    source_scope: "uploaded_files",
    source_mode: "deep_research",
    web_policy: "forbidden",
    output_kind: "conversation",
    artifact_required: false,
    executor: "tool_using",
    research_depth: "deep_research",
    confidence: 0.9,
    reason: "local evidence"
  }
});
assert.equal(spec.file_read?.depth, FILE_READ_DEPTHS.DEEP);
assert.ok(spec.decision_trace.some((entry) => entry.stage === "file-read-budget"));

const tools = read("src/service/action_tools/tools/index.mjs");
assert.match(tools, /resolveFileReadBudgetFromTask/);
assert.match(tools, /READ_FILE_TEXT_TOOL[\s\S]{0,1800}READ_FOLDER_TEXT_TOOL\.execute\([\s\S]{0,900}, ctx\)/,
  "read_file_text directory delegation must forward ctx so task budgets apply");
assert.match(tools, /args\.max_depth \?\? fileReadBudget\.max_depth/,
  "folder depth must prefer explicit tool args, then task budget");

const contract = read("src/service/core/file-read-budget.mjs");
for (const banned of ["简历", "岗位", "YouTube", "Raleigh"]) {
  assert.equal(contract.includes(banned), false,
    `file-read budget must not encode task topic ${banned}`);
}

console.log("file read budget verification passed");
