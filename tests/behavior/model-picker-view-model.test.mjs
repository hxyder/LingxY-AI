import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelPickerProviderItems,
  configuredModelPickerProviders,
  isModelPickerProviderConfigured,
  selectModelPickerProviderId
} from "../../src/desktop/renderer/model-picker-view-model.mjs";

const providers = [
  {
    id: "openai-main",
    name: "OpenAI",
    kind: "openai"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    apiKeyConfigured: true
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "code_cli",
    command: "claude"
  },
  {
    id: "local-ollama",
    name: "Ollama",
    kind: "ollama"
  }
];

test("model picker keeps unconfigured providers visible but not selectable as a route", () => {
  const items = buildModelPickerProviderItems(providers);

  assert.deepEqual(items.map((item) => item.id), [
    "openai-main",
    "deepseek",
    "claude-code",
    "local-ollama"
  ]);
  assert.equal(items.find((item) => item.id === "openai-main")?.configured, false);
  assert.equal(items.find((item) => item.id === "openai-main")?.statusLabel, "Setup required");
  assert.match(items.find((item) => item.id === "openai-main")?.setupReason ?? "", /API key|secret/);
  assert.equal(items.find((item) => item.id === "deepseek")?.selected, true);
});

test("model picker honors an existing conversation override even when other providers are first", () => {
  const items = buildModelPickerProviderItems(providers, "claude-code");

  assert.equal(selectModelPickerProviderId(providers, "claude-code"), "claude-code");
  assert.equal(items.find((item) => item.id === "claude-code")?.selected, true);
  assert.equal(items.find((item) => item.id === "deepseek")?.selected, false);
});

test("model picker recognizes provider-specific configuration contracts", () => {
  assert.equal(isModelPickerProviderConfigured({ id: "cli", kind: "code_cli" }), false);
  assert.equal(isModelPickerProviderConfigured({ id: "cli", kind: "code_cli", command: "codex" }), true);
  assert.equal(isModelPickerProviderConfigured({ id: "ollama", kind: "ollama" }), true);
  assert.equal(isModelPickerProviderConfigured({ id: "api", kind: "openai", apiKeyRef: "secret:api" }), true);

  assert.deepEqual(
    configuredModelPickerProviders(providers).map((provider) => provider.id),
    ["deepseek", "claude-code", "local-ollama"]
  );
});
