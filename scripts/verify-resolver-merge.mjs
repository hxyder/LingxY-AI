#!/usr/bin/env node
/**
 * UCA-077 P4-03 (main plan §12.7 / §13.2-A / §17.5.4 / §p4-03-p4-02): tool-policy-resolver
 * + SemanticRouter merge logic.
 *
 * SemanticRouter is suggestion-only. The resolver is still the source of
 * truth. P4-03 wires SR into the resolver so that an upstream async
 * preflight can stamp a decision onto `contextPacket.semantic_router_decision`
 * and have it merged with the deterministic 6-step priority chain.
 *
 * Asserts:
 *   1. Ambiguity gate (`shouldConsultSemanticRouter`):
 *      - file_paths attached    → false (rules win)
 *      - image_paths attached   → false
 *      - explicit_external strong → false
 *      - explicit_entity strong → false
 *      - text length ≤ 8        → false
 *      - none of the above      → true
 *   2. Merge: ambiguous + SR decided required → policy upgrades to required.
 *   3. Merge: ambiguous + SR decided forbidden → policy stays forbidden
 *      (SR confirmed the deterministic default).
 *   4. Merge: ambiguous + SR rejection (no decision stamped) → fall through
 *      to deterministic default (forbidden).
 *   5. NON-ambiguous: file attached + SR decision present → SR IGNORED.
 *      Rules win.
 *   6. NON-ambiguous: explicit_external strong + SR decision present →
 *      SR IGNORED. det.mode=required wins.
 *   7. Hard-fact override: source_scope kind=fact local + SR decision
 *      present → SR IGNORED even on a long ambiguous-looking text.
 *      Defense in depth on top of the LLM's own fact_conflict rejection.
 *   8. Merge result is a fully-expanded policy (group + per-toolId) so
 *      every consumer that reads `tool_policy.policy_groups.external_web_read`
 *      OR `tool_policy.web_search_fetch` sees the same merged mode.
 *   9. End-to-end through createTaskSpec: stamping
 *      contextPacket.semantic_router_decision flows into the spec's
 *      tool_policy AND records a SEMANTIC_ROUTER DecisionTrace stage.
 *  10. End-to-end: stamping a rejection records the SEMANTIC_ROUTER stage
 *      with rejected:true.
 *
 * Run: node scripts/verify-resolver-merge.mjs
 */

import assert from "node:assert/strict";

import {
  resolveToolPolicy,
  resolveDeterministicPolicy,
  shouldConsultSemanticRouter,
  mergeSemanticRouterDecision
} from "../src/service/core/policy/tool-policy-resolver.mjs";
import { extractAllSignals } from "../src/service/core/intent/signals/index.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { STAGES } from "../src/service/core/contracts/decision-trace.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
    fail += 1;
  }
}

// Common SR decision (well-formed, confidence 0.85).
const SR_REQUIRED = Object.freeze({
  source_scope: "external_world",
  web_policy: "required",
  output_kind: "conversation",
  artifact_required: false,
  executor: "tool_using",
  confidence: 0.85,
  reason: "User question is a high-freshness external query."
});

const SR_FORBIDDEN = Object.freeze({
  ...SR_REQUIRED,
  web_policy: "forbidden",
  reason: "User question is local-only chitchat."
});

function makeSignals(text, contextPacket = {}) {
  return extractAllSignals(text, contextPacket).signals;
}

