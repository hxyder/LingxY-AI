import assert from "node:assert/strict";
import test from "node:test";

import { FILE_EVIDENCE_COVERAGE } from "../../src/service/core/file-evidence-coverage.mjs";
import { finalizeAgenticPlannerRun } from "../../src/service/executors/agentic/finalization.mjs";

function requiredWebTask() {
  return {
    task_id: "task_agentic_finalization",
    task_spec: {
      success_contract: {
        required_policy_groups: ["external_web_read"],
        required_tool_names: []
      }
    }
  };
}

test("agentic finalization returns success when tool evidence satisfies the contract", () => {
  const result = finalizeAgenticPlannerRun({
    task: requiredWebTask(),
    finalText: "Here is a sourced summary.",
    transcript: [
      {
        role: "tool",
        name: "web_search_fetch",
        success: true,
        observation: "Found a detailed source with enough substance to use in the answer.",
        metadata: { results: [{ title: "A", url: "https://example.test/a" }] }
      }
    ],
    artifactPaths: ["E:/linxiDoc/a.md"],
    descriptor: { provider: "test" },
    iterations: 2
  });

  assert.equal(result.success, true);
  assert.equal(result.downgraded, false);
  assert.equal(result.violations, null);
  assert.equal(result.toolCalls.length, 1);
  assert.deepEqual(result.artifactPaths, ["E:/linxiDoc/a.md"]);
  assert.equal(result.provider_descriptor.provider, "test");
  assert.equal(result.iterations, 3);
  assert.equal(result.evidence_summary.source_count, 1);
});

test("agentic finalization records unresolved citations as advisory violations", () => {
  const result = finalizeAgenticPlannerRun({
    task: requiredWebTask(),
    finalText: "Here is a sourced summary [w_deadbeef].",
    transcript: [
      {
        role: "tool",
        name: "web_search_fetch",
        success: true,
        observation: "Found a detailed source with enough extracted text and concrete facts for the synthesis validator.",
        metadata: { results: [{ title: "A", url: "https://example.test/a" }] }
      }
    ],
    iterations: 1
  });

  assert.equal(result.success, true, "citation advisories should not downgrade successful tasks");
  assert.equal(result.downgraded, false);
  assert.deepEqual(result.evidence_summary.citations.missing, ["w_deadbeef"]);
  assert.ok(result.violations.some((violation) => violation.kind === "citation_unresolved"));
});

test("agentic finalization downgrades completion claims that have no successful tool", () => {
  const result = finalizeAgenticPlannerRun({
    task: { task_id: "task_claim" },
    finalText: "Done, I opened the app.",
    transcript: [],
    iterations: 0
  });

  assert.equal(result.success, false);
  assert.equal(result.downgraded, true);
  assert.match(result.finalText, /claimed the task was completed/);
  assert.ok(result.violations.some((violation) => violation.kind === "app_launch_claim_unsupported"));
});

test("agentic finalization downgrades unsatisfied success contracts", () => {
  const result = finalizeAgenticPlannerRun({
    task: requiredWebTask(),
    finalText: "Answering from memory.",
    transcript: [],
    iterations: 1
  });

  assert.equal(result.success, false);
  assert.equal(result.downgraded, true);
  assert.ok(result.violations.some((violation) => violation.kind === "external_web_read_required_not_called"));
  assert.match(result.finalText, /SuccessContract/);
});

test("agentic finalization preserves the initial artifact contract after an incomplete SR patch", () => {
  const result = finalizeAgenticPlannerRun({
    task: {
      task_id: "task_agentic_initial_artifact_contract",
      task_spec: {
        goal: "qa",
        synthesis: { expected_output: "direct_answer" }
      },
      task_spec_initial: {
        goal: "generate_document",
        artifact: { required: true, kind: "docx" },
        synthesis: { expected_output: "artifact" },
        success_contract: {
          artifact_created: true,
          required_policy_groups: [],
          required_tool_names: []
        }
      }
    },
    finalText: "Here is the report content as plain text.",
    transcript: [],
    iterations: 1
  });

  assert.equal(result.success, false);
  assert.equal(result.downgraded, true);
  assert.ok(result.violations.some((violation) => violation.kind === "artifact_required_not_created"));
  assert.match(result.finalText, /SuccessContract/);
});

test("agentic finalization does not accept indexed file hits as fresh local file reads", () => {
  const result = finalizeAgenticPlannerRun({
    task: {
      task_id: "task_local_file_read",
      task_spec: {
        success_contract: {
          required_policy_groups: ["local_file_text_read"]
        }
      }
    },
    finalText: "I analyzed the document from the indexed match.",
    transcript: [
      {
        role: "tool",
        name: "search_file_content",
        success: true,
        observation: "Found matching indexed file content.",
        metadata: {
          indexed_file_search: true,
          content_extracted: true,
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
        }
      }
    ],
    iterations: 1
  });

  assert.equal(result.success, false);
  assert.equal(result.downgraded, true);
  assert.ok(result.violations.some((violation) => violation.kind === "local_file_text_read_required_not_called"));
  assert.match(result.finalText, /SuccessContract/);
});

test("agentic finalization accepts fresh read_file_text evidence for local_file_text_read", () => {
  const result = finalizeAgenticPlannerRun({
    task: {
      task_id: "task_local_file_read_success",
      task_spec: {
        success_contract: {
          required_policy_groups: ["local_file_text_read"]
        }
      }
    },
    finalText: "Here is a summary from the file text.",
    transcript: [
      {
        role: "tool",
        name: "read_file_text",
        success: true,
        observation: "Extracted readable file text.",
        metadata: {
          content_extracted: true,
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT
        }
      }
    ],
    iterations: 1
  });

  assert.equal(result.success, true);
  assert.equal(result.downgraded, false);
  assert.equal(result.violations, null);
});

test("agentic finalization surfaces error-budget early exits", () => {
  const result = finalizeAgenticPlannerRun({
    task: { task_id: "task_budget" },
    finalText: "Partial result.",
    transcript: [],
    earlyExitState: {
      kind: "error_budget_exhausted",
      error_budget: {
        event: "tool_failure",
        iteration: 2,
        reason: "tool_failure budget exhausted"
      }
    },
    iterations: 2
  });

  assert.equal(result.success, false);
  assert.equal(result.downgraded, true);
  assert.equal(result.error_budget.event, "tool_failure");
  assert.equal(result.phase_gate, null);
  assert.match(result.finalText, /error_budget exhausted/);
});
