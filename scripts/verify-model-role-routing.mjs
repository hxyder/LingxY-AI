#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  MODEL_ROLES,
  buildModelRoleManagementSurface,
  buildModelRoleRoutingSummary,
  resolveModelRoleRoute
} from "../src/service/ai/model-role-routing.mjs";

const moduleSource = readFileSync("src/service/ai/model-role-routing.mjs", "utf8");
const providerResolver = readFileSync("src/service/executors/shared/provider-resolver.mjs", "utf8");
const llmUsage = readFileSync("src/service/core/task-runtime/llm-usage.mjs", "utf8");
const toolUsingPlanner = readFileSync("src/service/executors/tool_using/agent-loop.mjs", "utf8");
const finalComposer = readFileSync("src/service/executors/tool_using/final-composer.mjs", "utf8");
const agenticPlanner = readFileSync("src/service/executors/agentic/planner.mjs", "utf8");
const configRoutes = readFileSync("src/service/core/http-routes/config-provider-routes.mjs", "utf8");
const consoleHtml = readFileSync("src/desktop/renderer/console.html", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const behavior = readFileSync("tests/behavior/model-role-routing.test.mjs", "utf8");

assert.deepEqual(MODEL_ROLES, ["planner", "executor", "reviewer", "fast"], "planner/executor/reviewer/fast roles must be first-class");
assert.match(moduleSource, /MODEL_ROLE_DEFAULTS/u, "role defaults must be explicit");
assert.match(moduleSource, /fast[\s\S]*taskType:\s*"chat"/u, "fast role must be visible while preserving the current fast executor chat route");
assert.match(moduleSource, /measurementKeys/u, "model role summary must expose measurement keys");
assert.match(moduleSource, /task_routing_fallback/u, "roles must inherit existing task routing while no explicit role route exists");
assert.match(moduleSource, /isModelRoleCallSiteRoutingEnabled/u, "role routing must expose explicit call-site feature flag gate");
assert.match(moduleSource, /buildModelRoleManagementSurface/u, "role routing must expose a user-visible management surface contract");
assert.match(moduleSource, /featureFlag/u, "management surface must expose feature flag state");
assert.match(moduleSource, /llm_usage/u, "management surface must expose usage/cost evidence");
assert.match(moduleSource, /live_provider_acceptance/u, "management surface must expose live provider test actions");
assert.match(moduleSource, /LINGXY_MODEL_ROLE_TEST_OK/u, "management surface must define the safe short live-test prompt");
assert.match(providerResolver, /resolveProviderForModelRole/u, "provider resolver must expose role-aware call-site resolver");
assert.match(providerResolver, /modelRoleRoutingEnabled/u, "role-aware resolver must annotate provider decisions");
assert.match(providerResolver, /describeResolvedProvider[\s\S]*model_role/u, "provider descriptor must expose model role decision fields");
assert.match(llmUsage, /model_role/u, "llm usage payload must record model role decisions");
assert.match(toolUsingPlanner, /resolveProviderForModelRole\("planner",\s*"chat"/u, "tool_using planner must use planner role call site");
assert.match(agenticPlanner, /resolveProviderForModelRole\("planner",\s*"chat"/u, "agentic planner must use planner role call site");
assert.match(finalComposer, /resolveProviderForModelRole\("executor",\s*"chat"/u, "final composer must use executor role call site");
assert.match(configRoutes, /buildModelRoleRoutingSummary/u, "integrations route must expose model role summary");
assert.match(configRoutes, /modelRoles/u, "integrations payload must include modelRoles");
assert.match(configRoutes, /listRuntimeAiProviderStatus/u, "integrations route must merge runtime provider status");
assert.match(configRoutes, /providers:\s*providerStatuses/u, "model roles must receive runtime provider readiness");
assert.match(consoleHtml, /modelRoleManagementSurface/u, "Console routing settings must mount model role management surface");
assert.match(consoleJs, /renderModelRoleManagementSurface/u, "Console renderer must render model role management surface");
assert.match(consoleJs, /state\.workspace\.modelRoles/u, "Console must consume modelRoles from the service payload");
assert.match(consoleJs, /data-model-role-action/u, "Console management actions must be typed UI actions");
assert.match(behavior, /model role routing exposes planner executor reviewer fast defaults/u, "behavior tests must cover default roles");
assert.match(behavior, /model role management surface exposes health cost fallback feature flag and test actions/u,
  "behavior tests must cover management surface details");
assert.match(behavior, /without secrets/u, "behavior tests must cover secret-free diagnostics");
assert.match(behavior, /stays disabled until explicit feature flag/u, "behavior tests must cover disabled default");
assert.match(behavior, /binds planner role only when enabled/u, "behavior tests must cover real call-site resolver binding");
assert.match(behavior, /usagePayload\.model_role/u, "behavior tests must prove llm_usage carries role decisions");

const summary = buildModelRoleRoutingSummary({
  config: {
    ai: {
      customProviders: [{
        id: "openai-main",
        kind: "openai",
        name: "OpenAI",
        apiKeyConfigured: true,
        defaultModel: "gpt-5.4-mini"
      }],
      modelRoles: {
        executor: {
          providerId: "openai-main",
          model: "gpt-5.4-mini"
        }
      }
    }
  },
  providers: [{ id: "openai-main", kind: "openai", available: true, configured: true }]
});

const executor = resolveModelRoleRoute("executor", {
  config: {
    ai: {
      customProviders: [{
        id: "openai-main",
        kind: "openai",
        name: "OpenAI",
        apiKeyConfigured: true,
        defaultModel: "gpt-5.4-mini"
      }],
      modelRoles: {
        executor: {
          providerId: "openai-main",
          model: "gpt-5.4-mini"
        }
      }
    }
  },
  providers: [{ id: "openai-main", kind: "openai", available: true, configured: true }]
});

assert.equal(summary.roles.length, 4);
assert.equal(summary.measurementKeys.includes("model_role.executor"), true);
assert.equal(summary.measurementKeys.includes("model_role.fast"), true);
assert.equal(executor?.status, "ready");
assert.doesNotMatch(JSON.stringify(summary), /apiKey|secret-value|sk-test/u);
const surface = buildModelRoleManagementSurface({ config: { ai: { modelRoles: { enabled: true } } }, routingSummary: summary });
assert.equal(surface.roles.some((role) => role.role === "fast"), true);
assert.equal(surface.featureFlag.enabled, true);
assert.equal(surface.testActions.some((action) => action.id === "model_role.fast.test"), true);
assert.equal(surface.testActions.some((action) => action.prompt === "Reply with exactly: LINGXY_MODEL_ROLE_TEST_OK"), true);

const command = "node scripts/verify-model-role-routing.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include model role routing verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include model role routing verifier");

console.log("[verify-model-role-routing] FW-025 model role routing contract OK");
