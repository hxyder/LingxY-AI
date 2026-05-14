#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";
import {
  buildLlmUsagePayload,
  emitLlmUsage,
  estimatePromptSegments,
  normalizeLlmUsage
} from "../src/service/core/task-runtime/llm-usage.mjs";

let pass = 0;
function ok(label) {
  pass += 1;
  process.stdout.write(`PASS  ${label}\n`);
}

function sseStream(events) {
  const encoder = new TextEncoder();
  const body = events.map((event) =>
    typeof event === "string" ? event : `data: ${JSON.stringify(event)}\n\n`
  ).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    }
  });
}

{
  const estimate = estimatePromptSegments([
    { name: "system", content: "12345678" },
    { name: "empty", content: "" },
    { name: "history", content: [{ role: "user", content: "abcdefghijkl" }] },
    { name: "", content: "ignored" }
  ]);
  assert.equal(estimate.estimator, "default_chars_div_4");
  assert.equal(estimate.segments.length, 2);
  assert.equal(estimate.segments[0].name, "system");
  assert.equal(estimate.segments[0].estimated_tokens, 2);
  assert.equal(estimate.segments[1].name, "history");
  assert.equal(estimate.segments[1].estimated_tokens, 3);
  assert.equal(estimate.total_estimated_tokens, 5);
  ok("estimatePromptSegments builds compact non-empty segment estimates");
}

{
  const usage = normalizeLlmUsage({
    input_tokens: 100,
    output_tokens: 20,
    cache_creation_input_tokens: 7,
    cache_read_input_tokens: 80,
    prompt_cache_hit_tokens: 60,
    prompt_cache_miss_tokens: 40
  });
  assert.equal(usage.input_tokens, 100);
  assert.equal(usage.output_tokens, 20);
  assert.equal(usage.total_tokens, 120);
  assert.equal(usage.cache_creation_input_tokens, 7);
  assert.equal(usage.cache_read_input_tokens, 80);
  assert.equal(usage.cache_hit_tokens, 60);
  assert.equal(usage.cache_miss_tokens, 40);
  ok("normalizeLlmUsage preserves provider cache buckets");
}

{
  const events = [];
  const audits = [];
  const tasks = new Map([["task_usage", { task_id: "task_usage" }]]);
  const runtime = {
    emitTaskEvent(eventType, payload) { events.push({ eventType, payload }); },
    store: {
      getTask(taskId) { return tasks.get(taskId) ?? null; },
      updateTask(taskId, task) {
        tasks.set(taskId, task);
        return task;
      },
      appendAuditLog(entry) { audits.push(entry); }
    }
  };
  const payload = emitLlmUsage({
    runtime,
    task: { task_id: "task_usage" },
    callSite: "fixture.call",
    iteration: 2,
    provider: {
      provider_id: "deepseek",
      provider_kind: "openai",
      provider_name: "DeepSeek",
      model: "deepseek-v4-flash",
      transport: "https"
    },
    stream: true,
    usage: { input_tokens: 10, output_tokens: 5 },
    promptSegments: [
      { name: "system", content: "system prompt" },
      { name: "tool_schemas", content: [{ name: "call_tool", input_schema: { type: "object" } }] }
    ]
  });
  assert.equal(payload.usage.total_tokens, 15);
  assert.equal(payload.prompt_segments_estimate.segments.length, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "llm_usage");
  assert.equal(events[0].payload.call_site, "fixture.call");
  assert.equal(audits[0].event_subtype, "ai.llm_usage");
  assert.equal(tasks.get("task_usage").usage_summary.input_tokens, 10);
  assert.equal(tasks.get("task_usage").usage_summary.output_tokens, 5);
  assert.equal(tasks.get("task_usage").usage_summary.total_tokens, 15);
  ok("emitLlmUsage emits durable-compatible payload and audit log");
}

