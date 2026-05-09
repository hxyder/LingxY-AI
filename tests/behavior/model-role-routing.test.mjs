import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelRoleRoutingSummary,
  normalizeModelRoleRoutes,
  resolveModelRoleRoute
} from "../../src/service/ai/model-role-routing.mjs";

test("model role routing exposes planner executor reviewer defaults", () => {
  const summary = buildModelRoleRoutingSummary({ config: {} });
  const byRole = new Map(summary.roles.map((role) => [role.role, role]));

  assert.deepEqual([...byRole.keys()], ["planner", "executor", "reviewer"]);
  assert.equal(byRole.get("planner")?.status, "fallback");
  assert.equal(byRole.get("executor")?.route.taskType, "chat");
  assert.equal(byRole.get("reviewer")?.route.taskType, "reviewer");
  assert.deepEqual(summary.measurementKeys, [
    "model_role.planner",
    "model_role.executor",
    "model_role.reviewer"
  ]);
});

test("model role routing resolves explicit ready providers", () => {
  const config = {
    ai: {
      customProviders: [{
        id: "openai-main",
        name: "OpenAI Main",
        kind: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKeyRef: "secret://provider/openai-main/api-key",
        defaultModel: "gpt-5.4-mini"
      }],
      modelRoles: {
        planner: {
          providerId: "openai-main",
          model: "gpt-5.4-mini",
          reasoningEffort: "low"
        }
      }
    }
  };

  const summary = buildModelRoleRoutingSummary({
    config,
    providers: [{ id: "openai-main", available: true, configured: true, kind: "openai" }]
  });
  const planner = summary.roles.find((role) => role.role === "planner");

  assert.equal(planner?.status, "ready");
  assert.equal(planner?.route.explicit, true);
  assert.equal(planner?.route.model, "gpt-5.4-mini");
  assert.equal(planner?.route.reasoningEffort, "low");
  assert.equal(planner?.provider.providerFamily, "openai");
  assert.equal(summary.counts.ready, 1);
});

test("model role routing falls back to task routing when role route is absent", () => {
  const summary = buildModelRoleRoutingSummary({
    config: {
      ai: {
        customProviders: [{
          id: "deepseek-main",
          name: "DeepSeek",
          kind: "openai",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyConfigured: true,
          defaultModel: "deepseek-v4-flash"
        }],
        taskRouting: {
          planner: {
            providerId: "deepseek-main",
            model: "deepseek-v4-flash"
          }
        }
      }
    }
  });

  const planner = resolveModelRoleRoute("planner", {
    config: {
      ai: {
        customProviders: [{
          id: "deepseek-main",
          name: "DeepSeek",
          kind: "openai",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyConfigured: true,
          defaultModel: "deepseek-v4-flash"
        }],
        taskRouting: {
          planner: {
            providerId: "deepseek-main",
            model: "deepseek-v4-flash"
          }
        }
      }
    }
  });

  assert.equal(summary.roles.find((role) => role.role === "planner")?.route.source, "task_routing_fallback");
  assert.equal(planner?.status, "configured");
  assert.equal(planner?.provider.providerFamily, "deepseek");
});

test("model role routing reports missing or misconfigured providers without secrets", () => {
  const routes = normalizeModelRoleRoutes({
    ai: {
      modelRoles: {
        reviewer: { providerId: "missing-provider", model: "claude-sonnet-4-6" }
      }
    }
  });
  assert.equal(routes.reviewer.providerId, "missing-provider");

  const summary = buildModelRoleRoutingSummary({
    config: {
      ai: {
        customProviders: [{
          id: "anthropic-main",
          name: "Anthropic",
          kind: "anthropic",
          baseUrl: "https://api.anthropic.com",
          defaultModel: "claude-sonnet-4-6"
        }],
        modelRoles: {
          planner: { providerId: "anthropic-main", model: "claude-sonnet-4-6" },
          reviewer: { providerId: "missing-provider", model: "claude-sonnet-4-6" }
        }
      }
    }
  });
  const byRole = new Map(summary.roles.map((role) => [role.role, role]));

  assert.equal(byRole.get("planner")?.status, "misconfigured");
  assert.equal(byRole.get("planner")?.issue, "api_key_missing");
  assert.equal(byRole.get("reviewer")?.status, "missing_provider");
  assert.doesNotMatch(JSON.stringify(summary), /apiKey|sk-test|secret-value/u);
});
