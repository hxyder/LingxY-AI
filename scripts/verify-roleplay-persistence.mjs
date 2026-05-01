#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { routeIntent } from "../src/service/core/router/intent-router.mjs";

const agentLoop = readFileSync(new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url), "utf8");
const taskRoutes = readFileSync(new URL("../src/service/core/http-routes/task-routes.mjs", import.meta.url), "utf8");
const policyResolver = readFileSync(new URL("../src/service/core/policy/tool-policy-resolver.mjs", import.meta.url), "utf8");

const roleplayDecision = {
  source_scope: "none",
  web_policy: "forbidden",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  research_depth: "unknown",
  primary_intent: "qa",
  domain: "career",
  user_goal: "continue a data analyst interview roleplay",
  expected_output: "direct_answer",
  needs_external_info: false,
  needs_current_information: false,
  needs_user_files: false,
  needs_tool_use: false,
  needed_capabilities: ["none"],
  source_mode: "no_external",
  complexity: "low",
  risk_level: "low",
  confidence: 0.9,
  rationale_summary: "The user is continuing an interview roleplay.",
  reason: "No tools or external evidence are needed.",
  interpretation: "immediate",
  schedule_at: null,
  residual_command: null,
  clarification_question: null
};

const spec = createTaskSpec(
  "给我一个方案和问题的发现",
  {
    prior_messages: [
      { role: "user", content: "角色扮演一下，面试官面试我。岗位是数据分析师。" },
      { role: "assistant", content: "请介绍一个你做过的数据分析项目。" },
      { role: "user", content: "我做过资源管理 dashboard。" }
    ],
    semantic_router_decision: roleplayDecision
  },
  { executor: "tool_using", suggested_executor: "tool_using" }
);

assert.equal(spec.goal, "qa");
assert.equal(spec.contract.mode, "qa");
assert.equal(spec.suggested_executor, "tool_using");
assert.equal(spec.tool_policy.web_search_fetch.mode, "forbidden");
assert.equal(spec.synthesis.primary_intent, "qa");

const openerRoute = routeIntent("角色扮演一下，面试官面试我。岗位是数据分析师。");
assert.ok(!openerRoute.intent_tags.includes("analyze"),
  "legacy intent-router must not tag 数据分析师 as an analyze action");
assert.notEqual(openerRoute.suggested_executor, "agentic",
  "legacy intent-router must not push roleplay opener toward agentic");

const introRoute = routeIntent("我研究生毕业于华盛顿大学，主要负责数据分析，dashboard制作。");
assert.ok(!introRoute.intent_tags.includes("analyze"),
  "legacy intent-router must not tag 研究生/数据分析 as an analyze action");

const actionRoute = routeIntent("帮我分析这个 dashboard 的问题");
assert.ok(actionRoute.intent_tags.includes("analyze"),
  "legacy intent-router should still tag explicit analysis requests");

assert.ok(/function shouldUseLeanChatMode/.test(agentLoop),
  "agent-loop must define a lean chat mode gate");
assert.ok(/buildLeanChatSystemPrompt/.test(agentLoop),
  "agent-loop must have a lean QA/roleplay prompt");
assert.ok(/conversation history establishes a roleplay\/persona/.test(agentLoop),
  "lean prompt must preserve conversation-level roleplay/persona instructions");
assert.ok(/planner_mode:\s*leanChatMode\s*\?\s*"lean_chat"\s*:\s*"tool_planner"/.test(agentLoop),
  "planner_request_started must expose lean_chat vs tool_planner mode");
assert.ok(/const toolSchemas = leanChatMode \? \[\] : \[plannerToolDescriptorForAdapter\(\)\]/.test(agentLoop),
  "lean chat mode must not send the call_tool schema");
assert.ok(/const plannerTools = leanChatMode \? \[\] : filterToolsForTask/.test(agentLoop),
  "lean chat mode must not render the full tool inventory");

assert.ok(!/detectAmbiguity|clarify-before-act|Clarify-before-act/.test(taskRoutes),
  "HTTP submission must not run old pre-task regex clarification");
assert.ok(!/roleplayOrInterview|角色扮演\|面试官|isPureConversationalTurn/.test(policyResolver),
  "SR gate must not use roleplay/interview regex as a scene classifier");

console.log("Roleplay persistence verifier passed.");
