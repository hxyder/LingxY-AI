#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cacheableSystemMessage } from "../src/service/executors/shared/prompt-cache.mjs";
import { createProviderAdapter } from "../src/service/executors/agentic/provider-adapter.mjs";
import { buildAgenticStableSystemPrompt } from "../src/service/executors/agentic/prompt-builder.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

{
  let capturedBody = null;
  const adapter = createProviderAdapter({
    kind: "anthropic",
    model: "claude-sonnet",
    baseUrl: "https://anthropic.test",
    apiKey: "k"
  });
  await adapter.generate({
    messages: [
      cacheableSystemMessage("stable framework prefix"),
      { role: "system", content: "dynamic task tail" },
      { role: "user", content: "hello" }
    ],
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        text: async () => JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 7 }
        })
      };
    }
  });
  assert.equal(Array.isArray(capturedBody.system), true);
  assert.deepEqual(capturedBody.system[0].cache_control, { type: "ephemeral" });
  assert.equal(capturedBody.system[0].text, "stable framework prefix");
  assert.equal(capturedBody.system[1].text, "dynamic task tail");
  assert.equal(capturedBody.system[1].cache_control, undefined);
}

{
  let capturedBody = null;
  const adapter = createProviderAdapter({
    kind: "openai",
    providerName: "OpenAI",
    id: "openai",
    model: "gpt-5.5",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "k"
  });
  const out = await adapter.generate({
    messages: [
      cacheableSystemMessage("stable framework prefix"),
      { role: "system", content: "dynamic task tail" },
      { role: "user", content: "hello" }
    ],
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        text: async () => JSON.stringify({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 2,
            prompt_tokens_details: { cached_tokens: 64 }
          }
        })
      };
    }
  });
  assert.equal(capturedBody.messages[0].role, "developer");
  assert.equal(capturedBody.messages[0].content, "stable framework prefix");
  assert.equal(capturedBody.messages[1].role, "developer");
  assert.equal(capturedBody.messages[1].content, "dynamic task tail");
  assert.equal("cache_control" in capturedBody.messages[0], false);
  assert.equal(out.usage.cache_hit_tokens, 64);
}

{
  const stable = buildAgenticStableSystemPrompt();
  assert.match(stable, /stable agentic-planner contract/);
  assert.doesNotMatch(stable, /Available tools|Task contract|User's original request/);
}

{
  const fastExecutor = read("src/service/executors/fast/fast-executor.mjs");
  const toolUsing = read("src/service/executors/tool_using/agent-loop.mjs");
  const agenticPlanner = read("src/service/executors/agentic/planner.mjs");
  assert.match(fastExecutor, /withFastCacheablePrefix\(messages\)/);
  assert.match(fastExecutor, /callSite:\s*"fast\.executor"/);
  assert.match(toolUsing, /cacheableSystemMessage\(TOOL_USING_CACHEABLE_SYSTEM_PREFIX\)/);
  assert.match(toolUsing, /name:\s*"cacheable_system"/);
  assert.match(agenticPlanner, /cacheableSystemMessage\(stableSystemPrompt\)/);
  assert.match(agenticPlanner, /name:\s*"dynamic_system"/);
}

console.log("prompt cache coverage ok");
