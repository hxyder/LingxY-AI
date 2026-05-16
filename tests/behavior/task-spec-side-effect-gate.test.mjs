import assert from "node:assert/strict";
import test from "node:test";

import { createTaskSpec } from "../../src/service/core/task-spec.mjs";
import { validateSuccessContract } from "../../src/service/core/policy/success-contract-validator.mjs";

// Regression: task_c7f592f0 (2026-05-03). SR LLM (deepseek-v4-flash) emitted
// `required_policy_groups: ["email_send"]` for a "美股今天行情" research query
// → phase-gate `email_send_required_not_called` → action-only handoff blocked
// every web tool → partial_success. Fix: side-effect groups (email_send /
// calendar_create / file_upload) must be regex-confirmed before they enter
// the success contract.

function specWithSrDecision(text, srDecisionOverrides = {}) {
  const contextPacket = {
    semantic_router_decision: {
      web_policy: "required",
      source_scope: "external_world",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "multi_source",
      file_read_depth: "shallow",
      primary_intent: "research",
      domain: "finance",
      user_goal: "市场行情查询",
      expected_output: "summary",
      needs_external_info: true,
      needs_current_information: true,
      needs_user_files: false,
      needs_tool_use: true,
      needed_capabilities: ["external_web_read"],
      required_policy_groups: ["external_web_read", "email_send"],
      source_mode: "multi_source_research",
      complexity: "medium",
      risk_level: "low",
      confidence: 0.85,
      rationale_summary: "stub",
      reason: "stub",
      ...srDecisionOverrides
    }
  };
  return createTaskSpec(text, contextPacket);
}

