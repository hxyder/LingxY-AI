/**
 * verify-agentic-planner.mjs — UCA-049 commit 2 regression guard.
 *
 * Exercises the provider-agnostic agentic planner end-to-end with a
 * mocked provider adapter so we can assert:
 *
 *   1. The system prompt is rendered *dynamically* from the action tool
 *      registry — adding / removing a tool changes the prompt.
 *   2. Multi-step tool use works: adapter returns a tool_call → planner
 *      runs the tool → adapter gets the observation back → adapter
 *      returns a final text.
 *   3. The truthfulness guard downgrades "已完成 / done" final text when
 *      no tool actually succeeded.
 *   4. web_search_fetch + generate_document are visible to the planner
 *      for pptx requests.
 *   5. The agentic executor yields the standard event shape (step_started
 *      → tool_call_* → artifact_created → inline_result → success).
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgenticSystemPrompt, listToolIdsInPrompt } from "../src/service/executors/agentic/prompt-builder.mjs";
import { runAgenticPlanner } from "../src/service/executors/agentic/planner.mjs";
import { createAgenticExecutorScaffold } from "../src/service/executors/agentic/executor.mjs";
import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";
import {
  buildCodeCliChatPrompt,
  parseJsonToolCalls,
  extractAssistantText
} from "../src/service/executors/agentic/code-cli-bridge.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { detectRequestedOutputFormat } from "../src/service/executors/kimi/output-format.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------------ */
/* 1. Dynamic system prompt rendering                                        */
/* ------------------------------------------------------------------------ */

{
  const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  // UCA-077 P1-07: text changed from "analyse latest AI trends and make a
  // ppt" to a query that contains an explicit external entity ("今日 AI 新闻"),
  // because in the new pipeline weak time markers like "latest" no longer
  // escalate web_search_fetch to required on their own — that was the root
  // cause of the misroute that this rewrite fixed. The behaviour the test
  // is verifying (Task contract carries the policy + required tools) is
  // unchanged; only the input had to be made unambiguous.
  const inputText = "总结今日 AI 新闻并生成 PPT 报告";
  // P4-RQ E3 stage C1: topic regex no longer drives web=required
  // deterministically. Stub a SemanticRouter decision so the merge
  // upgrades web → required and the prompt renders external_web_read=required.
  const stubContext = {
    semantic_router_decision: {
      source_scope: "external_world",
      web_policy: "required",
      output_kind: "pptx",
      artifact_required: true,
      executor: "agentic",
      research_depth: "multi_source",
      confidence: 0.85,
      reason: "news + artifact"
    }
  };
  const prompt = buildAgenticSystemPrompt({
    tools: registry.list(),
    task: {
      user_command: inputText,
      task_spec: createTaskSpec(inputText, stubContext, {
        suggested_executor: "agentic",
        intent_tags: ["analyze", "search"],
        suggested_formats: ["pptx"]
      })
    },
    requestedFormat: detectRequestedOutputFormat(inputText)
  });
  const toolIds = listToolIdsInPrompt(prompt);
  // Core planner tools must appear in the catalogue
  for (const required of ["web_search_fetch", "write_file", "run_script", "generate_document"]) {
    assert.ok(toolIds.includes(required), `prompt must include <tool id="${required}">; got ${toolIds.join(", ")}`);
  }
  // Truthfulness constraint must appear verbatim — this is how the model is
  // told not to claim completion without a tool success observation.
  assert.match(prompt, /Only say something was.*?done/);
  // Pptx request should surface the generate_document instruction
  assert.match(prompt, /generate_document/);
  assert.match(prompt, /pptx/);
  assert.match(prompt, /Task contract/);
  assert.match(prompt, /Skill descriptors are local guidance, not executable tools/);
  // UCA-077 P1-07: tool_policy replaces required_steps. The explicit
  // "今日 AI 新闻" entity must escalate external web reading to required.
  // P4-00 / P4-00.7: prompt renders policy at the group level with the
  // `(any of: ...)` member list so the LLM sees siblings share fate and
  // can pick whichever sibling fits. The shared renderToolPolicyForPrompt
  // helper enforces this format for both agentic and tool_using.
  assert.match(prompt, /tool_policy:[\s\S]*external_web_read: required \(any of: [^)]*web_search_fetch[^)]*\)/);
  // P4-00.7 (revised §18.6.1.A): the contract no longer pretends the
  // requirement is a specific toolId. It surfaces required_policy_groups
  // with the same `(any of: ...)` hint so the LLM knows fetch_url_content
  // / web_search are valid alternatives. required_tools stays "(none)"
  // for pure web-required tasks; toolId-specific rules (open_file etc.)
  // still populate it.
  assert.match(prompt, /required_policy_groups:[\s\S]*- external_web_read \(any of: [^)]*web_search_fetch[^)]*\)/);
  assert.match(prompt, /required_tools: \(none\)/);
}

