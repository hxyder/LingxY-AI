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
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        recursive: true,
        files_read: 2,
        max_depth: 6,
        truncated: false,
        coverage_complete: true
      },
      observation: "Extracted 15 files recursively."
    })
  ]);

  assert.equal(out.satisfied, true);
  assert.deepEqual(out.violations, []);
});

test("deep local_file_text_read rejects shallow recursive folder metadata", () => {
  const out = validateSuccessContract({
    file_read: { depth: "deep", max_depth: 6 },
    success_contract: {
      required_policy_groups: ["local_file_text_read"]
    }
  }, [
    toolResult({
      tool: "read_folder_text",
      metadata: {
        path: "E:/linxi/docs",
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        recursive: true,
        files_read: 1,
        max_depth: 0,
        truncated: false
      },
      observation: "Extracted one top-level file."
    })
  ]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "local_file_text_read_required_deep_insufficient");
});

test("deep local_file_text_read rejects truncated folder extraction", () => {
  const out = validateSuccessContract(taskSpec({ depth: "deep" }), [
    toolResult({
      tool: "read_folder_text",
      metadata: {
        path: "E:/linxi/docs",
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        recursive: true,
        files_read: 4,
        max_depth: 6,
        truncated: true,
        coverage_complete: false
      },
      observation: "Extracted text but stopped at budget."
    })
  ]);

  assert.equal(out.satisfied, false);
  assert.equal(out.violations[0]?.kind, "local_file_text_read_required_deep_insufficient");
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

test("TaskSpec does not force fresh file reads for inline clipboard text", () => {
  const spec = createTaskSpec("请总结这段内容", {
    source_type: "clipboard",
    source_app: "verify-runtime",
    text: "This is direct inline text that is already available to the executor.",
    semantic_router_decision: {
      source_scope: "selection",
      source_mode: "provided_context",
      expected_output: "summary",
      user_goal: "请总结这段内容",
      needed_capabilities: ["file_read"],
      required_policy_groups: ["local_file_text_read"],
      confidence: 0.86,
      reason: "The text is local input, but it is not an attached file."
    }
  });

  assert.ok(!spec.success_contract.required_policy_groups.includes("local_file_text_read"));
  assert.equal(spec.success_contract.tool_called, false);
  assert.ok(spec.decision_trace.some((entry) =>
    entry.stage === "success-contract"
    && entry.rejected?.some((item) => item.candidate === "local_file_text_read")
  ));
});

test("TaskSpec requires fresh local read when the user references an attached document", () => {
  const spec = createTaskSpec("总结这份文档", {
    file_paths: ["E:/linxi/report.md"]
  });

  assert.ok(spec.success_contract.required_policy_groups.includes("local_file_text_read"));
  assert.equal(spec.success_contract.tool_called, true);
  assert.equal(spec.suggested_executor, "tool_using");
});

test("TaskSpec combines fresh local read and external web read for hybrid evidence routes", () => {
  const spec = createTaskSpec("结合这份材料搜索外部机会", {
    file_paths: ["E:/linxi/resume.pdf"],
    semantic_router_decision: {
      source_scope: "uploaded_files",
      source_mode: "multi_source_research",
      web_policy: "required",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "multi_source",
      needs_user_files: true,
      needs_external_info: true,
      needs_tool_use: true,
      needed_capabilities: ["file_read", "external_web_read"],
      required_policy_groups: ["external_web_read"],
      confidence: 0.88,
      reason: "The answer must combine the attached local material with current external evidence."
    }
  });

  assert.ok(spec.success_contract.required_policy_groups.includes("local_file_text_read"));
  assert.ok(spec.success_contract.required_policy_groups.includes("external_web_read"));
  assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "required");
  assert.equal(spec.success_contract.tool_called, true);
});

test("external_web_read research coverage ignores local files when counting web sources", () => {
  const out = validateSuccessContract({
    success_contract: { required_policy_groups: ["external_web_read"] },
    research_quality: {
      profile: "multi_source_research",
      min_sources: 3,
      min_distinct_domains: 2,
      single_source_digest_satisfies: false
    }
  }, [
    toolResult({
      tool: "read_folder_text",
      metadata: {
        files: [
          { path: "E:/linxi/resume.md", success: true },
          { path: "E:/linxi/portfolio.md", success: true }
        ],
        content_extracted: true,
        coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        recursive: true,
        files_read: 2,
        coverage_complete: true
      },
      observation: "Read two local files."
    }),
    toolResult({
      tool: "web_search_fetch",
      metadata: {
        results: [
          { url: "https://example.com/current-source", title: "External source" }
        ]
      },
      observation: "Found one external source."
    })
  ]);

  assert.equal(out.satisfied, false);
  const kinds = out.violations.map((violation) => violation.kind);
  assert.ok(kinds.includes("external_web_read_insufficient_sources"));
  assert.ok(kinds.includes("external_web_read_single_domain_only"));
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

test("artifact contract requires the requested file kind", () => {
  const wrongKind = validateSuccessContract({
    artifact: { required: true, kind: "docx" },
    success_contract: { artifact_created: true }
  }, [
    toolResult({
      tool: "generate_document",
      metadata: { path: "E:/linxiDoc/task/result.html" },
      observation: "Created HTML artifact."
    })
  ]);

  assert.equal(wrongKind.satisfied, false);
  assert.ok(wrongKind.violations.some((violation) =>
    violation.kind === "artifact_required_kind_mismatch"
  ));

  const rightKind = validateSuccessContract({
    artifact: { required: true, kind: "docx" },
    success_contract: { artifact_created: true }
  }, [
    toolResult({
      tool: "generate_document",
      metadata: { path: "E:/linxiDoc/task/result.docx" },
      observation: "Created DOCX artifact."
    })
  ]);

  assert.equal(rightKind.satisfied, true);
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
