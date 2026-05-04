#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const scratchDir = path.join(repoRoot, ".tmp", "verify-conversation-model-override");
const configPath = path.join(scratchDir, "runtime.json");

await rm(scratchDir, { recursive: true, force: true });
await mkdir(scratchDir, { recursive: true });

process.env.UCA_CONFIG_PATH = configPath;
for (const envKey of [
  "ANTHROPIC_API_KEY",
  "UCA_ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "UCA_OPENAI_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "UCA_KIMI_API_KEY",
  "UCA_OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "UCA_OLLAMA_MODEL"
]) {
  delete process.env[envKey];
}

const {
  resolveProviderForTask,
  resolveCodeCliRuntimeForTask
} = await import("../src/service/executors/shared/provider-resolver.mjs");

async function writeConfig(obj) {
  await writeFile(configPath, JSON.stringify(obj, null, 2), "utf8");
}

function makeStore(metadataByConversation = {}) {
  return {
    getConversation(id) {
      return {
        conversation_id: id,
        metadata: metadataByConversation[id] ?? {}
      };
    }
  };
}

await writeConfig({
  ai: {
    customProviders: [
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "openai",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test-deepseek",
        defaultModel: "deepseek-v4-flash"
      },
      {
        id: "openai-main",
        name: "OpenAI",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test-openai",
        defaultModel: "gpt-5.4-mini"
      },
      {
        id: "claude-cli",
        name: "Claude Code",
        kind: "code_cli",
        command: "claude",
        defaultModel: "claude-opus-4-7"
      }
    ],
    taskRouting: {
      chat: { providerId: "deepseek", model: "deepseek-v4-flash" },
      router: { providerId: "deepseek", model: "deepseek-v4-flash" },
      embedding: { providerId: "openai-main", model: "text-embedding-3-small" }
    }
  }
});

{
  const store = makeStore({
    conv_override: {
      modelOverride: {
        providerId: "openai-main",
        model: "gpt-5.4",
        reasoningEffort: "medium"
      }
    }
  });
  const provider = resolveProviderForTask("chat", process.env, {
    conversationId: "conv_override",
    store
  });
  assert.equal(provider.configId, "openai-main");
  assert.equal(provider.model, "gpt-5.4");
  assert.equal(provider.reasoningEffort, "medium");
}

{
  const store = makeStore({
    conv_cli: {
      modelOverride: {
        providerId: "claude-cli",
        model: "claude-opus-4-7",
        reasoningEffort: "xhigh"
      }
    }
  });
  const provider = resolveProviderForTask("chat", process.env, {
    conversationId: "conv_cli",
    store
  });
  assert.equal(provider.kind, "code_cli");
  assert.equal(provider.configId, "claude-cli");
  assert.equal(provider.command, "claude");
  assert.equal(provider.model, "claude-opus-4-7");
  assert.equal(provider.reasoningEffort, "xhigh");

  const runtime = resolveCodeCliRuntimeForTask("chat", null, {
    conversationId: "conv_cli",
    store
  });
  assert.equal(runtime.command, "claude");
  assert.equal(runtime.model, "claude-opus-4-7");
  assert.equal(runtime.reasoningEffort, "xhigh");
  assert.equal(runtime.configId, "claude-cli");
}

{
  const provider = resolveProviderForTask("chat", process.env, {
    conversationId: "conv_plain",
    store: makeStore()
  });
  assert.equal(provider.configId, "deepseek");
  assert.equal(provider.model, "deepseek-v4-flash");
}

{
  const store = makeStore({
    conv_missing: {
      modelOverride: {
        providerId: "missing-provider",
        model: "some-model"
      }
    }
  });
  const provider = resolveProviderForTask("chat", process.env, {
    conversationId: "conv_missing",
    store
  });
  assert.equal(provider.configId, "deepseek", "missing conversation pin must fall through to task routing");
}

{
  const store = makeStore({
    conv_override: {
      modelOverride: {
        providerId: "openai-main",
        model: "gpt-5.4"
      }
    }
  });
  const routerProvider = resolveProviderForTask("router", process.env, {
    conversationId: "conv_override",
    store
  });
  assert.equal(routerProvider.configId, "deepseek", "router must ignore chat conversation pins");
  assert.equal(routerProvider.model, "deepseek-v4-flash");

  const embeddingProvider = resolveProviderForTask("embedding", process.env, {
    conversationId: "conv_override",
    store
  });
  assert.equal(embeddingProvider.configId, "openai-main", "embedding must stay on task routing");
  assert.equal(embeddingProvider.model, "text-embedding-3-small");
}

await rm(scratchDir, { recursive: true, force: true });
console.log("conversation model override verification passed");
