#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  buildModelFallbackCascadeEvidence,
  buildModelFallbackCascadePolicy,
  validateModelFallbackCascadeEvidence
} from "../src/shared/model-fallback-cascade-evidence.mjs";

const contract = readFileSync("src/shared/model-fallback-cascade-evidence.mjs", "utf8");
const roleRouting = readFileSync("src/service/ai/model-role-routing.mjs", "utf8");
const behavior = readFileSync("tests/behavior/model-fallback-cascade-evidence.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-product-gap-roadmap.md", "utf8");
const docs = readFileSync("docs/architecture/model-fallback-cascade-evidence.md", "utf8");

assert.match(contract, /MODEL_FALLBACK_CASCADE_DEFAULTS/u, "contract must expose safe defaults");
assert.match(contract, /enabled:\s*false/u, "cascade must stay disabled by default");
assert.match(contract, /optIn/u, "enabled fallback/cascade must require opt-in");
assert.match(contract, /maxEstimatedUsd/u, "enabled fallback/cascade must be budget bounded");
assert.match(contract, /trace\.events/u, "enabled fallback/cascade must require trace evidence");
assert.match(contract, /usage\.measurementKeys/u, "enabled fallback/cascade must require usage evidence");
assert.match(contract, /ensembleVoting/u, "ensemble/voting must be represented separately from fallback");
assert.match(contract, /qualityGate\.evalEvidenceId/u, "ensemble/voting must require eval evidence");
assert.match(roleRouting, /fallbackCascade:\s*buildModelFallbackCascadePolicy/u,
  "model role management surface must expose fallback/cascade policy state");
assert.match(behavior, /stays disabled by default/u, "behavior tests must lock disabled default");
assert.match(behavior, /requires explicit opt-in budget trace and usage/u,
  "behavior tests must lock enabled evidence gates");
assert.match(behavior, /ensemble voting remains blocked without eval evidence/u,
  "behavior tests must block voting without eval evidence");
assert.match(roadmap, /MMX-002 Budgeted fallback and cascade evidence \| complete/u,
  "roadmap must mark MMX-002 complete");
assert.match(docs, /No runtime fallback or cascade behavior changes/u,
  "architecture doc must state behavior is unchanged");

const disabled = buildModelFallbackCascadeEvidence({
  policy: buildModelFallbackCascadePolicy({})
});
assert.equal(validateModelFallbackCascadeEvidence(disabled).ok, true);

const enabled = buildModelFallbackCascadeEvidence({
  policy: buildModelFallbackCascadePolicy({
    ai: {
      modelFallbackCascade: {
        enabled: true,
        optIn: true,
        maxAttempts: 2,
        maxEstimatedUsd: 0.05
      }
    }
  }),
  trace: { events: [{ type: "model_fallback_decision" }] },
  usage: { measurementKeys: ["model_role.executor"] }
});
assert.equal(validateModelFallbackCascadeEvidence(enabled).ok, true);

const command = "node scripts/verify-model-fallback-cascade-evidence.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include model fallback/cascade verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include model fallback/cascade verifier");

console.log("[model-fallback-cascade-evidence] MMX-002 fallback/cascade evidence contract verified");
