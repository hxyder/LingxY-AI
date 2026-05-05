import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_API_TEMPLATES,
  MODEL_CATALOG_REVIEW,
  STALE_MODEL_IDS_BY_FAMILY,
  applyReasoningSelectionToBody,
  buildOpenAIChatCompletionBody,
  catalogDefaultModelForProvider,
  codeCliModelChoices,
  isKnownStaleModelForProviderFamily,
  modeOptionsForProvider,
  modelLooksStaleForProvider,
  normalizeReasoningSelection,
  providerModelPresets,
  reasoningOptionsForProvider,
  resolveModeModel
} from "../../src/shared/provider-catalog.mjs";
import {
  PROVIDER_DEFAULT_MODELS as BROWSER_PROVIDER_DEFAULT_MODELS,
  PROVIDER_MODEL_PRESETS as BROWSER_PROVIDER_MODEL_PRESETS,
  STALE_MODEL_IDS_BY_FAMILY as BROWSER_STALE_MODEL_IDS_BY_FAMILY,
  isStandaloneProviderConfigured,
  normalizeStandaloneConfig as normalizeBrowserStandaloneConfig
} from "../../browser_ext/shared/provider-catalog.js";
import {
  normalizeClaudeEffort
} from "../../src/service/executors/shared/code-cli-invocation.mjs";