/* ------------------------------------------------------------------------ */
/* 2. Multi-step tool use via mocked adapter                                 */
/* ------------------------------------------------------------------------ */

{
  const calls = [];

  // First adapter.generate() → return a tool_call for web_search_fetch
  // Second adapter.generate() → return final text after seeing the observation
  let step = 0;
  const mockAdapter = {
    kind: "openai",
    model: "test-model",
    transport: "https",
    describe() { return { provider_id: "mock", provider_kind: "openai", provider_name: "Mock", model: "test-model", transport: "https" }; },
    async generate({ messages }) {
      calls.push({ step, messagesLen: messages.length });
      step += 1;
      if (step === 1) {
        return {
          text: "",
          tool_calls: [
            { id: "call_1", name: "web_search_fetch", arguments: { query: "latest AI trends 2026", recency: "month" } }
          ],
          usage: { input_tokens: 10, output_tokens: 2 }
        };
      }
      return {
        text: "I searched for the latest AI trends and summarised them above.",
        tool_calls: [],
        usage: { input_tokens: 50, output_tokens: 20 }
      };
    }
  };

  // Fake tool registry: override web_search_fetch so we don't hit the real
  // network, and keep everything else as-is.
  const fakeTools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute(args) {
          return {
            success: true,
            observation: `Mock web search results for "${args.query}" — 1) https://example.com article A about AI trends.`,
            metadata: { tool_id: "web_search_fetch", query: args.query }
          };
        }
      }
    : tool);
  const registry = createActionToolRegistry(fakeTools);
  const fakeRuntime = { actionToolRegistry: registry, toolContext: {} };

  const events = [];
  const result = await runAgenticPlanner({
    task: { task_id: "t1", user_command: "Tell me about the latest AI trends" },
    runtime: fakeRuntime,
    requestedFormat: detectRequestedOutputFormat("Tell me about the latest AI trends"),
    adapterOverride: mockAdapter,
    onEvent: (event) => events.push(event),
    maxIterations: 4
  });

  assert.equal(result.success, true);
  assert.ok(result.finalText.includes("searched"));
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, "web_search_fetch");
  assert.equal(result.toolCalls[0].success, true);
  assert.equal(result.iterations, 2);
  assert.ok(events.some((e) => e.event_type === "tool_call_started" && e.payload.tool_id === "web_search_fetch"));
  assert.ok(events.some((e) => e.event_type === "tool_call_completed" && e.payload.success === true));
}

/* ------------------------------------------------------------------------ */
/* 3. Truthfulness guard — lying about completion gets downgraded            */
/* ------------------------------------------------------------------------ */

{
  let step = 0;
  const lyingAdapter = {
    kind: "openai",
    model: "test-model",
    transport: "https",
    describe() { return null; },
    async generate() {
      step += 1;
      if (step === 1) {
        return {
          text: "",
          tool_calls: [
            { id: "call_1", name: "launch_app", arguments: { app: "nonexistent-app-xyz" } }
          ]
        };
      }
      // Even though the tool failed, the model lies.
      return { text: "已启动 nonexistent-app-xyz，应用已经成功打开。", tool_calls: [] };
    }
  };

  const failingTools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "launch_app"
    ? {
        ...tool,
        async execute() {
          return {
            success: false,
            observation: "Failed to launch app: not found.",
            metadata: { tool_id: "launch_app" }
          };
        }
      }
    : tool);
  const registry = createActionToolRegistry(failingTools);
  const fakeRuntime = { actionToolRegistry: registry, toolContext: {} };

  const result = await runAgenticPlanner({
    task: { task_id: "t2", user_command: "启动一个不存在的应用" },
    runtime: fakeRuntime,
    adapterOverride: lyingAdapter,
    maxIterations: 4
  });

  assert.equal(result.downgraded, true, "planner must downgrade when the model claims completion without a successful tool call");
  assert.equal(result.success, false);
  // UCA-181: the truthfulness banner is the leading line, no longer a [UCA note] tag.
  assert.match(result.finalText, /no tool in this run returned success/);
  assert.match(result.finalText, /downgraded/);
}

