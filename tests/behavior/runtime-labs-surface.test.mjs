import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRuntimeLabsPatch,
  buildRuntimeLabsSurface
} from "../../src/shared/runtime-labs-surface.mjs";

test("runtime labs surface exposes safe toggles and blocked gates", () => {
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
  assert.equal(byId.get("network_otel_export")?.userToggle, false);
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
    finalAnswerReviewer: { enabled: true }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, {
    ai: {
      modelRoles: { enabled: true },
      reviewerLoop: { enabled: true }
    }
  });
  assert.equal(result.config.ai.modelRoles.planner.providerId, "openai-main");
  assert.equal(result.config.ai.reviewerLoop.budget.timeoutMs, 8000);
  assert.equal(result.config.features.web_search_fetch.enabled, true);
});

test("runtime labs patch rejects blocked capabilities instead of silently enabling them", () => {
  const result = applyRuntimeLabsPatch({}, {
    network_otel_export: { enabled: true }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "capability_not_user_toggleable");
  assert.equal(result.capabilityId, "network_otel_export");
});
