import assert from "node:assert/strict";
import { createProviderModelDiscovery } from "../src/service/ai/providers/model-discovery.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

let openAiCalls = 0;
let anthropicCalls = 0;
let ollamaCalls = 0;
let openAiFailure = false;

const discovery = createProviderModelDiscovery({
  cacheTtlMs: 60_000,
  fetchImpl: async (url, init = {}) => {
    const href = typeof url === "string" ? url : `${url}`;
    if (href.includes("api.example.com/v1/models")) {
      openAiCalls += 1;
      assert.equal(init.headers.Authorization, "Bearer sk-openai");
      if (openAiFailure) {
        return jsonResponse({ error: "boom" }, 500);
      }
      return jsonResponse({
        data: [
          { id: "provider/new-model" },
          { id: "provider/vision-model" }
        ]
      });
    }
    if (href.includes("api.anthropic.com/v1/models")) {
      anthropicCalls += 1;
      assert.equal(init.headers["x-api-key"], "sk-ant");
      assert.equal(init.headers["anthropic-version"], "2023-06-01");
      const query = new URL(href).searchParams;
      if (query.get("after_id") === "cursor-1") {
        return jsonResponse({
          data: [
            { id: "claude-opus-4-5-20250514", display_name: "Claude Opus 4.5" }
          ],
          has_more: false,
          last_id: "cursor-2"
        });
      }
      return jsonResponse({
        data: [
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" }
        ],
        has_more: true,
        last_id: "cursor-1"
      });
    }
    if (href.includes("127.0.0.1:11434/api/tags")) {
      ollamaCalls += 1;
      return jsonResponse({
        models: [
          { name: "llama3.2" },
          { name: "qwen2.5" }
        ]
      });
    }
    throw new Error(`Unexpected fetch URL: ${href}`);
  }
});

const openAiProvider = {
  id: "openrouter-test",
  kind: "openai",
  name: "OpenRouter Test",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-openai",
  defaultModel: "provider/saved-model"
};

const openAiFirst = await discovery.getProviderModelOptions(openAiProvider);
assert.equal(openAiFirst.dynamic, true);
assert.equal(openAiFirst.source, "provider_models");
assert.deepEqual(openAiFirst.models.slice(0, 4).map((entry) => entry.id), [
  "provider/saved-model",
  "openai/gpt-4o",
  "anthropic/claude-sonnet-4-5",
  "google/gemini-2.0-flash"
]);
assert.equal(openAiFirst.models.some((entry) => entry.id === "provider/new-model"), true);
assert.equal(openAiCalls, 1);

const openAiCached = await discovery.getProviderModelOptions(openAiProvider);
assert.equal(openAiCached.models.length, openAiFirst.models.length);
assert.equal(openAiCalls, 1);

openAiFailure = true;
const openAiStale = await discovery.getProviderModelOptions(openAiProvider, { forceRefresh: true });
assert.equal(openAiStale.stale, true);
assert.equal(openAiStale.error.startsWith("500"), true);
assert.equal(openAiStale.models.some((entry) => entry.id === "provider/new-model"), true);
assert.equal(openAiCalls, 2);

const anthropicProvider = {
  id: "anthropic-test",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-ant",
  defaultModel: "claude-sonnet-4-6"
};
const anthropicOptions = await discovery.getProviderModelOptions(anthropicProvider);
assert.equal(anthropicOptions.source, "anthropic_models");
assert.equal(anthropicOptions.models.some((entry) => entry.id === "claude-opus-4-5-20250514"), true);
assert.equal(anthropicCalls, 2);

const ollamaProvider = {
  id: "ollama-test",
  kind: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  defaultModel: "llama3.2"
};
const ollamaOptions = await discovery.getProviderModelOptions(ollamaProvider);
assert.equal(ollamaOptions.source, "ollama_tags");
assert.equal(ollamaOptions.models.some((entry) => entry.id === "qwen2.5"), true);
assert.equal(ollamaCalls, 1);

const cliProvider = {
  id: "codex-cli",
  kind: "code_cli",
  name: "Codex CLI",
  command: "codex.exe",
  defaultModel: ""
};
const cliOptions = await discovery.getProviderModelOptions(cliProvider);
assert.equal(cliOptions.dynamic, false);
assert.equal(cliOptions.models.some((entry) => entry.id === "gpt-5.4"), true);

console.log("Provider model discovery verification passed.");