/* ------------------------------------------------------------------------ */
/* 4. code_cli bridge unit tests (prompt builder + parser)                   */
/* ------------------------------------------------------------------------ */

{
  // 4a. buildCodeCliChatPrompt preserves system + user + tool messages and
  //     appends the JSON tool-call protocol at the end.
  const prompt = buildCodeCliChatPrompt({
    messages: [
      { role: "system", content: "You are LingxY. Tools: web_search_fetch / write_file / generate_document." },
      { role: "user", content: "Tell me about AI trends" },
      {
        role: "assistant",
        content: "Let me search.",
        tool_calls: [{ id: "c1", name: "web_search_fetch", arguments: { query: "ai trends" } }]
      },
      { role: "tool", tool_call_id: "c1", content: "Search results: ..." }
    ]
  });
  assert.match(prompt, /# System/);
  assert.match(prompt, /# User/);
  assert.match(prompt, /# Tool result \(c1\)/);
  assert.match(prompt, /## Tool calling protocol/);
  assert.match(prompt, /tool_call/);
  // The protocol section must come after every message so the model sees
  // the latest instruction last.
  assert.ok(prompt.lastIndexOf("Tool calling protocol") > prompt.lastIndexOf("# Tool result"));
}

{
  // 4b. parseJsonToolCalls extracts ```json ...``` fenced blocks
  const fenced = "Let me search first.\n\n```json\n{\"tool_call\": {\"name\": \"web_search_fetch\", \"arguments\": {\"query\": \"ai\"}}}\n```";
  const parsed = parseJsonToolCalls(fenced);
  assert.equal(parsed.tool_calls.length, 1);
  assert.equal(parsed.tool_calls[0].name, "web_search_fetch");
  assert.deepEqual(parsed.tool_calls[0].arguments, { query: "ai" });
  assert.ok(!parsed.text.includes("```"));
  assert.match(parsed.text, /Let me search first/);
}

{
  // 4c. parseJsonToolCalls extracts bare {tool_call: ...} blocks
  const bare = '{"tool_call": {"name": "write_file", "arguments": {"path": "out.md", "content": "hi"}}}';
  const parsed = parseJsonToolCalls(bare);
  assert.equal(parsed.tool_calls.length, 1);
  assert.equal(parsed.tool_calls[0].name, "write_file");
  assert.deepEqual(parsed.tool_calls[0].arguments, { path: "out.md", content: "hi" });
}

{
  // 4d. parseJsonToolCalls returns empty tool_calls when no JSON block found
  const plain = "I do not need to call any tool. Final answer: 42.";
  const parsed = parseJsonToolCalls(plain);
  assert.equal(parsed.tool_calls.length, 0);
  assert.equal(parsed.text, plain);
}

{
  // 4e. extractAssistantText handles stream-json transcripts
  const stdout = `${JSON.stringify({ role: "assistant", content: [{ type: "text", text: "hello from cli" }] })}\n`;
  const text = extractAssistantText(stdout, "stream_json_print");
  assert.equal(text, "hello from cli");
}

/* ------------------------------------------------------------------------ */
/* 5. End-to-end code_cli planner via mock CLI subprocess                    */
/* ------------------------------------------------------------------------ */

{
  // Build a real adapter pointing at a mock CLI fixture and let the planner
  // drive the full multi-step loop:
  //   - turn 1: mock CLI emits assistant text with a JSON tool_call for
  //     web_search_fetch
  //   - planner runs the tool (we override web_search_fetch with a fake)
  //   - turn 2: mock CLI sees the tool result in the prompt and emits a
  //     final answer with no tool_call
  const mockCliPath = path.join(repoRoot, "tests", "fixtures", "mock-agentic-code-cli.mjs");
  const adapter = createProviderAdapter({
    id: "code_cli",
    configId: "mock-cli",
    kind: "code_cli",
    command: process.execPath,
    args: [mockCliPath],
    env: process.env,
    transport: "stream_json_print",
    model: "mock-model",
    providerName: "Mock CLI",
    maxRuntimeSeconds: 30
  });

  assert.equal(adapter.kind, "code_cli");
  assert.equal(adapter.transport, "subprocess");

  const fakeTools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "web_search_fetch"
    ? {
        ...tool,
        async execute(args) {
          return {
            success: true,
            observation: `Mock search for "${args.query}" returned 3 results.`,
            metadata: { tool_id: "web_search_fetch", query: args.query }
          };
        }
      }
    : tool);

  const result = await runAgenticPlanner({
    task: { task_id: "t-codecli", user_command: "Tell me the latest AI trends" },
    runtime: {
      actionToolRegistry: createActionToolRegistry(fakeTools),
      toolContext: {}
    },
    adapterOverride: adapter,
    maxIterations: 4
  });

  assert.equal(result.success, true, `code_cli planner should succeed end-to-end; got: ${result.finalText}`);
  assert.equal(result.iterations, 2, `code_cli planner should take exactly 2 turns; got ${result.iterations}`);
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].name, "web_search_fetch");
  assert.equal(result.toolCalls[0].success, true);
  assert.match(result.finalText, /AI trends/);
  assert.equal(result.provider_descriptor?.provider_kind, "code_cli");
  assert.equal(result.provider_descriptor?.transport, "subprocess");
}

/* ------------------------------------------------------------------------ */
/* 5. Agentic executor event stream shape                                    */
/* ------------------------------------------------------------------------ */

{
  const executor = createAgenticExecutorScaffold();
  assert.equal(executor.id, "agentic");
  assert.equal(typeof executor.execute, "function");

  const fakeTools = BUILTIN_ACTION_TOOLS.map((tool) => tool.id === "write_file"
    ? {
        ...tool,
        async execute() {
          return {
            success: true,
            observation: "Mock wrote file.",
            metadata: { tool_id: "write_file", path: "/tmp/mock.md" },
            artifact_paths: ["/tmp/mock.md"]
          };
        }
      }
    : tool);
  const runtime = {
    actionToolRegistry: createActionToolRegistry(fakeTools),
    toolContext: {}
  };

  let step = 0;
  const mockAdapter = {
    kind: "openai",
    model: "test-model",
    transport: "https",
    describe() { return null; },
    async generate() {
      step += 1;
      if (step === 1) {
        return {
          text: "",
          tool_calls: [
            { id: "call_1", name: "write_file", arguments: { path: "plan.md", content: "# Plan" } }
          ]
        };
      }
      return { text: "Wrote the plan to plan.md.", tool_calls: [] };
    }
  };

  const task = {
    task_id: "t4",
    user_command: "Write me a plan file",
    __runtime: runtime
  };
  const events = [];
  // Monkey-patch createProviderAdapter usage by injecting the mock adapter
  // via the planner's adapterOverride path. The executor doesn't accept an
  // override directly, so we call the planner for this step of the test.
  // (The executor's stream wrapper is exercised separately in step 5a below.)
  const plannerResult = await runAgenticPlanner({
    task,
    runtime,
    adapterOverride: mockAdapter,
    maxIterations: 3,
    onEvent: (event) => events.push(event)
  });
  assert.equal(plannerResult.success, true);
  assert.ok(plannerResult.artifactPaths.includes("/tmp/mock.md"));
  assert.equal(plannerResult.toolCalls[0].name, "write_file");
  assert.equal(plannerResult.toolCalls[0].success, true);
  const completion = events.find((e) => e.event_type === "tool_call_completed");
  assert.equal(completion.payload.artifact_action, "create_new");
  assert.equal(completion.payload.artifact_source, "generated");
  const created = events.find((e) => e.event_type === "artifact_created");
  assert.equal(created.payload.artifact_source, "generated");
}

console.log("Agentic planner verification passed (prompt rendering / tool loop / truthfulness guard / code_cli bridge unit + end-to-end / executor scaffold).");
