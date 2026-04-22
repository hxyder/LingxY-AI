import assert from "node:assert/strict";

const {
  sanitizeTaskRouteForProvider
} = await import("../src/service/executors/shared/provider-resolver.mjs");

const {
  sanitizeProviderConfig
} = await import("../src/shared/provider-catalog.mjs");

const {
  normalizeStandaloneConfig
} = await import("../browser_ext/shared/provider-catalog.js");

{
  const doubaoProvider = {
    id: "doubao",
    kind: "openai",
    name: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-seed-2-0-lite-260215"
  };
  const staleRoute = {
    providerId: "doubao",
    model: "gpt-4o",
    mode: "balanced"
  };
  const next = sanitizeTaskRouteForProvider(doubaoProvider, staleRoute, "chat");
  assert.equal(
    next.model,
    "doubao-seed-2-0-lite-260215",
    "Doubao routing must discard stale OpenAI model ids"
  );
  assert.equal(
    next.mode,
    "default",
    "Doubao routing must discard stale OpenAI-only mode flags"
  );
}

{
  const moonshotProvider = {
    id: "moonshot",
    kind: "openai",
    name: "Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k"
  };
  const staleRoute = {
    providerId: "moonshot",
    model: "gpt-4o",
    mode: "default"
  };
  const next = sanitizeTaskRouteForProvider(moonshotProvider, staleRoute, "chat");
  assert.equal(
    next.model,
    "moonshot-v1-8k",
    "Moonshot routing must discard stale OpenAI model ids"
  );
}

{
  const deepseekProvider = sanitizeProviderConfig({
    id: "deepseek",
    kind: "openai",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: ""
  });
  assert.equal(
    deepseekProvider.defaultModel,
    "deepseek-chat",
    "Known providers should get their canonical default model when the saved default is blank"
  );
}

{
  const codexProvider = sanitizeProviderConfig({
    id: "codex",
    kind: "code_cli",
    name: "Codex CLI",
    command: "codex.exe",
    defaultModel: "gpt-4o"
  });
  assert.equal(
    codexProvider.defaultModel,
    "",
    "Codex CLI should discard legacy gpt-4o defaults and fall back to CLI-managed mode"
  );
}

{
  const normalized = normalizeStandaloneConfig({
    provider: "doubao",
    apiKey: "test",
    model: "gpt-4o"
  });
  assert.equal(
    normalized.model,
    "doubao-seed-2-0-lite-260215",
    "Standalone config must repair stale OpenAI model ids for Doubao"
  );
}

{
  const normalized = normalizeStandaloneConfig({
    provider: "deepseek",
    apiKey: "test",
    model: "gpt-4o"
  });
  assert.equal(
    normalized.model,
    "deepseek-chat",
    "Standalone config must repair stale OpenAI model ids for DeepSeek"
  );
}

{
  const normalized = normalizeStandaloneConfig({
    provider: "openrouter",
    apiKey: "test",
    model: "gpt-4o"
  });
  assert.equal(
    normalized.model,
    "gpt-4o",
    "OpenRouter should keep cross-family model ids because the provider intentionally aggregates them"
  );
}

console.log("Cross-provider model sanitization verification passed.");
