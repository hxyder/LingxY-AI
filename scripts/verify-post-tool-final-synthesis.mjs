#!/usr/bin/env node
/**
 * P6-PT framework lock: post-tool final answer synthesis.
 *
 * Asserts the framework rule (NOT a phrase or tool patch):
 *   - IntentRoute exposes synthesis kinds in expected_output enum
 *   - TaskSpec carries the synthesis intent forward
 *   - The synthesis-prompt helper renders the right block per intent
 *   - The synthesis completeness check fires on raw dumps and stays
 *     silent when the user wants raw_results
 *   - Executors use the helper + check at the source level
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_OUTPUTS,
  SYNTHESIS_REQUIRED_OUTPUTS
} from "../src/service/core/intent/semantic-router.mjs";
import { buildSynthesisGuidance } from "../src/service/executors/shared/synthesis-prompt.mjs";
import { validateAnswerSynthesis } from "../src/service/core/policy/success-contract-validator.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { runToolAgentLoop } from "../src/service/executors/tool_using/agent-loop.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function it(label, fn) {
  try { fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}
async function ait(label, fn) {
  try { await fn(); process.stdout.write(`PASS  ${label}\n`); pass += 1; }
  catch (err) { process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`); fail += 1; }
}

function makeConnectorRuntime({ emails }) {
  const tool = {
    id: "account_list_emails",
    description: "List emails",
    parameters: { type: "object", properties: {}, required: [] }
  };
  return {
    actionToolRegistry: {
      list: () => [tool],
      get: (id) => (id === tool.id ? tool : null),
      evaluate: () => ({ level: "low", requires_confirmation: false }),
      call: async () => ({
        success: true,
        observation: `account_list_emails returned ${emails.length} emails from google account.`,
        metadata: {
          provider: "google",
          account: { provider: "google", accountId: "user@example.com" },
          emails
        }
      })
    },
    toolContext: {},
    emitTaskEvent() {},
    store: { appendAuditLog() {} }
  };
}

function makeActionRuntime() {
  const tool = {
    id: "launch_app",
    description: "Launch app",
    parameters: { type: "object", properties: { app: { type: "string" } }, required: ["app"] }
  };
  return {
    actionToolRegistry: {
      list: () => [tool],
      get: (id) => (id === tool.id ? tool : null),
      evaluate: () => ({ risk_level: "medium", requires_confirmation: false }),
      call: async (_id, args) => ({
        success: true,
        observation: `已启动 ${args.app}`
      })
    },
    toolContext: {},
    emitTaskEvent() {},
    store: { appendAuditLog() {} }
  };
}

it("EXPECTED_OUTPUTS extends with synthesis kinds (no parallel enum)", () => {
  for (const kind of ["summary", "comparison", "recommendation", "analysis", "action_items", "raw_results"]) {
    assert.ok(EXPECTED_OUTPUTS.includes(kind), `EXPECTED_OUTPUTS must include ${kind}`);
  }
  for (const kept of ["direct_answer", "code", "table", "artifact"]) {
    assert.ok(EXPECTED_OUTPUTS.includes(kept), `legacy value ${kept} must remain`);
  }
});

it("SYNTHESIS_REQUIRED_OUTPUTS does NOT include raw_results, direct_answer, code, table, artifact", () => {
  for (const v of ["raw_results", "direct_answer", "code", "table", "artifact"]) {
    assert.equal(SYNTHESIS_REQUIRED_OUTPUTS.has(v), false, `${v} must NOT be in synthesis-required set`);
  }
  for (const v of ["summary", "comparison", "recommendation", "analysis", "action_items"]) {
    assert.equal(SYNTHESIS_REQUIRED_OUTPUTS.has(v), true, `${v} must be in synthesis-required set`);
  }
});

it("TaskSpec.synthesis carries user_goal + expected_output from SR decision", () => {
  const spec = createTaskSpec("帮我总结今天的邮件", {
    semantic_router_decision: {
      source_scope: "external_world", web_policy: "forbidden", output_kind: "conversation",
      artifact_required: false, executor: "tool_using", research_depth: "unknown",
      primary_intent: "email_calendar_action", domain: "general",
      user_goal: "summarize today's email", expected_output: "summary",
      needs_external_info: false, needs_current_information: false, needs_user_files: false,
      needs_tool_use: true, needed_capabilities: ["email_calendar_action"],
      source_mode: "no_external", complexity: "medium", risk_level: "low",
      confidence: 0.9, rationale_summary: "test", reason: "test"
    }
  });
  assert.ok(spec.synthesis);
  assert.equal(spec.synthesis.expected_output, "summary");
  assert.equal(spec.synthesis.user_goal, "summarize today's email");
});

it("TaskSpec.synthesis falls back to user_goal_text when SR did not run", () => {
  const spec = createTaskSpec("just a request", {});
  assert.ok(spec.synthesis);
  assert.equal(spec.synthesis.expected_output, null);
  assert.equal(spec.synthesis.user_goal, "just a request");
});

it("buildSynthesisGuidance: synthesis kinds get the strong 'transform, do not dump' rule", () => {
  for (const kind of SYNTHESIS_REQUIRED_OUTPUTS) {
    const block = buildSynthesisGuidance({ synthesis: { user_goal: "g", expected_output: kind } });
    assert.match(block, /Synthesis guidance/);
    assert.match(block, /Tool observations are intermediate data/);
    assert.match(block, /Do not list raw records/);
  }
});

it("buildSynthesisGuidance: raw_results gets the explicit raw-allowed line", () => {
  const block = buildSynthesisGuidance({ synthesis: { user_goal: "show me", expected_output: "raw_results" } });
  assert.match(block, /raw \/ unmodified/);
  assert.ok(!/Do not list raw records/.test(block));
});

it("buildSynthesisGuidance: direct_answer answers first and stays anchored", () => {
  const block = buildSynthesisGuidance({
    synthesis: {
      user_goal: "answer which prior phase is riskiest",
      expected_output: "direct_answer"
    }
  });
  assert.match(block, /Answer the user's immediate question first/);
  assert.match(block, /stay anchored to the prior plan/);
});

it("buildSynthesisGuidance: empty when synthesis is missing", () => {
  assert.equal(buildSynthesisGuidance({}), "");
  assert.equal(buildSynthesisGuidance(null), "");
  assert.equal(buildSynthesisGuidance({ synthesis: null }), "");
});

it("validateAnswerSynthesis: no-op when expected_output is not a synthesis kind", () => {
  const transcript = [{ type: "tool_result", tool: "x", success: true, observation: "a".repeat(500) }];
  for (const kind of ["direct_answer", "code", "table", "artifact", "raw_results"]) {
    const violations = validateAnswerSynthesis(
      { synthesis: { expected_output: kind } },
      transcript,
      "a".repeat(500)
    );
    assert.equal(violations.length, 0, `${kind} must NOT trigger the synthesis check`);
  }
});

it("validateAnswerSynthesis: fires when answer is a near-verbatim echo of an observation under a synthesis intent", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "account_list_emails", success: true, observation: observation.repeat(4) }],
    observation.repeat(4)
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "answer_not_synthesized");
});

it("validateAnswerSynthesis: fires when answer dumps tool metadata rather than observation text", () => {
  const emails = [
    { received: "Mon, 27 Apr 2026 21:36:42 +0000", fromName: "Groupon", from: "noreply@r.groupon.com", subject: "Jiffy Lube: 15-Minute Drive-Thru Oil Change" },
    { received: "Mon, 27 Apr 2026 17:34:19 +0000", fromName: "SoFi", from: "SoFi@m.sofi.org", subject: "The Fed meets tomorrow. Here's what that could mean." },
    { received: "27 Apr 2026 16:32:43 -0000", fromName: "Indeed", from: "no-reply@jm.indeed.com", subject: "Action requested: Profile is still incomplete" }
  ];
  const finalText = [
    "我从 google 查到 3 封邮件：",
    "1. Mon, 27 Apr 2026 21:36:42 +0000 | Groupon <noreply@r.groupon.com> | Jiffy Lube: 15-Minute Drive-Thru Oil Change",
    "2. Mon, 27 Apr 2026 17:34:19 +0000 | SoFi <SoFi@m.sofi.org> | The Fed meets tomorrow. Here's what that could mean.",
    "3. 27 Apr 2026 16:32:43 -0000 | Indeed <no-reply@jm.indeed.com> | Action requested: Profile is still incomplete"
  ].join("\n");
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{
      type: "tool_result",
      tool: "account_list_emails",
      success: true,
      observation: "account_list_emails returned 3 emails from google account.",
      metadata: { emails }
    }],
    finalText
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, "answer_not_synthesized");
  assert.equal(violations[0].isLikelyRawDump, true);
});

it("validateAnswerSynthesis: passes when the answer is genuinely a transformed summary", () => {
  const observation = "Email 1: subject A from a@x.com\nEmail 2: subject B from b@y.com\nEmail 3: subject C from c@z.com";
  const summary = "今天收到三封邮件，主要围绕项目进度和会议安排。建议优先回复来自 a@x.com 的请求。";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "account_list_emails", success: true, observation }],
    summary
  );
  assert.equal(violations.length, 0);
});

it("validateAnswerSynthesis: short synthesis sharing topic words is not a raw dump", () => {
  const transcript = [{
    type: "tool_result",
    tool: "web_search_fetch",
    success: true,
    observation: "Mock web search results for latest AI trends 2026 -- 1) https://example.com article A about AI trends and adoption patterns."
  }];
  const finalText = "I searched and found that the main trend is practical AI adoption.";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: null } },
    transcript,
    finalText
  );
  assert.equal(violations.length, 0);
});

it("validateAnswerSynthesis: short observations (<80 chars) are not used to detect dumps", () => {
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "summary" } },
    [{ type: "tool_result", tool: "x", success: true, observation: "tiny" }],
    "tiny"
  );
  assert.equal(violations.length, 0);
});

it("validateAnswerSynthesis: failed tool results are ignored", () => {
  const obs = "raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows raw rows";
  const violations = validateAnswerSynthesis(
    { synthesis: { expected_output: "analysis" } },
    [{ type: "tool_result", tool: "x", success: false, error: "boom", observation: obs.repeat(3) }],
    obs.repeat(3)
  );
  assert.equal(violations.length, 0);
});

await ait("agent-loop: imports buildSynthesisGuidance and validateAnswerSynthesis", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /from\s+"\.\.\/shared\/synthesis-prompt\.mjs"/);
  assert.match(src, /validateAnswerSynthesis[\s\S]{0,80}from\s+"\.\.\/\.\.\/core\/policy\/success-contract-validator\.mjs"/);
});

await ait("agent-loop: synthesisBlock is spliced into the system prompt", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /synthesisBlock/);
  assert.match(src, /\$\{synthesisBlock\}/);
});

await ait("agent-loop: dedupe path NO LONGER dumps `transcript.filter…map\\(observation\\)\\.join`", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.ok(!/transcript\.filter\(\(e\) => e\.type === "tool_result"\)\.map\(\(e\) => e\.observation\)\.join/.test(src),
    "the legacy raw-dump fallback must be removed");
});

await ait("agent-loop: dedupe path emits a synthesis_retry transcript entry", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /type:\s*"synthesis_retry"/);
  assert.match(src, /repeated_tool_call/);
});

await ait("agent-loop: final-text path runs validateAnswerSynthesis before returning", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  const phaseGateSrc = await readFile(path.join(repoRoot, "src/service/executors/tool_using/phase-gate.mjs"), "utf8");
  // Phase 1.12 — validator scope split:
  //   - validateSuccessContract → selectSuccessContractValidationSpec(task)
  //     (hard, no retro tightening; the helper permits only forward-safe
  //     loosening such as research-quality downgrade handling)
  //   - validateStepGate / validateAnswerSynthesis → task.task_spec
  //     (LATEST so SR's `expected_output` enrichment shapes synthesis)
  assert.match(src, /validateAnswerSynthesis\(\s*synthesisValidationSpec\s*,/);
  assert.match(src, /synthesisValidationSpec\s*=\s*task\.task_spec\s*\?\?\s*task\.task_spec_initial/);
  assert.match(phaseGateSrc, /stepGateSpec\s*=\s*selectSuccessContractValidationSpec\(task\)/);
  assert.match(src, /validationSpec\s*=\s*selectSuccessContractValidationSpec\(task\)/);
  assert.match(src, /validateSuccessContract\(\s*validationSpec/);
  assert.match(src, /MAX_SYNTHESIS_RETRIES/);
});

await ait("agent-loop: final path does not prefer connector raw-list fallback", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.match(src, /let candidateFinal = decision\?\.text\s*\n\s*\?\? finalFallbackText/);
  assert.match(src, /needsFinalComposer\(task,\s*transcript\)/);
  assert.ok(!/const candidateFinal = connectorFinal \?\? decision\?\.text/.test(src),
    "connector raw fallback must not override an LLM-synthesised final answer");
});

await ait("agent-loop: connector raw final is gated to raw_results", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/finalization.mjs"), "utf8");
  assert.match(src, /function allowsRawConnectorFinal/);
  assert.match(src, /expected_output === "raw_results"/);
  assert.match(src, /if \(rawAllowed\) return formatConnectorFinal/);
});

await ait("agent-loop: synthesis_retry events use the runtime event signature", async () => {
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  assert.ok(!/emitTaskEvent\?\.\(task\.task_id,\s*"synthesis_retry"/.test(src),
    "runtime.emitTaskEvent(eventType, payload) must not be called with task_id as the first argument");
  assert.ok(!/emitTaskEvent\?\.\(task\.task_id,\s*"prose_trap_retry"/.test(src),
    "prose_trap_retry must use runtime.emitTaskEvent(eventType, payload)");
});

await ait("agent-loop behavior: connector metadata list does NOT override synthesised LLM final", async () => {
  const emails = [
    { received: "Mon, 27 Apr 2026 21:36:42 +0000", fromName: "Groupon", from: "noreply@r.groupon.com", subject: "Jiffy Lube: 15-Minute Drive-Thru Oil Change" },
    { received: "27 Apr 2026 16:32:43 -0000", fromName: "Indeed", from: "no-reply@jm.indeed.com", subject: "Action requested: Profile is still incomplete" }
  ];
  const runtime = makeConnectorRuntime({ emails });
  runtime.finalAnswerComposer = async () =>
    "今天邮件主要是促销和账户提醒；优先处理 Indeed 的资料补全提醒，其余促销可稍后查看。";
  const planner = async ({ transcript }) => (
    transcript.some((entry) => entry.type === "tool_result")
      ? { type: "final", text: "今天邮件主要是促销和账户提醒；优先处理 Indeed 的资料补全提醒，其余促销可稍后查看。" }
      : { type: "tool_call", tool: "account_list_emails", args: {} }
  );
  const result = await runToolAgentLoop({
    runtime,
    planner,
    maxIterations: 3,
    task: {
      task_id: "task_test",
      user_command: "总结一下我的邮件",
      task_spec: {
        synthesis: { expected_output: "summary", user_goal: "总结邮件" },
        tool_policy: { web_search_fetch: { mode: "forbidden" } }
      }
    }
  });
  assert.equal(result.final_text, "今天邮件主要是促销和账户提醒；优先处理 Indeed 的资料补全提醒，其余促销可稍后查看。");
});

await ait("agent-loop behavior: connector raw list is still allowed for raw_results", async () => {
  const runtime = makeConnectorRuntime({
    emails: [{ received: "Mon", fromName: "Groupon", from: "noreply@r.groupon.com", subject: "Deal" }]
  });
  const planner = async ({ transcript }) => (
    transcript.some((entry) => entry.type === "tool_result")
      ? { type: "final" }
      : { type: "tool_call", tool: "account_list_emails", args: {} }
  );
  const result = await runToolAgentLoop({
    runtime,
    planner,
    maxIterations: 3,
    task: {
      task_id: "task_test",
      user_command: "列出原始邮件",
      task_spec: {
        synthesis: { expected_output: "raw_results", user_goal: "列出原始邮件" },
        tool_policy: { web_search_fetch: { mode: "forbidden" } }
      }
    }
  });
  assert.match(result.final_text, /我从 google 查到 1 封邮件/);
  assert.match(result.final_text, /Groupon/);
});

await ait("agent-loop behavior: repeated successful launch action falls back to action completion text", async () => {
  const runtime = makeActionRuntime();
  const planner = async () => ({ type: "tool_call", tool: "launch_app", args: { app: "Excel" } });
  const result = await runToolAgentLoop({
    runtime,
    planner,
    maxIterations: 4,
    task: {
      task_id: "task_launch",
      user_command: "打开excel",
      task_spec: {
        goal: "launch_and_act",
        synthesis: { expected_output: null, user_goal: "打开excel" },
        tool_policy: { web_search_fetch: { mode: "optional" } }
      }
    }
  });
  assert.equal(result.status, "partial_success");
  assert.match(result.final_text, /Excel/);
  const forbidden = ["Could", "not", "synthesize"].join(" ");
  assert.ok(!result.final_text.includes(forbidden),
    "desktop action fallback must not expose a generic synthesis failure");
});

await ait("agent-loop: multi-action handling is single-brain (no plannedOpenActions / hasCompoundIntent regex layer)", async () => {
  // Phase 1.8 — the regex layer that pre-planned multi-app launches is
  // gone. The LLM is the single brain for deciding "which tools next".
  // Concretely:
  //   - `nextPlannedOpenAction` / `allPlannedOpenActionsCompleted` /
  //     `plannedOpenActions` helpers no longer exist
  //   - `hasCompoundIntent` is no longer imported
  //   - the system prompt explicitly tells the LLM to chain tool calls
  //     across iterations until every requested action is done
  const src = await readFile(path.join(repoRoot, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");
  // Strip line + block comments so the assertions don't trip over the
  // deletion notes we left behind to explain the rip-out.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line))
    .join("\n");
  assert.ok(!/\bnextPlannedOpenAction\b/.test(code),
    "nextPlannedOpenAction must be deleted (regex multi-action layer)");
  assert.ok(!/\ballPlannedOpenActionsCompleted\b/.test(code),
    "allPlannedOpenActionsCompleted must be deleted (regex multi-action layer)");
  assert.ok(!/\bplannedOpenActions\b/.test(code),
    "plannedOpenActions must be deleted (regex multi-action layer)");
  assert.ok(!/\bhasCompoundIntent\b/.test(code),
    "hasCompoundIntent import + use must be removed from agent-loop");
  assert.match(src, /Compound requests = chain tool calls/i,
    "system prompt must instruct multi-action chaining via the LLM");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
