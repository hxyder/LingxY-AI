import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProviderOnboardingSuggestions,
  mergeProviderOnboardingSuggestions,
  providerLooksConfigured,
  removeProviderOnboardingSuggestions
} from "../../src/service/ai/onboarding/provider-suggestions.mjs";

test("provider onboarding suggestions require a configured provider", () => {
  assert.equal(providerLooksConfigured({ id: "openai", kind: "openai", baseUrl: "https://example.invalid" }), false);
  assert.equal(providerLooksConfigured({ id: "ollama", kind: "ollama", baseUrl: "http://127.0.0.1:11434" }), true);
  assert.deepEqual(
    buildProviderOnboardingSuggestions({ id: "openai", kind: "openai", baseUrl: "https://example.invalid" }),
    []
  );
});

test("api provider suggestions are stable, secret-free, and capability-oriented", () => {
  const provider = {
    id: "mock-openai",
    name: "Mock OpenAI",
    kind: "openai",
    baseUrl: "https://example.invalid/v1",
    apiKeyRef: "secret://provider/mock-openai/api-key",
    defaultModel: "gpt-5.4-mini"
  };
  const suggestions = buildProviderOnboardingSuggestions(provider, {
    config: {
      ai: {
        mcp: {
          builtinToggles: {
            "mcp-filesystem": { enabled: false },
            "mcp-memory": { enabled: true }
          },
          envOverrides: {
            "mcp-brave-search": { BRAVE_API_KEY: "stored-in-secret-store" }
          }
        }
      }
    },
    env: {}
  });

  assert.ok(suggestions.some((suggestion) => suggestion.id === "provider:mock-openai:mcp:enable-mcp-filesystem"));
  assert.ok(!suggestions.some((suggestion) => suggestion.id === "provider:mock-openai:mcp:enable-mcp-memory"));
  assert.equal(
    suggestions.find((suggestion) => suggestion.id === "provider:mock-openai:mcp:web-research")?.priority,
    "recommended"
  );
  assert.ok(suggestions.some((suggestion) => suggestion.kind === "skills"));
  assert.doesNotMatch(JSON.stringify(suggestions), /stored-in-secret-store|secret:\/\/provider/u);
});

test("code cli provider gets CLI MCP config guidance", () => {
  const suggestions = buildProviderOnboardingSuggestions({
    id: "claude-cli",
    name: "Claude Code",
    kind: "code_cli",
    command: "claude",
    transport: "stream_json_print"
  }, {
    config: {},
    env: {}
  });

  const cliSuggestion = suggestions.find((suggestion) => suggestion.id === "provider:claude-cli:mcp:code-cli-mcp-config");
  assert.equal(cliSuggestion?.priority, "recommended");
  assert.equal(cliSuggestion?.action?.type, "configure_provider_mcp_files");
});

test("merge preserves dismissed suggestions and removes provider-scoped entries", () => {
  const now = "2026-05-04T00:00:00.000Z";
  const dismissed = {
    id: "provider:mock-openai:mcp:web-research",
    providerId: "mock-openai",
    status: "dismissed",
    dismissedAt: now
  };
  const merged = mergeProviderOnboardingSuggestions({
    pendingSuggestions: [dismissed]
  }, [{
    id: "provider:mock-openai:mcp:web-research",
    providerId: "mock-openai",
    status: "pending",
    title: "Add web research"
  }, {
    id: "provider:mock-openai:skills:review-skill-library",
    providerId: "mock-openai",
    status: "pending",
    title: "Review skills"
  }], { now });

  assert.equal(merged.pendingSuggestions.length, 1);
  assert.equal(merged.pendingSuggestions[0].id, "provider:mock-openai:skills:review-skill-library");
  assert.equal(merged.pendingSuggestions[0].createdAt, now);
  assert.equal(merged.archivedSuggestions.length, 1);
  assert.equal(merged.archivedSuggestions[0].id, "provider:mock-openai:mcp:web-research");
  assert.equal(merged.archivedSuggestions[0].lastSuggestedAt, now);

  const removed = removeProviderOnboardingSuggestions(merged, "mock-openai");
  assert.deepEqual(removed.pendingSuggestions, []);
  assert.deepEqual(removed.archivedSuggestions, []);
});