{
  const queued = [];
  const direct = [];
  const runtime = {
    emitTaskEvent(eventType, payload) { direct.push({ eventType, payload }); }
  };
  emitLlmUsage({
    runtime,
    onEvent(event) { queued.push(event); },
    callSite: "agentic.planner",
    usage: { input_tokens: 3, output_tokens: 4 }
  });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].event_type, "llm_usage");
  assert.equal(direct.length, 0);
  ok("emitLlmUsage prefers executor event queue when available");
}

{
  const adapter = createProviderAdapter({
    kind: "anthropic",
    model: "claude-x",
    baseUrl: "https://anthropic.test",
    apiKey: "k"
  });
  const out = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async () => ({
      ok: true,
      body: sseStream([
        { type: "message_start", message: { usage: { input_tokens: 12, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
        { type: "message_delta", usage: { output_tokens: 3, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 } },
        { type: "message_stop" }
      ])
    }),
    onTextDelta() {}
  });
  assert.equal(out.text, "hello");
  assert.equal(out.usage.input_tokens, 12);
  assert.equal(out.usage.output_tokens, 3);
  assert.equal(out.usage.cache_creation_input_tokens, 5);
  ok("Anthropic streaming adapter returns usage from SSE events");
}

{
  let capturedBody = null;
  const adapter = createProviderAdapter({
    kind: "openai",
    model: "deepseek-v4-flash",
    baseUrl: "https://openai.test/v1",
    apiKey: "k"
  });
  const out = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        body: sseStream([
          { choices: [{ delta: { content: "hi" } }] },
          { choices: [], usage: { prompt_tokens: 40, completion_tokens: 6, prompt_cache_hit_tokens: 30, prompt_cache_miss_tokens: 10 } },
          "data: [DONE]\n\n"
        ])
      };
    },
    onTextDelta() {}
  });
  assert.equal(capturedBody.stream, true);
  assert.deepEqual(capturedBody.stream_options, { include_usage: true });
  assert.equal(out.text, "hi");
  assert.equal(out.usage.input_tokens, 40);
  assert.equal(out.usage.output_tokens, 6);
  assert.equal(out.usage.cache_hit_tokens, 30);
  assert.equal(out.usage.cache_miss_tokens, 10);
  ok("OpenAI-compatible streaming adapter requests and returns usage");
}

{
  const payload = buildLlmUsagePayload({
    callSite: "agentic.planner",
    iteration: 1,
    usage: { prompt_tokens: 1, completion_tokens: 2 },
    provider: {
      describe() {
        return {
          provider_id: "p",
          provider_kind: "openai",
          provider_name: "Provider",
          model: "m",
          transport: "https"
        };
      }
    }
  });
  assert.equal(payload.call_site, "agentic.planner");
  assert.equal(payload.provider_id, "p");
  assert.equal(payload.usage.total_tokens, 3);
  ok("buildLlmUsagePayload accepts adapter descriptors");
}

{
  const agentLoop = readFileSync(new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url), "utf8");
  const agenticPlanner = readFileSync(new URL("../src/service/executors/agentic/planner.mjs", import.meta.url), "utf8");
  const finalComposer = readFileSync(new URL("../src/service/executors/tool_using/final-composer.mjs", import.meta.url), "utf8");
  assert.match(agentLoop, /emitLlmUsage\(\{[\s\S]*callSite:\s*"tool_using\.planner"/);
  assert.match(agenticPlanner, /emitLlmUsage\(\{[\s\S]*callSite:\s*"agentic\.planner"/);
  assert.match(agenticPlanner, /emitLlmUsage\(\{[\s\S]*callSite:\s*"agentic\.synthesis"/);
  assert.match(finalComposer, /emitLlmUsage\(\{[\s\S]*callSite:\s*"tool_using\.final_composer"/);
  ok("planner/composer call sites emit llm_usage");
}

process.stdout.write(`\n${pass} pass / 0 fail\n`);
