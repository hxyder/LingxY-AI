import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_API_TEMPLATES,
  applyReasoningSelectionToBody,
  buildOpenAIChatCompletionBody,
  catalogDefaultModelForProvider,
  modeOptionsForProvider,
  providerModelPresets,
  reasoningOptionsForProvider,
  resolveModeModel
} from "../../src/shared/provider-catalog.mjs";

test("provider catalog exposes current official OpenAI defaults and Chat body shape", () => {
  const provider = { id: "openai", kind: "openai", baseUrl: "https://api.openai.com/v1" };
  assert.equal(BUILTIN_API_TEMPLATES.find((entry) => entry.id === "openai")?.defaultModel, "gpt-5-mini");
  assert.equal(catalogDefaultModelForProvider(provider, "chat"), "gpt-5-mini");

  const presets = providerModelPresets(provider, "chat");
  assert.ok(presets.includes("gpt-5.2"));
  assert.ok(presets.includes("gpt-5.2-pro"));
  assert.ok(presets.includes("gpt-5-mini"));
  assert.equal(presets.includes("gpt-5.4"), false);
  assert.equal(presets.includes("gpt-5.5"), false);

  const body = buildOpenAIChatCompletionBody({
    provider,
    model: "gpt-5.2",
    messages: [
      { role: "system", content: "Follow instructions." },
      { role: "user", content: "Hi" }
    ],
    maxTokens: 123
  });
  assert.equal(body.messages[0].role, "developer");
  assert.equal(body.max_completion_tokens, 123);
  assert.equal(body.max_tokens, undefined);
});

test("DeepSeek catalog prefers v4 while preserving documented compatibility aliases", () => {
  const provider = { id: "deepseek", kind: "openai", baseUrl: "https://api.deepseek.com/v1" };
  assert.equal(BUILTIN_API_TEMPLATES.find((entry) => entry.id === "deepseek")?.defaultModel, "deepseek-v4-flash");
  assert.equal(catalogDefaultModelForProvider(provider, "chat"), "deepseek-v4-flash");

  const presets = providerModelPresets(provider, "chat");
  assert.ok(presets.includes("deepseek-v4-flash"));
  assert.ok(presets.includes("deepseek-v4-pro"));
  assert.ok(presets.includes("deepseek-chat"));
  assert.ok(presets.includes("deepseek-reasoner"));

  const modes = modeOptionsForProvider(provider, "deepseek-v4-flash").map((option) => option.id);
  assert.ok(modes.includes("flash"));
  assert.ok(modes.includes("pro"));
  assert.equal(resolveModeModel(provider, "deepseek-v4-flash", "pro"), "deepseek-v4-pro");

  const reasoning = reasoningOptionsForProvider(provider, "deepseek-v4-flash").map((option) => option.id);
  assert.ok(reasoning.includes("thinking:disabled"));
  assert.ok(reasoning.includes("thinking:enabled"));

  const body = applyReasoningSelectionToBody({}, provider, "deepseek-v4-flash", "");
  assert.deepEqual(body.thinking, { type: "disabled" });
  const enabled = applyReasoningSelectionToBody({}, provider, "deepseek-v4-flash", "thinking:enabled|high");
  assert.deepEqual(enabled.thinking, { type: "enabled" });
  assert.equal(enabled.reasoning_effort, undefined);
});

test("major provider presets use public model ids instead of stale local guesses", () => {
  assert.ok(providerModelPresets({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat").includes("claude-sonnet-4-20250514"));
  assert.equal(providerModelPresets({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat").includes("claude-sonnet-4-6"), false);

  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" }, "chat").includes("gemini-3-pro-preview"));
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.moonshot.cn/v1" }, "chat").includes("kimi-k2.6"));
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.x.ai/v1" }, "chat").includes("grok-4.20-reasoning"));
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.mistral.ai/v1" }, "chat").includes("mistral-large-latest"));
});