test("SR-claimed email_send is dropped when user text has no email entity", () => {
  const spec = specWithSrDecision("美股今天行情");
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("email_send"),
    `email_send should be dropped without an email entity, got groups=${JSON.stringify(groups)}`);
  // external_web_read is unrelated and must stay
  assert.ok(groups.includes("external_web_read"),
    `external_web_read should remain, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed email_send IS kept when user text has an email recipient", () => {
  const spec = specWithSrDecision("把美股今天总结发送到 trader@example.com");
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(groups.includes("email_send"),
    `email_send should survive when an email entity exists, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed calendar_create is dropped without attendee/time evidence", () => {
  const spec = specWithSrDecision("帮我看下市场动态", {
    required_policy_groups: ["external_web_read", "calendar_create"],
    domain: "calendar"
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("calendar_create"),
    `calendar_create should be dropped without an attendee/scheduling entity, got groups=${JSON.stringify(groups)}`);
});

test("SR-claimed file_upload is dropped without a file path entity", () => {
  const spec = specWithSrDecision("查询当前热点", {
    required_policy_groups: ["external_web_read", "file_upload"]
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(!groups.includes("file_upload"),
    `file_upload should be dropped without a file-path entity, got groups=${JSON.stringify(groups)}`);
});

test("schedule_create remains SR-only (no regex entity layer for it)", () => {
  const spec = specWithSrDecision("提醒我明天上午 9 点喝水", {
    required_policy_groups: ["schedule_create"],
    primary_intent: "schedule",
    domain: "schedule"
  });
  const groups = spec.success_contract.required_policy_groups;
  assert.ok(groups.includes("schedule_create"),
    `schedule_create should pass through SR judgement, got groups=${JSON.stringify(groups)}`);
});

test("explicit generated script files are artifact-required and cannot finish as prose", () => {
  const spec = createTaskSpec("生成一个 Node.js 脚本文件，文件名 followup_exec_test.mjs，必须保存为真实文件并执行。", {}, {});
  assert.equal(spec.artifact.required, true);
  assert.equal(spec.artifact.kind, "mjs");
  assert.equal(spec.success_contract.artifact_created, true);
  assert.ok(spec.success_contract.required_tool_names.includes("run_script"));
  assert.equal(spec.success_contract.generated_script_execution_required, true);
  assert.ok(spec.required_steps.includes("generate_artifact"));
  assert.ok(spec.required_steps.includes("verify_file_exists"));
});

test("mjs artifacts satisfy JavaScript aliases introduced by Node.js wording", () => {
  const spec = createTaskSpec("生成一个 Node.js 脚本文件，文件名 followup_exec_test.mjs，必须保存为真实文件并执行。", {}, {});
  const missingExecution = validateSuccessContract(spec, [
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/followup_exec_test.mjs"] }
  ]);
  assert.equal(missingExecution.satisfied, false);
  assert.ok(missingExecution.violations.some((violation) => violation.kind === "run_script_required_not_called"));

  const inlineExecution = validateSuccessContract(spec, [
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/followup_exec_test.mjs"] },
    {
      type: "tool_result",
      tool: "run_script",
      success: true,
      args: { language: "node", script: "console.log('ok')" },
      observation: "run_script (node) finished with exit 0"
    }
  ]);
  assert.equal(inlineExecution.satisfied, false);
  assert.ok(inlineExecution.violations.some((violation) => violation.kind === "generated_script_file_not_executed"));

  const result = validateSuccessContract(spec, [
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/followup_exec_test.mjs"] },
    {
      type: "tool_result",
      tool: "run_script",
      success: true,
      args: { language: "node", script: "await import('file:///E:/out/followup_exec_test.mjs');" },
      observation: "run_script (node) finished with exit 0"
    }
  ]);
  assert.equal(result.satisfied, true, JSON.stringify(result.violations));
});

test("explicit ad-hoc markdown/json/csv files are artifact-required without hijacking ordinary JSON questions", () => {
  const markdownSpec = createTaskSpec("生成一个 Markdown 文件，文件名 notes.md，必须保存为真实文件。", {}, {});
  assert.equal(markdownSpec.artifact.required, true);
  assert.equal(markdownSpec.artifact.kind, "md");
  assert.equal(markdownSpec.success_contract.artifact_created, true);

  const jsonSpec = createTaskSpec("创建一个 JSON 文件，文件名 data.json，内容包含 name 字段。", {}, {});
  assert.equal(jsonSpec.artifact.required, true);
  assert.equal(jsonSpec.artifact.kind, "json");

  const csvSpec = createTaskSpec("导出一个 csv 文件，文件名 rows.csv，包含两行数据。", {}, {});
  assert.equal(csvSpec.artifact.required, true);
  assert.equal(csvSpec.artifact.kind, "csv");

  const multiSpec = createTaskSpec("生成三个真实文件：notes.md、data.json、rows.csv。", {}, {});
  assert.deepEqual(multiSpec.artifact.required_kinds, ["json", "csv", "md"]);

  const ordinaryQuestion = createTaskSpec("JSON 是什么？请直接解释。", {}, {});
  assert.equal(ordinaryQuestion.artifact.required, false);
  assert.equal(ordinaryQuestion.artifact.kind, null);
});

test("multi-format generated file requests require every requested artifact kind", () => {
  const spec = createTaskSpec("生成三个真实文件：notes.md、data.json、rows.csv。", {}, {});
  const missing = validateSuccessContract(spec, [
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/notes.md"] }
  ]);
  assert.equal(missing.satisfied, false);
  assert.ok(missing.violations.some((violation) =>
    violation.kind === "artifact_required_kind_mismatch" && violation.message.includes("json")
  ));
  assert.ok(missing.violations.some((violation) =>
    violation.kind === "artifact_required_kind_mismatch" && violation.message.includes("csv")
  ));

  const satisfied = validateSuccessContract(spec, [
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/notes.md"] },
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/data.json"] },
    { type: "tool_result", tool: "write_file", success: true, artifact_paths: ["E:/out/rows.csv"] }
  ]);
  assert.equal(satisfied.satisfied, true, JSON.stringify(satisfied.violations));
});

test("format references to existing artifacts do not create a new artifact obligation", () => {
  const spec = createTaskSpec("继续：用 Node.js 执行一段脚本读取上一个生成的 HTML 文件，确认文件内容包含标记，并只回答 OK。", {}, {});
  assert.equal(spec.artifact.required, false);
  assert.equal(spec.artifact.kind, null);
  assert.equal(spec.success_contract.artifact_created, false);
  assert.ok(spec.success_contract.required_tool_names.includes("run_script"));
  assert.equal(spec.success_contract.generated_script_execution_required, false);

  const missingExecution = validateSuccessContract(spec, [
    { type: "tool_result", tool: "read_file_text", success: true, observation: "contains marker" }
  ]);
  assert.equal(missingExecution.satisfied, false);
  assert.ok(missingExecution.violations.some((violation) => violation.kind === "run_script_required_not_called"));

  const executed = validateSuccessContract(spec, [
    {
      type: "tool_result",
      tool: "run_script",
      success: true,
      args: { language: "node", script: "console.log('OK')" },
      observation: "run_script (node) finished with exit 0\n--- stdout ---\nOK"
    }
  ]);
  assert.equal(executed.satisfied, true, JSON.stringify(executed.violations));
});
