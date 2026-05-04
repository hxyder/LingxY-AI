import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";
import { validateSuccessContract } from "../../src/service/core/policy/success-contract-validator.mjs";
import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";

function taskSpec({ depth = "standard" } = {}) {
  return {
    file_read: { depth },
    success_contract: {
      required_policy_groups: ["local_file_text_read"]
    }
  };
}

function toolResult({ tool, success = true, metadata = {}, observation = "ok" }) {
  return {
    type: "tool_result",
    tool,
    success,
    observation,
    metadata
  };
}

test("local_file_text_read is not satisfied by indexed search hits", () => {
  const out = validateSuccessContract(taskSpec(), [
    toolResult({
      tool: "search_file_content",
      metadata: {
        indexed_file_search: true,
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
      },
      observation: "Found matching indexed file content."
    })
  ]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "local_file_text_read_required_not_called");
});

test("local_file_text_read is satisfied by fresh read_file_text evidence", () => {
  const out = validateSuccessContract(taskSpec(), [
    toolResult({
      tool: "search_file_content",
      metadata: { indexed_file_search: true },
      observation: "Candidate file: E:/linxi/resume.docx"
    }),
    toolResult({
      tool: "read_file_text",
      metadata: {
        path: "E:/linxi/resume.docx",
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
      },
      observation: "Extracted 12,000 characters."
    })
  ]);

  assert.equal(out.satisfied, true);
  assert.deepEqual(out.violations, []);
});

test("local_file_text_read requires content_extracted metadata", () => {
  const out = validateSuccessContract(taskSpec(), [
    toolResult({
      tool: "read_file_text",
      metadata: {
        path: "E:/linxi/resume.docx",
        content_extracted: false,
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
      },
      observation: "Read file metadata only."
    })
  ]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "local_file_text_read_required_no_fresh_text");
});

test("deep local_file_text_read is not satisfied by a single-file read", () => {
  const out = validateSuccessContract(taskSpec({ depth: "deep" }), [
    toolResult({
      tool: "read_file_text",
      metadata: {
        path: "E:/linxi/docs/a.md",
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
      },
      observation: "Extracted one file."
    })
  ]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "local_file_text_read_required_deep_insufficient");
});

test("deep local_file_text_read is satisfied by recursive folder text coverage", () => {
  const out = validateSuccessContract(taskSpec({ depth: "deep" }), [
    toolResult({
      tool: "read_folder_text",
      metadata: {
        path: "E:/linxi/docs",
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT
      },
      observation: "Extracted 15 files recursively."
    })
  ]);

  assert.equal(out.satisfied, true);
  assert.deepEqual(out.violations, []);
});

test("TaskSpec preserves SemanticRouter local_file_text_read contract", () => {
  const spec = createTaskSpec("总结这个文件", {
    file_paths: ["E:/linxi/report.md"],
    semantic_router_decision: {
      required_policy_groups: ["local_file_text_read"],
      expected_output: "summary",
      user_goal: "总结这个文件"
    }
  });

  assert.ok(spec.success_contract.required_policy_groups.includes("local_file_text_read"));
  assert.equal(spec.success_contract.tool_called, true);
});

test("real read_file_text registry result satisfies the fresh-read contract", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-local-contract-file-"));
  try {
    const filePath = path.join(dir, "brief.md");
    await writeFile(filePath, "# Brief\n\nFresh local file evidence.", "utf8");
    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_file_text", { path: filePath, max_chars: 500 });
    const out = validateSuccessContract(taskSpec(), [
      {
        type: "tool_result",
        tool: "read_file_text",
        success: result.success,
        observation: result.observation,
        metadata: result.metadata,
        result
      }
    ]);

    assert.equal(result.metadata.content_extracted, true);
    assert.equal(result.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT);
    assert.equal(out.satisfied, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("real folder extraction satisfies the deep fresh-read contract", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-local-contract-folder-"));
  try {
    await mkdir(path.join(dir, "nested"), { recursive: true });
    await writeFile(path.join(dir, "overview.md"), "Overview text.", "utf8");
    await writeFile(path.join(dir, "nested", "details.txt"), "Nested evidence.", "utf8");
    const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
    const result = await registry.call("read_folder_text", {
      path: dir,
      pattern: "*.{md,txt}",
      max_depth: 3,
      max_files: 10,
      max_total_chars: 5000
    });
    const out = validateSuccessContract(taskSpec({ depth: "deep" }), [
      {
        type: "tool_result",
        tool: "read_folder_text",
        success: result.success,
        observation: result.observation,
        metadata: result.metadata,
        result
      }
    ]);

    assert.equal(result.metadata.content_extracted, true);
    assert.equal(result.metadata.coverage_scope, FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT);
    assert.equal(out.satisfied, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("attaching a file without an explicit file-use contract does not force fresh read", () => {
  const spec = createTaskSpec("你好", {
    file_paths: ["E:/linxi/resume.docx"]
  });

  assert.ok(!spec.success_contract.required_policy_groups.includes("local_file_text_read"));
});
