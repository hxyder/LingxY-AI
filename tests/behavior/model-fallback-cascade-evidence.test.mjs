import test from "node:test";
import assert from "node:assert/strict";

import {
  buildModelFallbackCascadeEvidence,
  buildModelFallbackCascadePolicy,
  validateModelFallbackCascadeEvidence
} from "../../src/shared/model-fallback-cascade-evidence.mjs";
import {
  buildModelRoleRoutingSummary
} from "../../src/service/ai/model-role-routing.mjs";

test("model fallback cascade policy stays disabled by default", () => {
  const policy = buildModelFallbackCascadePolicy({});
  const evidence = buildModelFallbackCascadeEvidence({ policy });

  assert.equal(policy.enabled, false);
  assert.equal(policy.mode, "single_model");
  assert.equal(policy.maxAttempts, 1);
  assert.equal(validateModelFallbackCascadeEvidence(evidence).ok, true);
});

test("enabled fallback cascade requires explicit opt-in budget trace and usage", () => {
  const policy = buildModelFallbackCascadePolicy({
    ai: {
      modelFallbackCascade: {
        enabled: true,
        maxAttempts: 2
      }
    }
  });
  const missing = buildModelFallbackCascadeEvidence({ policy });
  const validation = validateModelFallbackCascadeEvidence(missing);

  assert.equal(policy.mode, "fallback");
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("policy.optIn"));
  assert.ok(validation.errors.includes("policy.maxEstimatedUsd"));
  assert.ok(validation.errors.includes("trace.events.non_empty"));
  assert.ok(validation.errors.includes("usage.measurementKeys"));
});

test("budgeted fallback cascade evidence can pass without enabling ensemble voting", () => {
  const policy = buildModelFallbackCascadePolicy({
    ai: {
      modelFallbackCascade: {
        enabled: true,
        optIn: true,
        mode: "cascade",
        maxAttempts: 3,
        maxEstimatedUsd: 0.05,
        allowedRoles: ["planner", "executor"]
      }
    }
  });
  const evidence = buildModelFallbackCascadeEvidence({
    policy,
    role: "executor",
    taskId: "task_mmx_002",
    decision: {
      primaryModel: "gpt-5.4-mini",
      selectedModel: "claude-sonnet-4-6",
      fallbackUsed: true,
      reason: "primary_timeout"
    },
    trace: {
      events: [{ type: "model_fallback_decision", reason: "primary_timeout" }],
      spanNames: ["model.call.primary", "model.call.fallback"]
    },
    usage: {
      measurementKeys: ["model_role.executor"],
      tokenUsage: { input_tokens: 10, output_tokens: 4 },
      estimatedUsd: 0.0001
    }
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.mode, "cascade");
  assert.deepEqual(policy.allowedRoles, ["planner", "executor"]);
  assert.equal(validateModelFallbackCascadeEvidence(evidence).ok, true);
});

test("ensemble voting remains blocked without eval evidence", () => {
  const policy = buildModelFallbackCascadePolicy({
    ai: {
      modelFallbackCascade: {
        enabled: true,
        optIn: true,
        maxAttempts: 2,
        maxEstimatedUsd: 0.05,
        ensembleVoting: { enabled: true }
      }
    }
  });
  const evidence = buildModelFallbackCascadeEvidence({
    policy,
    trace: { events: [{ type: "model_fallback_decision" }] },
    usage: { measurementKeys: ["model_role.reviewer"] }
  });
  const validation = validateModelFallbackCascadeEvidence(evidence);

  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("qualityGate.evalEvidenceId"));
  assert.ok(validation.errors.includes("qualityGate.status"));
});

test("model role management surface exposes fallback cascade policy", () => {
  const summary = buildModelRoleRoutingSummary({
    config: {
      ai: {
        modelFallbackCascade: {
          enabled: true,
          optIn: true,
          maxAttempts: 2,
          maxEstimatedUsd: 0.03
        }
      }
    }
  });

  assert.equal(summary.managementSurface.fallbackCascade.enabled, true);
  assert.equal(summary.managementSurface.fallbackCascade.maxEstimatedUsd, 0.03);
});
