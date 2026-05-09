import assert from "node:assert/strict";
import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";

const encoder = new TextEncoder();

function streamResponse(text, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    }
  }), {
    status: 200,
    headers
  });
}

function sseFrame(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

{
  const adapter = createProviderAdapter({
    kind: "anthropic",
    providerName: "Claude",
    baseUrl: "https://api.anthropic.test",
    apiKey: "sk-ant-test",
    model: "claude-test"
  });
  assert.equal(adapter.supportsStreaming, true, "Anthropic adapter must advertise streaming.");

  let requestBody = null;
  const textDeltas = [];
  const toolDeltas = [];
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const body = [
      sseFrame({ type: "message_start", message: { usage: { input_tokens: 9 } } }),
      sseFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } }),
      sseFrame({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } }),
      sseFrame({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "lookup" } }),
      sseFrame({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"q\"" } }),
      sseFrame({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: ":\"x\"}" } }),
      sseFrame({ type: "content_block_stop", index: 1 }),
      sseFrame({ type: "message_delta", usage: { output_tokens: 3 } })
    ].join("");
    return streamResponse(body, { "content-type": "text/event-stream" });
  };

  const result = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "lookup", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
    fetchImpl: fakeFetch,
    onTextDelta: (delta) => textDeltas.push(delta),
    onToolInputDelta: (name, partialJson) => toolDeltas.push({ name, partialJson })
  });

  assert.equal(requestBody.stream, true, "Anthropic streaming request must set stream:true.");
  assert.deepEqual(textDeltas, ["Hel", "lo"]);
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.tool_calls, [{ id: "toolu_1", name: "lookup", arguments: { q: "x" } }]);
  assert.ok(toolDeltas.some((delta) => delta.name === "lookup" && delta.partialJson === "{\"q\":\"x\"}"));
  assert.equal(result.usage.input_tokens, 9);
  assert.equal(result.usage.output_tokens, 3);
}

{
  const adapter = createProviderAdapter({
    kind: "openai",
    providerName: "OpenAI-compatible",
    baseUrl: "https://api.openai-compatible.test/v1",
    apiKey: "sk-test",
    model: "gpt-test"
  });
  assert.equal(adapter.supportsStreaming, true, "OpenAI-compatible adapter must advertise streaming.");

  let requestBody = null;
  const textDeltas = [];
  const toolDeltas = [];
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const body = [
      sseFrame({ choices: [{ delta: { content: "Hel" } }] }),
      sseFrame({ choices: [{ delta: { content: "lo" } }] }),
      sseFrame({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: "{\"q\"" } }] } }] }),
      sseFrame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":\"x\"}" } }] } }] }),
      sseFrame({ usage: { prompt_tokens: 8, completion_tokens: 4 } }),
      "data: [DONE]\n\n"
    ].join("");
    return streamResponse(body, { "content-type": "text/event-stream" });
  };

  const result = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "lookup", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
    fetchImpl: fakeFetch,
    onTextDelta: (delta) => textDeltas.push(delta),
    onToolInputDelta: (name, partialJson) => toolDeltas.push({ name, partialJson })
  });

  assert.equal(requestBody.stream, true, "OpenAI-compatible streaming request must set stream:true.");
  assert.equal(requestBody.stream_options?.include_usage, true, "OpenAI-compatible streaming must request usage when supported.");
  assert.deepEqual(textDeltas, ["Hel", "lo"]);
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.tool_calls, [{ id: "call_1", name: "lookup", arguments: { q: "x" } }]);
  assert.ok(toolDeltas.some((delta) => delta.name === "lookup" && delta.partialJson === "{\"q\":\"x\"}"));
  assert.equal(result.usage.input_tokens, 8);
  assert.equal(result.usage.output_tokens, 4);
}

{
  const adapter = createProviderAdapter({
    kind: "ollama",
    providerName: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama-test"
  });
  assert.equal(adapter.supportsStreaming, true, "Ollama adapter must advertise streaming.");

  let requestBody = null;
  const textDeltas = [];
  const toolDeltas = [];
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const body = [
      JSON.stringify({ message: { content: "Hel" }, done: false }),
      JSON.stringify({ message: { content: "lo" }, done: false }),
      JSON.stringify({ message: { tool_calls: [{ function: { name: "lookup", arguments: { q: "x" } } }] }, done: false }),
      JSON.stringify({ done: true, prompt_eval_count: 7, eval_count: 2 })
    ].join("\n");
    return streamResponse(body, { "content-type": "application/x-ndjson" });
  };

  const result = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "lookup", input_schema: { type: "object", properties: { q: { type: "string" } } } }],
    fetchImpl: fakeFetch,
    onTextDelta: (delta) => textDeltas.push(delta),
    onToolInputDelta: (name, partialJson) => toolDeltas.push({ name, partialJson })
  });

  assert.equal(requestBody.stream, true, "Ollama streaming request must set stream:true.");
  assert.deepEqual(textDeltas, ["Hel", "lo"]);
  assert.equal(result.text, "Hello");
  assert.deepEqual(result.tool_calls, [{ id: null, name: "lookup", arguments: { q: "x" } }]);
  assert.deepEqual(toolDeltas, [{ name: "lookup", partialJson: "{\"q\":\"x\"}" }]);
  assert.equal(result.usage.input_tokens, 7);
  assert.equal(result.usage.output_tokens, 2);
}

console.log("provider streaming parity ok");
