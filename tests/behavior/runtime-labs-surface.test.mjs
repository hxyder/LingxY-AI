import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRuntimeLabsPatch,
  buildRuntimeLabsSurface
} from "../../src/shared/runtime-labs-surface.mjs";

test("runtime labs surface exposes safe toggles, network OTEL consent, and blocked gates", () => {
  const surface = buildRuntimeLabsSurface({
    config: {
      ai: {
        modelRoles: { enabled: true },
        reviewerLoop: { enabled: false }
      }
    },
    modelRoles: {
      measurementKeys: ["model_role.planner", "model_role.executor"]
    }
  });
  const byId = new Map(surface.capabilities.map((entry) => [entry.id, entry]));

  assert.equal(surface.schemaVersion, 1);
  assert.equal(surface.toggles.modelRoleRouting.enabled, true);
  assert.equal(surface.toggles.finalAnswerReviewer.enabled, false);
  assert.equal(byId.get("model_role_routing")?.userToggle, true);
  assert.equal(byId.get("final_answer_reviewer")?.userToggle, true);
  assert.equal(byId.get("network_otel_export")?.userToggle, true);
  assert.equal(byId.get("network_otel_export")?.status, "available");
  assert.equal(byId.get("multi_candidate_voting")?.status, "evidence_gated");
  assert.equal(byId.get("automatic_sub_agent_delegation")?.enabled, false);
  assert.doesNotMatch(JSON.stringify(surface), /usd|price|cost/i);
});

test("runtime labs patch only writes existing safe framework gates", () => {
  const result = applyRuntimeLabsPatch({
    ai: {
      modelRoles: { planner: { providerId: "openai-main" } },
      reviewerLoop: { budget: { timeoutMs: 8000 } }
    },
    features: { web_search_fetch: { enabled: true } }
  }, {
    modelRoleRouting: { enabled: true },
    finalAnswerReviewer: { enabled: true },
    networkOtel: {
      enabled: true,
      consentAccepted: true,
      endpoint: "https://otel.example.test/v1/traces#frag"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.patch.ai.modelRoles.enabled, true);
  assert.equal(result.patch.ai.reviewerLoop.enabled, true);
  assert.equal(result.patch.observability.networkOtel.enabled, true);
  assert.equal(result.patch.observability.networkOtel.endpoint, "https://otel.example.test/v1/traces");
  assert.equal(result.patch.observability.networkOtel.redaction, "summary_only_no_raw_payloads");
  assert.equal(result.config.ai.modelRoles.planner.providerId, "openai-main");
  assert.equal(result.config.ai.reviewerLoop.budget.timeoutMs, 8000);
  assert.equal(result.config.features.web_search_fetch.enabled, true);
});

test("runtime labs patch rejects blocked capabilities instead of silently enabling them", () => {
  const result = applyRuntimeLabsPatch({}, {
    multi_candidate_voting: { enabled: true }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "capability_not_user_toggleable");
  assert.equal(result.capabilityId, "multi_candidate_voting");
});

test("runtime labs patch rejects unsafe network OTEL endpoints", () => {
  const result = applyRuntimeLabsPatch({}, {
    networkOtel: {
      enabled: true,
      consentAccepted: true,
      endpoint: "file:///tmp/spans.json"
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "networkOtel.endpoint must be http(s) without credentials");
});

test("runtime labs patch does not enable network OTEL without explicit consent", () => {
  const result = applyRuntimeLabsPatch({}, {
    networkOtel: {
      enabled: true,
      endpoint: "https://otel.example.test/v1/traces"
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.observability.networkOtel.enabled, false);
  assert.equal(result.patch.observability.networkOtel.consent.accepted, false);
});
