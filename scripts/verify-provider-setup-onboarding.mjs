#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProviderSetupStatus } from "../src/service/ai/onboarding/provider-setup-status.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const setupService = read("src/service/ai/onboarding/provider-setup-status.mjs");
const providerRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
const firstRunWizard = read("src/desktop/console/first_run_wizard/view-model.mjs");
const checklist = read("src/desktop/renderer/capability-checklist.mjs");
const consoleRenderer = read("src/desktop/renderer/console.js");
const behaviorTest = read("tests/behavior/provider-setup-status.test.mjs");
const plan = read("FUNCTION_AUDIT_AND_UPGRADE_PLAN.md");

assert.match(
  setupService,
  /BUILTIN_API_TEMPLATES/u,
  "provider setup should expose common provider templates instead of hardcoding one vendor"
);
assert.match(
  setupService,
  /providerConfigurationReason/u,
  "provider setup should classify missing API key / command recovery reasons"
);
assert.match(
  setupService,
  /does not|never echoes|never echo|secret value/u,
  "provider setup implementation should explicitly avoid echoing provider secrets"
);
assert.match(
  providerRoutes,
  /buildProviderSetupStatus/u,
  "/config/integrations should include provider setup status for first-run recovery"
);
assert.match(
  firstRunWizard,
  /providerSetup/u,
  "first-run wizard should expose provider setup status"
);
assert.match(
  checklist,
  /workspace\.providerSetup/u,
  "system checklist should reuse provider setup status"
);
assert.match(
  consoleRenderer,
  /providerSetup: integrationsP\.providerSetup/u,
  "console refresh should carry provider setup status into workspace state"
);
assert.match(
  behaviorTest,
  /missing API key without leaking secrets/u,
  "behavior tests should prove recovery details are secret-free"
);
assert.match(
  behaviorTest,
  /common provider templates/u,
  "behavior tests should cover common provider template coverage"
);
assert.match(
  plan,
  /FW-013[\s\S]*Provider setup.*PARTIAL|Provider setup\/onboarding recovery/u,
  "upgrade plan should track FW-013 provider setup progress"
);

const fresh = buildProviderSetupStatus({ config: { ai: { customProviders: [] } } });
assert.equal(fresh.status, "action_needed");
assert.ok(fresh.recommendedProviders.length >= 10, "fresh setup should offer broad common provider choices");
assert.ok(fresh.recommendedProviders.some((provider) => provider.id === "ollama" && provider.requiresApiKey === false));

const missingKey = buildProviderSetupStatus({
  config: {
    ai: {
      customProviders: [{
        id: "deepseek",
        name: "DeepSeek",
        kind: "openai",
        baseUrl: "https://api.deepseek.com/v1"
      }]
    }
  }
});
assert.equal(missingKey.status, "recoverable");
assert.equal(missingKey.primaryIssue?.recovery, "api_key_missing");
assert.doesNotMatch(JSON.stringify(missingKey), /sk-|secret-value|"apiKey":/u);

console.log("provider setup onboarding verification passed");
