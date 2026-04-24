// Phase 22 verifier (UCA-182) — DeepSeek v4 thinking-mode echo.
//
// Symptom: "error 400: The reasoning_content in the thinking mode
// must be passed back to the API." That API requires that any
// assistant message previously returned with a reasoning_content
// field be echoed back verbatim on the next turn. We verify three
// layers:
//   1. parseOpenAIResponse captures message.reasoning_content.
//   2. The streaming OpenAI path accumulates delta.reasoning_content.
//   3. convertMessagesForOpenAI forwards reasoning_content on
//      assistant turns (with and without tool_calls).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. Static wiring sanity ---------------------------------------
{
  const src = await readFile(path.join(ROOT, "src/service/executors/agentic/provider-adapter.mjs"), "utf8");
  assert.ok(src.includes("reasoning_content: typeof message.reasoning_content"),
    "parseOpenAIResponse must extract reasoning_content from the non-streaming response");
  assert.ok(src.includes("delta.reasoning_content"),
    "streaming path must accumulate delta.reasoning_content");
  assert.ok(src.includes("fullReasoning += delta.reasoning_content"),
    "stream accumulator must concat reasoning deltas");
  assert.ok(src.includes("assistantFrame.reasoning_content = msg.reasoning_content"),
    "convertMessagesForOpenAI must forward reasoning_content on tool-call assistant turns");

  const planner = await readFile(path.join(ROOT, "src/service/executors/agentic/planner.mjs"), "utf8");
  assert.ok(planner.includes("response.reasoning_content"),
    "planner must read response.reasoning_content");
  assert.ok(planner.includes("assistantMessage.reasoning_content = reasoningContent"),
    "planner must attach reasoning_content to the stored assistant message");
}

// --- 2. End-to-end: mock fetch that requires echo -------------------
{
  const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");

  // First response: DeepSeek-style message with reasoning_content +
  // a tool_call. Second response: the server demands reasoning_content
  // be present in the replayed assistant turn — we fail if it's not.
  let calls = 0;
  const seenAssistantFrames = [];
  const fakeFetch = async (_url, options) => {
    calls += 1;
    const body = JSON.parse(options.body);
    // Capture any assistant-role messages we were sent.
    for (const m of body.messages) {
      if (m.role === "assistant") seenAssistantFrames.push(m);
    }
    if (calls === 1) {
      return mockResponse({
        id: "req-1",
        choices: [{
          message: {
            role: "assistant",
            content: "",
            reasoning_content: "let me think...",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "recall_memory", arguments: JSON.stringify({ query: "x" }) }
            }]
          }
        }]
      });
    }
    // Second call: ensure the previously-returned reasoning_content
    // came back as part of the replayed assistant turn. If not,
    // simulate DeepSeek's 400.
    const lastAssistant = [...body.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant || typeof lastAssistant.reasoning_content !== "string" || !lastAssistant.reasoning_content) {
      return mockResponse({
        error: {
          message: "The reasoning_content in the thinking mode must be passed back to the API.",
          type: "invalid_request_error",
          code: "invalid_request_error"
        }
      }, 400);
    }
    return mockResponse({
      id: "req-2",
      choices: [{
        message: { role: "assistant", content: "ok done", reasoning_content: "second thought" }
      }]
    });
  };

  const resolved = {
    kind: "openai",
    baseUrl: "https://mock.deepseek.com/v1",
    apiKey: "test",
    model: "deepseek-v4-flash",
    providerName: "deepseek"
  };
  const adapter = createProviderAdapter(resolved);

  const firstResp = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    fetchImpl: fakeFetch
  });
  assert.equal(firstResp.reasoning_content, "let me think...",
    "adapter must surface reasoning_content from the first response");
  assert.equal(firstResp.tool_calls.length, 1);

  // Simulate the planner flow: attach reasoning_content to the
  // stored assistant message, then do the next turn.
  const assistantMsg = {
    role: "assistant",
    content: firstResp.text ?? "",
    tool_calls: firstResp.tool_calls,
    reasoning_content: firstResp.reasoning_content
  };
  const secondResp = await adapter.generate({
    messages: [
      { role: "user", content: "hi" },
      assistantMsg,
      { role: "tool", tool_call_id: "call_1", content: "result" }
    ],
    tools: [],
    fetchImpl: fakeFetch
  });
  assert.equal(secondResp.text, "ok done",
    "second-turn call must succeed once reasoning_content is echoed");
  // Sanity: the replayed assistant frame carried reasoning_content.
  const replayed = seenAssistantFrames.find((m) => m.content === "" || m.tool_calls);
  assert.ok(replayed?.reasoning_content,
    "the replayed assistant frame must include reasoning_content");
}

// --- 3. Non-thinking providers still work (no reasoning_content) ---
{
  const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");
  const fakeFetch = async () => mockResponse({
    id: "req",
    choices: [{ message: { role: "assistant", content: "plain reply" } }]
  });
  const resolved = {
    kind: "openai", baseUrl: "https://mock.openai.com/v1", apiKey: "x",
    model: "gpt-4o", providerName: "openai"
  };
  const adapter = createProviderAdapter(resolved);
  const r = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    fetchImpl: fakeFetch
  });
  assert.equal(r.reasoning_content, null,
    "adapter.reasoning_content is null when the response didn't set one");
  assert.equal(r.text, "plain reply");
}

console.log("ok verify-deepseek-reasoning-echo");

// ------- helpers -----------------------------------------------------
function mockResponse(bodyObj, status = 200) {
  const json = JSON.stringify(bodyObj);
  return {
    ok: status < 400,
    status,
    headers: { get: () => "application/json" },
    body: null,
    async text() { return json; },
    async json() { return bodyObj; }
  };
}
