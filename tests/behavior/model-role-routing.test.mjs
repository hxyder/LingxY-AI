import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildModelRoleManagementSurface,
  buildModelRoleRoutingSummary,
  isModelRoleCallSiteRoutingEnabled,
  normalizeModelRoleRoutes,
  resolveModelRoleRoute
} from "../../src/service/ai/model-role-routing.mjs";
import {
  describeResolvedProvider,
  resolveProviderForModelRole
} from "../../src/service/executors/shared/provider-resolver.mjs";
import { buildLlmUsagePayload } from "../../src/service/core/task-runtime/llm-usage.mjs";

test("model role routing exposes planner executor reviewer fast defaults", () => {
  const summary = buildModelRoleRoutingSummary({ config: {} });
  const byRole = new Map(summary.roles.map((role) => [role.role, role]));

  assert.deepEqual([...byRole.keys()], ["planner", "executor", "reviewer", "fast"]);
  assert.equal(byRole.get("planner")?.status, "fallback");
  assert.equal(byRole.get("executor")?.route.taskType, "chat");
  assert.equal(byRole.get("reviewer")?.route.taskType, "reviewer");
  assert.equal(byRole.get("fast")?.route.taskType, "chat");
  assert.deepEqual(summary.measurementKeys, [
    "model_role.planner",
    "model_role.executor",
    "model_role.reviewer",
    "model_role.fast"
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

test("model role management surface exposes health usage fallback feature flag and test actions", () => {
  const summary = buildModelRoleRoutingSummary({
    config: {
      ai: {
        modelRoles: { enabled: true },
        customProviders: [{
          id: "openai-main",
          name: "OpenAI Main",
          kind: "openai",
          apiKeyConfigured: true,
          defaultModel: "gpt-5.4-mini"
        }],
        taskRouting: {
          chat: { providerId: "openai-main", model: "gpt-5.4-mini" }
        }
      }
    }
  });
  const surface = buildModelRoleManagementSurface({ routingSummary: summary, config: { ai: { modelRoles: { enabled: true } } } });
  const byRole = new Map(surface.roles.map((role) => [role.role, role]));

  assert.equal(surface.featureFlag.enabled, true);
  assert.equal(surface.featureFlag.source, "ai.modelRoles.enabled");
  assert.deepEqual([...byRole.keys()], ["planner", "executor", "reviewer", "fast"]);
  assert.equal(byRole.get("fast")?.health.ok, true);
  assert.equal(byRole.get("fast")?.fallback.source, "task_routing_fallback");
  assert.equal(byRole.get("fast")?.usage.usageEvent, "llm_usage");
  assert.equal(byRole.get("fast")?.usage.measurementKey, "model_role.fast");
  assert.equal(surface.testActions.some((action) => action.id === "model_role.fast.test"), true);
  assert.equal(surface.testActions.some((action) => action.prompt === "Reply with exactly: LINGXY_MODEL_ROLE_TEST_OK"), true);
  assert.doesNotMatch(JSON.stringify(surface), /apiKey|sk-test|secret-value/u);
});

test("model role call-site routing stays disabled until explicit feature flag", () => {
  assert.equal(isModelRoleCallSiteRoutingEnabled({ ai: {} }), false);
  assert.equal(isModelRoleCallSiteRoutingEnabled({
    ai: {
      modelRoleRouting: { enabled: true }
    }
  }), true);
});

test("model role call-site resolver binds planner role only when enabled", async () => {
  const previousConfigPath = process.env.UCA_CONFIG_PATH;
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-model-role-"));
  const configPath = path.join(dir, "runtime.json");
  try {
    await writeFile(configPath, JSON.stringify({
      ai: {
        customProviders: [{
          id: "local-planner",
          name: "Local Planner",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          defaultModel: "planner-model"
        }, {
          id: "local-chat",
          name: "Local Chat",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          defaultModel: "chat-model"
        }],
        taskRouting: {
          chat: { providerId: "local-chat", model: "chat-model" }
        },
        modelRoles: {
          planner: {
            providerId: "local-planner",
            taskType: "planner",
            model: "planner-model"
          }
        }
      }
    }), "utf8");
    process.env.UCA_CONFIG_PATH = configPath;

    const disabled = resolveProviderForModelRole("planner", "chat", {}, {});
    assert.equal(disabled.configId, "local-chat");
    assert.equal(disabled.model, "chat-model");
    assert.equal(disabled.modelRoleRoutingEnabled, false);

    await writeFile(configPath, JSON.stringify({
      ai: {
        customProviders: [{
          id: "local-planner",
          name: "Local Planner",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          defaultModel: "planner-model"
        }, {
          id: "local-chat",
          name: "Local Chat",
          kind: "ollama",
          baseUrl: "http://127.0.0.1:11434",
          defaultModel: "chat-model"
        }],
        taskRouting: {
          chat: { providerId: "local-chat", model: "chat-model" }
        },
        modelRoles: {
          enabled: true,
          planner: {
            providerId: "local-planner",
            taskType: "planner",
            model: "planner-model"
          }
        }
      }
    }), "utf8");

    const enabled = resolveProviderForModelRole("planner", "chat", {}, {});
    assert.equal(enabled.configId, "local-planner");
    assert.equal(enabled.model, "planner-model");
    assert.equal(enabled.modelRole, "planner");
    assert.equal(enabled.modelRoleRoutingEnabled, true);
    assert.equal(enabled.modelRoleTaskType, "planner");
    assert.equal(describeResolvedProvider(enabled).model_role, "planner");
    const usagePayload = buildLlmUsagePayload({
      callSite: "tool_using.planner",
      usage: { input_tokens: 10, output_tokens: 4 },
      provider: describeResolvedProvider(enabled)
    });
    assert.equal(usagePayload.model_role, "planner");
    assert.equal(usagePayload.model_role_routing_enabled, true);
    assert.equal(usagePayload.model_role_task_type, "planner");
  } finally {
    if (previousConfigPath == null) delete process.env.UCA_CONFIG_PATH;
    else process.env.UCA_CONFIG_PATH = previousConfigPath;
    await rm(dir, { recursive: true, force: true });
  }
});