async function run() {
  // ── 1. shouldConsultSemanticRouter gate ────────────────────────────────
  it("gate: file_paths attached → false (deterministic wins)", () => {
    const signals = makeSignals("查一下这件事", { file_paths: ["a.txt"] });
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: { file_paths: ["a.txt"] }, text: "查一下这件事"
    }), false);
  });
  it("gate: image_paths attached → false", () => {
    const signals = makeSignals("这是什么", { image_paths: ["a.png"] });
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: { image_paths: ["a.png"] }, text: "这是什么"
    }), false);
  });
  it("gate: explicit_external strong → false", () => {
    const signals = makeSignals("查一下网上最近的开源项目");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "查一下网上最近的开源项目"
    }), false);
  });
  it("gate: explicit_entity strong → false", () => {
    const signals = makeSignals("今天北京的天气");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "今天北京的天气"
    }), false);
  });
  it("gate: text ≤ 8 chars → false", () => {
    const signals = makeSignals("你好");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "你好"
    }), false);
  });
  it("gate: typo / unsignaled long text → true (the SR target case)", () => {
    // "今天天汽" = typo for "今天天气"; explicit_entity won't match the typo
    // but it's a clear weather intent. Add another long enough phrase.
    const signals = makeSignals("帮我看看那件事的进展如何");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "帮我看看那件事的进展如何"
    }), true);
  });

  // ── 2. merge: ambiguous + SR required → upgrade ────────────────────────
  it("merge/ambiguous: SR required upgrades the default-forbidden baseline", () => {
    const text = "帮我看看那件事的进展如何";
    const signals = makeSignals(text);
    const ctx = { semantic_router_decision: { ...SR_REQUIRED } };
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    assert.equal(policy.web_search_fetch.mode, "required");
    assert.equal(policy.policy_groups.external_web_read.mode, "required");
    assert.match(policy.web_search_fetch.reason, /Semantic router suggested required/);
    assert.match(policy.web_search_fetch.reason, /confidence=0\.85/);
  });

  // ── 3. merge: ambiguous + SR forbidden confirms baseline ───────────────
  it("merge/ambiguous: SR forbidden confirms the deterministic default", () => {
    const text = "帮我看看那件事的进展如何";
    const signals = makeSignals(text);
    const ctx = { semantic_router_decision: { ...SR_FORBIDDEN } };
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    assert.equal(policy.web_search_fetch.mode, "forbidden");
  });

  // ── 4. ambiguous + no SR decision → deterministic default ──────────────
  it("merge/ambiguous: no SR decision stamped → deterministic forbidden", () => {
    const text = "帮我看看那件事的进展如何";
    const signals = makeSignals(text);
    const policy = resolveToolPolicy({ signals, contextPacket: {}, text });
    assert.equal(policy.web_search_fetch.mode, "forbidden");
    assert.match(policy.web_search_fetch.reason, /No external-data signal|chitchat/);
  });

  // ── 5. non-ambiguous: file attached + SR present → SR ignored ──────────
  it("merge/non-ambig (files): SR decision IGNORED when files attached", () => {
    const text = "帮我看看那件事的进展如何";
    const ctx = { file_paths: ["a.docx"], semantic_router_decision: { ...SR_REQUIRED } };
    const signals = makeSignals(text, ctx);
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    // Files attached → source_scope=uploaded_files → step 3 forbidden.
    // SR's required suggestion must NOT win.
    assert.equal(policy.web_search_fetch.mode, "forbidden");
    assert.ok(!policy.web_search_fetch.reason.includes("Semantic router"),
      "deterministic forbidden reason must surface, not the SR override");
  });

  // ── 6. non-ambiguous: strong explicit_external + SR present → SR ignored ──
  it("merge/non-ambig (strong rule): explicit_external required wins", () => {
    const text = "查一下网上最近有没有开源项目可以参考";
    const ctx = { semantic_router_decision: { ...SR_FORBIDDEN } };
    const signals = makeSignals(text, ctx);
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    // Deterministic step 1 → required. SR's forbidden suggestion ignored.
    assert.equal(policy.web_search_fetch.mode, "required");
  });

  // ── 7. hard-fact override defense in depth ────────────────────────────
  it("merge: source_scope kind=fact local + SR required → SR IGNORED", () => {
    // Fabricate a signals bundle with a fact-kind local source_scope
    // (e.g., file present). Even if the ambiguity gate slipped (it won't
    // here because file_paths is also set), the fact-conflict guard
    // would still block the upgrade. Test belt-and-suspenders by
    // bypassing the gate via a synthesised signal bundle.
    const signals = {
      source_scope: {
        name: "source_scope",
        matched: true,
        strength: "strong",
        kind: "fact",
        evidence: [],
        hint: { value: "uploaded_files" }
      }
    };
    const ctx = { semantic_router_decision: { ...SR_REQUIRED } };
    const detPolicy = resolveDeterministicPolicy({ signals, contextPacket: ctx, text: "long enough text..." });
    // Verify the hard-fact branch fires in deterministic resolution.
    assert.equal(detPolicy.web_search_fetch.mode, "forbidden");
    // Now run merge with the gate disabled (no file_paths in ctx, but
    // text length > 8 — so the gate passes, leaving only the
    // hard-fact-override branch in mergeSemanticRouterDecision to block.
    const merged = mergeSemanticRouterDecision({
      deterministicPolicy: detPolicy, signals, contextPacket: ctx, text: "long enough text..."
    });
    assert.equal(merged.web_search_fetch.mode, "forbidden");
  });

  // ── 8. merged policy carries group + per-toolId expansion ─────────────
  it("merge: result is fully expanded (policy_groups + every toolId)", () => {
    const text = "帮我看看那件事的进展如何";
    const signals = makeSignals(text);
    const ctx = { semantic_router_decision: { ...SR_REQUIRED } };
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    assert.equal(policy.policy_groups.external_web_read.mode, "required");
    assert.equal(policy.web_search.mode, "required");
    assert.equal(policy.web_search_fetch.mode, "required");
    assert.equal(policy.fetch_url_content.mode, "required");
  });

  // ── 9. e2e: createTaskSpec records SEMANTIC_ROUTER stage ──────────────
  it("e2e: stamped SR decision flows through createTaskSpec + records stage", () => {
    const ctx = {
      semantic_router_decision: { ...SR_REQUIRED }
    };
    const spec = createTaskSpec("帮我看看那件事的进展如何", ctx, {});
    assert.equal(spec.tool_policy.web_search_fetch.mode, "required");
    const stage = spec.decision_trace.find((e) => e.stage === STAGES.SEMANTIC_ROUTER);
    assert.ok(stage, "decision_trace must include a SEMANTIC_ROUTER stage entry");
    assert.equal(stage.output.web_policy, "required");
    assert.equal(stage.output.confidence, 0.85);
  });

  // ── 10. e2e: stamped SR rejection records rejected:true on the stage ──
  it("e2e: stamped SR rejection records SEMANTIC_ROUTER stage with rejected:true", () => {
    const ctx = {
      semantic_router_rejection: { kind: "rejection", code: "low_confidence", reason: "confidence 0.42 below threshold" }
    };
    const spec = createTaskSpec("帮我看看那件事的进展如何", ctx, {});
    // No decision → policy falls back to deterministic forbidden.
    assert.equal(spec.tool_policy.web_search_fetch.mode, "forbidden");
    const stage = spec.decision_trace.find((e) => e.stage === STAGES.SEMANTIC_ROUTER);
    assert.ok(stage, "decision_trace must include a SEMANTIC_ROUTER stage even on rejection");
    assert.equal(stage.output.rejected, true);
    assert.equal(stage.output.code, "low_confidence");
  });

  // ── 11. e2e: no SR stamp → no SEMANTIC_ROUTER stage entry ──────────────
  it("e2e: absent SR fields leave decision_trace clean (no spurious stage)", () => {
    const spec = createTaskSpec("帮我看看那件事的进展如何", {}, {});
    const stage = spec.decision_trace.find((e) => e.stage === STAGES.SEMANTIC_ROUTER);
    assert.equal(stage, undefined,
      "no semantic-router stage should appear when no preflight ran");
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