test("provider catalog exposes current official OpenAI defaults and Chat body shape", () => {
  const provider = { id: "openai", kind: "openai", baseUrl: "https://api.openai.com/v1" };
  assert.equal(BUILTIN_API_TEMPLATES.find((entry) => entry.id === "openai")?.defaultModel, "gpt-5.4-mini");
  assert.equal(catalogDefaultModelForProvider(provider, "chat"), "gpt-5.4-mini");

  const presets = providerModelPresets(provider, "chat");
  assert.ok(presets.includes("gpt-5.5"));
  assert.ok(presets.includes("gpt-5.4"));
  assert.ok(presets.includes("gpt-5.4-mini"));
  assert.equal(presets.includes("gpt-5.2-pro"), false);
  assert.equal(presets.includes("gpt-5-mini"), false);

  const body = buildOpenAIChatCompletionBody({
    provider,
    model: "gpt-5.5",
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

test("provider catalog records source review metadata for curated model fallbacks", () => {
  assert.equal(MODEL_CATALOG_REVIEW.reviewedAt, "2026-05-04");
  assert.match(MODEL_CATALOG_REVIEW.policy, /discovery is authoritative/u);
  for (const family of ["openai", "anthropic", "deepseek", "gemini", "mistral"]) {
    assert.match(MODEL_CATALOG_REVIEW.sources[family], /^https:\/\//u);
  }
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
  assert.ok(providerModelPresets({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat").includes("claude-sonnet-4-6"));
  assert.ok(providerModelPresets({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat").includes("claude-opus-4-7"));
  assert.equal(providerModelPresets({ kind: "anthropic", baseUrl: "https://api.anthropic.com" }, "chat").includes("claude-sonnet-4-20250514"), false);

  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" }, "chat").includes("gemini-3.1-pro-preview"));
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.moonshot.cn/v1" }, "chat").includes("kimi-k2.6"));
  assert.equal(providerModelPresets({ kind: "openai", baseUrl: "https://api.moonshot.cn/v1" }, "chat").includes("kimi-latest"), false);
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.x.ai/v1" }, "chat").includes("grok-4.3"));
  assert.ok(providerModelPresets({ kind: "openai", baseUrl: "https://api.mistral.ai/v1" }, "chat").includes("mistral-medium-3.5"));
  assert.equal(providerModelPresets({ kind: "openai", baseUrl: "https://api.mistral.ai/v1" }, "chat").includes("mistral-medium-3-5"), false);
  assert.equal(modelLooksStaleForProvider({ kind: "openai", baseUrl: "https://api.moonshot.cn/v1" }, "kimi-latest"), true);
  assert.equal(modelLooksStaleForProvider({ kind: "openai", baseUrl: "https://api.mistral.ai/v1" }, "mistral-medium-3-5"), true);
  assert.equal(isKnownStaleModelForProviderFamily("moonshot", "kimi-latest"), true);
  assert.equal(isKnownStaleModelForProviderFamily("mistral", "mistral-medium-3-5"), true);
  assert.deepEqual(BROWSER_STALE_MODEL_IDS_BY_FAMILY.moonshot, STALE_MODEL_IDS_BY_FAMILY.moonshot);
  assert.deepEqual(BROWSER_STALE_MODEL_IDS_BY_FAMILY.mistral, STALE_MODEL_IDS_BY_FAMILY.mistral);

  const moonshotModes = modeOptionsForProvider({ kind: "openai", baseUrl: "https://api.moonshot.cn/v1" }, "kimi-k2.6");
  assert.equal(moonshotModes.some((option) => option.model === "kimi-latest"), false);
});

test("Claude Code catalog exposes aliases, Opus 4.7, and CLI effort options", () => {
  const provider = { kind: "code_cli", command: "claude.exe", defaultModel: "opus" };
  const presets = providerModelPresets(provider, "chat");
  assert.ok(presets.includes("best"));
  assert.ok(presets.includes("opus"));
  assert.ok(presets.includes("opus[1m]"));
  assert.ok(presets.includes("claude-opus-4-7"));

  const efforts = reasoningOptionsForProvider(provider, "claude-opus-4-7").map((option) => option.id);
  assert.ok(efforts.includes("xhigh"));
  assert.ok(efforts.includes("max"));

  const choices = codeCliModelChoices(provider).map((choice) => choice.id);
  assert.ok(choices.includes("best"));
  assert.ok(choices.includes("opus[1m]"));
  assert.equal(modelLooksStaleForProvider(provider, "default"), false);
  assert.equal(modelLooksStaleForProvider(provider, "opusplan"), false);
  assert.equal(modelLooksStaleForProvider(provider, "opus[1m]"), false);
  assert.equal(modelLooksStaleForProvider(provider, "claude-opus-4-7[1m]"), false);
  assert.equal(modelLooksStaleForProvider(provider, "defaulted"), true);
  assert.equal(normalizeReasoningSelection(provider, "claude-opus-4-7", "extra_high"), "xhigh");
  assert.equal(normalizeReasoningSelection(provider, "claude-opus-4-7", "max"), "max");
  assert.equal(normalizeClaudeEffort("extra-high"), "xhigh");
  assert.equal(normalizeClaudeEffort("MAX"), "max");
  assert.equal(normalizeClaudeEffort("unsupported"), "");
});

test("browser extension provider catalog mirrors current public model defaults", () => {
  assert.equal(BROWSER_PROVIDER_DEFAULT_MODELS.openai, "gpt-5.4-mini");
  assert.equal(BROWSER_PROVIDER_DEFAULT_MODELS.gemini, "gemini-2.5-flash");
  assert.equal(BROWSER_PROVIDER_DEFAULT_MODELS.xai, "grok-4.3");
  assert.equal(BROWSER_PROVIDER_DEFAULT_MODELS.moonshot, "kimi-k2.6");
  assert.equal(BROWSER_PROVIDER_DEFAULT_MODELS.mistral, "mistral-medium-3.5");
  assert.ok(BROWSER_PROVIDER_MODEL_PRESETS.openai.includes("gpt-5.5"));
  assert.ok(BROWSER_PROVIDER_MODEL_PRESETS.anthropic.includes("claude-opus-4-7"));
  assert.ok(BROWSER_PROVIDER_MODEL_PRESETS.gemini.includes("gemini-3.1-pro-preview"));
  assert.ok(BROWSER_PROVIDER_MODEL_PRESETS.moonshot.includes("kimi-k2.6"));
  assert.equal(BROWSER_PROVIDER_MODEL_PRESETS.moonshot.includes("kimi-latest"), false);
  assert.equal(normalizeBrowserStandaloneConfig({ provider: "moonshot", model: "kimi-latest" }).model, "kimi-k2.6");
  assert.equal(normalizeBrowserStandaloneConfig({ provider: "mistral", model: "mistral-medium-3-5" }).model, "mistral-medium-3.5");
});

test("browser standalone readiness follows provider auth style instead of raw api key", () => {
  assert.equal(isStandaloneProviderConfigured({ provider: "openai", apiKey: "" }), false);
  assert.equal(isStandaloneProviderConfigured({ provider: "openai", apiKey: "sk-test" }), true);
  assert.equal(isStandaloneProviderConfigured({ provider: "ollama", apiKey: "" }), true);
});
