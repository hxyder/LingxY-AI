#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const capabilityService = read("src/service/ai/onboarding/capability-gap-suggestions.mjs");
const providerRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
const conversationRoutes = read("src/service/core/http-routes/note-project-conversation-routes.mjs");
const behaviorTest = read("tests/behavior/capability-gap-suggestions.test.mjs");

assert.match(
  capabilityService,
  /buildProviderOnboardingSuggestions/u,
  "capability gap suggestions should reuse provider onboarding rules instead of duplicating prompts"
);
assert.match(
  capabilityService,
  /conversationModelOverride/u,
  "capability gap suggestions should understand conversation model overrides"
);
assert.match(
  capabilityService,
  /paths/u,
  "capability gap suggestions should receive runtime integration paths"
);
assert.doesNotMatch(
  capabilityService,
  /岗位|招聘|简历|天气|新闻|论文|市场|竞品/u,
  "capability gap suggestions must stay capability-oriented and avoid topic-specific patches"
);

assert.match(
  providerRoutes,
  /integrationPathsForRuntime/u,
  "provider routes should pass runtime integration paths to capability suggestions"
);
assert.match(
  providerRoutes,
  /buildCapabilityGapSuggestions/u,
  "provider save and integration config should use capability gap suggestions"
);
assert.match(
  providerRoutes,
  /mergeCapabilityGapSuggestions/u,
  "integration config should merge derived suggestions with dismissed/completed state"
);
assert.match(
  conversationRoutes,
  /buildCapabilityGapSuggestions/u,
  "conversation model switching should return capability suggestions for the selected provider"
);
assert.match(
  conversationRoutes,
  /integrationPathsForRuntime/u,
  "conversation model switching should pass runtime integration paths"
);
assert.match(
  conversationRoutes,
  /mergeCapabilityGapSuggestions/u,
  "conversation model switching should respect dismissed/completed onboarding state"
);
assert.match(
  behaviorTest,
  /doesNotMatch\(JSON\.stringify\(suggestions\), \/sk-test-openai\|apiKey\/u\)/u,
  "behavior tests should prove suggestions do not leak provider secrets"
);
assert.match(
  behaviorTest,
  /conversation_model_override/u,
  "behavior tests should cover model-switch-triggered suggestions"
);

console.log("capability gap suggestions verification passed");
