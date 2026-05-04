import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityGapSuggestions,
  mergeCapabilityGapSuggestions
} from "../../src/service/ai/onboarding/capability-gap-suggestions.mjs";

const configuredOpenAi = {
  id: "openai-main",
  name: "OpenAI Main",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test-openai",
  defaultModel: "gpt-5.4-mini"
};

const configuredCli = {
  id: "claude-cli",
  name: "Claude Code",
  kind: "code_cli",
  command: "claude",
  defaultModel: "claude-opus-4-7",
  transport: "stream_json_print"
};

test("capability gap suggestions derive from every configured provider without leaking secrets", () => {
  const suggestions = buildCapabilityGapSuggestions({
    config: {
      ai: {
        customProviders: [
          configuredOpenAi,
          { id: "incomplete", kind: "openai", baseUrl: "https://example.invalid" },
          configuredCli
        ],
        mcp: {
          builtinToggles: {
            "mcp-filesystem": { enabled: false }
          }
        }
      }
    },
    env: {}
  });

  assert.ok(suggestions.some((suggestion) => suggestion.id === "provider:openai-main:mcp:enable-mcp-filesystem"));
  assert.ok(suggestions.some((suggestion) => suggestion.id === "provider:claude-cli:mcp:code-cli-mcp-config"));
  assert.ok(!suggestions.some((suggestion) => suggestion.providerId === "incomplete"));
  assert.ok(suggestions.every((suggestion) => suggestion.trigger === "capability_gap"));
  assert.doesNotMatch(JSON.stringify(suggestions), /sk-test-openai|apiKey/u);
});

test("conversation model override scopes suggestions to the pinned provider", () => {
  const suggestions = buildCapabilityGapSuggestions({
    config: {
      ai: {
        customProviders: [configuredOpenAi, configuredCli]
      }
    },
    conversationModelOverride: {
      providerId: "claude-cli",
      model: "claude-opus-4-7",
      reasoningEffort: "xhigh"
    },
    conversationId: "conv_model_pick",
    env: {}
  });

  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every((suggestion) => suggestion.providerId === "claude-cli"));
  assert.ok(suggestions.every((suggestion) => suggestion.trigger === "conversation_model_override"));
  assert.ok(suggestions.every((suggestion) => suggestion.conversationId === "conv_model_pick"));
  assert.ok(suggestions.some((suggestion) => suggestion.id === "provider:claude-cli:mcp:code-cli-mcp-config"));
  assert.ok(!suggestions.some((suggestion) => suggestion.providerId === "openai-main"));
});

test("capability gap merge preserves dismissed suggestions as a non-persistent view", () => {
  const now = "2026-05-04T10:00:00.000Z";
  const suggestions = buildCapabilityGapSuggestions({
    providers: [configuredOpenAi],
    config: {},
    trigger: "provider_saved",
    env: {}
  });
  const dismissedId = "provider:openai-main:mcp:web-research";
  const merged = mergeCapabilityGapSuggestions({
    archivedSuggestions: [{
      id: dismissedId,
      providerId: "openai-main",
      status: "dismissed",
      dismissedAt: now
    }]
  }, suggestions, { now });

  assert.ok(!merged.pendingSuggestions.some((suggestion) => suggestion.id === dismissedId));
  assert.ok(merged.archivedSuggestions.some((suggestion) => suggestion.id === dismissedId));
  assert.ok(merged.pendingSuggestions.some((suggestion) => suggestion.id === "provider:openai-main:skills:review-skill-library"));
});
