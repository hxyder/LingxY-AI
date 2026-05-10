import test from "node:test";
import assert from "node:assert/strict";

import { buildFirstRunWizardViewModel } from "../../src/desktop/console/first_run_wizard/view-model.mjs";
import { buildCapabilityChecklist } from "../../src/desktop/renderer/capability-checklist.mjs";
import { buildProviderSetupStatus } from "../../src/shared/provider-setup-status.mjs";

test("provider setup status blocks fresh installs with common provider templates", () => {
  const status = buildProviderSetupStatus({
    config: { ai: { customProviders: [], codeCli: { adapters: [] } } }
  });

  assert.equal(status.status, "action_needed");
  assert.equal(status.hasUsableRuntime, false);
  assert.equal(status.nextAction.type, "add_provider");
  assert.ok(status.recommendedProviders.some((provider) => provider.id === "openai"));
  assert.ok(status.recommendedProviders.some((provider) => provider.id === "anthropic"));
  assert.ok(status.recommendedProviders.some((provider) => provider.id === "deepseek"));
  assert.ok(status.recommendedProviders.some((provider) => provider.id === "ollama" && provider.requiresApiKey === false));
});

test("provider setup status reports missing API key without leaking secrets", () => {
  const status = buildProviderSetupStatus({
    config: {
      ai: {
        customProviders: [{
          id: "openai-main",
          name: "OpenAI Main",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-5.4-mini"
        }]
      }
    }
  });

  assert.equal(status.status, "recoverable");
  assert.equal(status.primaryIssue?.recovery, "api_key_missing");
  assert.equal(status.primaryIssue?.action?.type, "edit_provider");
  assert.match(status.primaryIssue?.detail ?? "", /API key|secret/i);
  assert.doesNotMatch(JSON.stringify(status), /sk-test|secret-value|"apiKey":/u);
});

test("provider setup status treats ready runtime as ready and routes wizard to console", () => {
  const status = buildProviderSetupStatus({
    providers: [{
      id: "anthropic-main",
      displayName: "Anthropic",
      kind: "anthropic",
      configured: true,
      available: true
    }]
  });

  assert.equal(status.status, "ready");
  assert.equal(status.nextAction.type, "open_model_routing");

  const wizard = buildFirstRunWizardViewModel({
    providers: [{
      id: "anthropic-main",
      displayName: "Anthropic",
      kind: "anthropic",
      configured: true,
      available: true
    }]
  });

  assert.equal(wizard.nextAction, "open_console");
  assert.equal(wizard.providerSetup.status, "ready");
  assert.equal(wizard.steps.find((step) => step.id === "llm_backend")?.status, "ready");
});

test("capability checklist reuses provider setup recovery detail", () => {
  const setup = buildProviderSetupStatus({
    config: {
      ai: {
        customProviders: [{
          id: "openai-main",
          name: "OpenAI Main",
          kind: "openai",
          baseUrl: "https://api.openai.com/v1"
        }]
      }
    }
  });
  const items = buildCapabilityChecklist({
    workspace: {
      providers: [],
      codeCliAdapters: [],
      mcpServers: [],
      skills: [],
      skillRegistries: [],
      onboarding: { pendingSuggestions: [] },
      providerSetup: setup
    }
  });
  const byId = new Map(items.map((entry) => [entry.id, entry]));

  assert.equal(byId.get("ai-provider")?.status, "recommended");
  assert.equal(byId.get("model-routing")?.status, "action_needed");
  assert.match(byId.get("ai-provider")?.detail ?? "", /API key|secret/i);
});
