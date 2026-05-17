#!/usr/bin/env node
/**
 * verify-email-send-routing.mjs — UCA-179
 *
 * Regression: a user who said "把这两个附件发给 sophie@gmail.com"
 * ended up on the "fast" executor (no tools), so the LLM could only
 * draft a reply — it never called account_send_email, and the
 * attachments never left the machine.
 *
 * Fix: broaden CONNECTOR_CONTEXT_PATTERN so send / share / upload /
 * 发送 / 发给 / 转发 verbs keep the command in the connector domain,
 * which routes through the tool_using executor where the connector
 * write tools live.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isConnectorDomainRequest } from "../src/service/capabilities/connectors/core/connector-intent.mjs";
import { classifyGoal, createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 1) Previously classified as qa → now classified as connector domain. ─
const CASES = [
  "把这两个附件发给 user-b@example.com",
  "发给 alice@gmail.com",
  "给hanxy308@163.com 发个邮件，问好。",
  "send these two PDFs to sophie@gmail.com",
  "forward this to bob@outlook.com",
  "帮我把这个文件上传到 onedrive",
  "share the report with carol@gmail.com"
];
for (const input of CASES) {
  assert.equal(
    isConnectorDomainRequest(input),
    true,
    `isConnectorDomainRequest must match connector-write intent: ${JSON.stringify(input)}`
  );
  assert.equal(
    classifyGoal(input),
    "search_and_answer",
    `classifyGoal must keep ${JSON.stringify(input)} in the connector domain`
  );
  const spec = createTaskSpec(input);
  assert.ok(
    spec.suggested_executor === "tool_using" || spec.suggested_executor === "agentic",
    `${JSON.stringify(input)} must land on a tools-capable executor (got ${spec.suggested_executor})`
  );
}

const EMAIL_SEND_CASES = [
  "把这两个附件发给 user-b@example.com",
  "给hanxy308@163.com 发个邮件，问好。",
  "send these two PDFs to sophie@gmail.com",
  "forward this to bob@outlook.com"
];
for (const input of EMAIL_SEND_CASES) {
  const spec = createTaskSpec(input, {
    semantic_router_decision: {
      source_scope: "current_context",
      web_policy: "forbidden",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      primary_intent: "email_calendar_action",
      domain: "email",
      expected_output: "execution",
      needs_tool_use: true,
      needed_capabilities: ["email_calendar_action"],
      required_policy_groups: [],
      confidence: 0.86,
      reason: "email send fixture"
    }
  }, {});
  assert.ok(
    spec.success_contract.required_policy_groups.includes("email_send"),
    `${JSON.stringify(input)} must infer success_contract.required_policy_groups[email_send]`
  );
}

// 2) Pure launches still short-circuit and keep their own goal. ─────────
assert.equal(classifyGoal("打开word"), "launch_and_act",
  "pure launch must still be launch_and_act");

// 3) Ordinary QA is still QA. Topical/current-info routing now comes from
// SemanticRouter, not the retired webDataNeeded topic regex.
assert.equal(classifyGoal("今天纽约天气怎么样"), "qa",
  "without SR, topical/current-info words must not reintroduce topic-regex goal routing");
assert.equal(
  createTaskSpec("今天纽约天气怎么样", {
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "required",
      output_kind: "conversation",
      artifact_required: false,
      executor: "tool_using",
      research_depth: "single_lookup",
      confidence: 0.86,
      reason: "weather requires current external info"
    }
  }, {}).goal,
  "search_and_answer",
  "with SR judgement, current-info queries promote through semantic_router evidence"
);
assert.equal(classifyGoal("What is 2 + 2?"), "qa",
  "trivial qa stays on fast");

// 4) The desktop overlay should not force dragged / selected files back onto
// the legacy code_cli path; only images keep the explicit multi_modal pin.
const overlay = readFileSync(path.join(root, "src/desktop/renderer/overlay.js"), "utf8");
assert.ok(
  !overlay.includes('executorOverride: "code_cli"'),
  "desktop overlay should not hard-pin general file requests to code_cli"
);
assert.match(
  overlay,
  /const executorOverride = capture\.sourceType === "image" \? "multi_modal" : undefined;/,
  "desktop overlay should only force multi_modal for image captures"
);

console.log("ok verify-email-send-routing");
