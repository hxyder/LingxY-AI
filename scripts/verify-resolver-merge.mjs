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
 *      - topic_hint strong → TRUE (post-C1: SR consulted for topic queries)
 *      - text length ≤ 3        → false (chitchat skip; threshold lowered from 8 in C1)
 *      - none of the above      → true
 *   2. Merge: ambiguous + SR decided required → policy upgrades to required.
 *   3. Merge: ambiguous + SR decided forbidden → policy stays forbidden
 *      (SR confirmed the deterministic default).
 *   4. Merge: ambiguous + no SR stamp → deterministic default (forbidden).
 *   4b. Merge: ambiguous + SR operational failure → optional degraded
 *       fallback, not forbidden.
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

import { readFileSync } from "node:fs";

import {
  resolveToolPolicy,
  resolveDeterministicPolicy,
  shouldConsultSemanticRouter,
  mergeSemanticRouterDecision
} from "../src/service/core/policy/tool-policy-resolver.mjs";
import { extractAllSignals } from "../src/service/core/intent/signals/index.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { createTaskRecord } from "../src/service/core/task-runtime.mjs";
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
  it("gate: topic_hint strong → TRUE (P4-RQ E3 C1: SR now consulted for topic queries)", () => {
    // Pre-C1 this returned false (entity skipped SR for latency).
    // Post-C1 entity is observability-only at the deterministic
    // layer; SR drives topical routing, so the gate must let
    // these queries through.
    const signals = makeSignals("今天北京的天气");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "今天北京的天气"
    }), true);
  });
  it("gate: text ≤ 3 chars → false (chitchat skip, threshold lowered from 8 in C1)", () => {
    const signals = makeSignals("你好");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "你好"
    }), false);
  });
  it("gate: 4-char Chinese topical query → TRUE (was skipped under old 8-char threshold)", () => {
    // "今天天气" = 5 chars; "AI 新闻" = 6. Pre-C1 the 8-char
    // threshold skipped these short topical queries. Post-C1
    // they reach SR.
    const signals = makeSignals("今天天气");
    assert.equal(shouldConsultSemanticRouter({
      signals, contextPacket: {}, text: "今天天气"
    }), true);
  });
  it("gate: typo / unsignaled long text → true (the SR target case)", () => {
    // "今天天汽" = typo for "今天天气"; topic_hint won't match the typo
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

  // ── 4. ambiguous + no SR decision → P5-2 LLM-primary optional baseline ──
  it("merge/ambiguous: no SR decision stamped → P5-2 LLM-primary optional", () => {
    const text = "帮我看看那件事的进展如何";
    const signals = makeSignals(text);
    const policy = resolveToolPolicy({ signals, contextPacket: {}, text });
    // P5-2: when no hard signal fires AND no SR decision is stamped,
    // the deterministic baseline is `optional` (LLM-primary). Pre-P5
    // this was `forbidden`, which silently vetoed external_web_read
    // for ambiguous research-class queries when SR was unavailable.
    assert.equal(policy.web_search_fetch.mode, "optional");
    assert.match(policy.web_search_fetch.reason, /LLM-primary baseline is optional/);
  });

  it("merge/ambiguous: SR timeout still yields optional (P5-2 baseline already optional)", () => {
    const text = "天气怎么样";
    const signals = makeSignals(text);
    const ctx = {
      semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test timeout" }
    };
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    // After P5-2 the deterministic baseline is already optional, so the
    // operational-fallback function is a no-op here. The mode invariant
    // (optional after SR timeout, not forbidden) is what matters.
    assert.equal(policy.web_search_fetch.mode, "optional");
    assert.equal(policy.policy_groups.external_web_read.mode, "optional");
  });

  it("merge/ambiguous: SR no_provider becomes optional degraded fallback", () => {
    const text = "国际新闻";
    const signals = makeSignals(text);
    const ctx = {
      semantic_router_rejection: { kind: "rejection", code: "no_provider", reason: "no chat provider" }
    };
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    assert.equal(policy.web_search_fetch.mode, "optional");
  });

  it("merge/non-ambig: explicit no-search still forbids despite SR timeout", () => {
    const text = "不要联网，国际新闻";
    const ctx = {
      semantic_router_rejection: { kind: "rejection", code: "timeout", reason: "test timeout" }
    };
    const signals = makeSignals(text, ctx);
    const policy = resolveToolPolicy({ signals, contextPacket: ctx, text });
    assert.equal(policy.web_search_fetch.mode, "forbidden");
    assert.match(policy.web_search_fetch.reason, /forbade web browsing/);
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
    // P5-2: when no decision and rejection.code is non-operational
    // (low_confidence ran but below threshold), the deterministic
    // baseline is now `optional`, not `forbidden`. The stage record
    // is what this test really cares about; mode is the secondary
    // assertion and tracks the new LLM-primary baseline.
    assert.equal(spec.tool_policy.web_search_fetch.mode, "optional");
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

  // ── 12. integration: createTaskRecord preserves SR stamp ───────────────
  // Bug #6 was that the submission paths stamped SR decision on a
  // routerEnrichedContext but then passed the bare normalizedContextPacket
  // to createTaskRecord — task-runtime.mjs:182 re-runs createTaskSpec on
  // the bare packet, dropping the stamp. Final task.task_spec / decision_trace
  // had no SEMANTIC_ROUTER stage; merge layer affected only the discarded
  // preflight spec. These tests lock in that createTaskRecord forwards
  // contextPacket verbatim to createTaskSpec.
  it("integration: createTaskRecord with SR decision preserves stage on task.task_spec", () => {
    const contextPacket = {
      semantic_router_decision: { ...SR_REQUIRED }
    };
    const route = { executor: "fast", intent: "qa", intent_tags: [] };
    const task = createTaskRecord({
      route,
      contextPacket,
      userCommand: "帮我看看那件事的进展如何",
      executionMode: "auto"
    });
    const stage = task.task_spec.decision_trace.find((e) => e.stage === STAGES.SEMANTIC_ROUTER);
    assert.ok(stage, "task.task_spec.decision_trace must include SEMANTIC_ROUTER stage when contextPacket carries the stamp");
    assert.equal(stage.output.web_policy, "required");
  });
  it("integration: createTaskRecord with SR decision changes task.task_spec.tool_policy.mode", () => {
    // Ambiguous text + SR required decision → final tool_policy mode
    // should be required (merge layer activated). Without the bug fix
    // this would be the deterministic default (forbidden) because the
    // stamp was being stripped before the spec was built.
    const contextPacket = {
      semantic_router_decision: { ...SR_REQUIRED }
    };
    const route = { executor: "fast", intent: "qa", intent_tags: [] };
    const task = createTaskRecord({
      route,
      contextPacket,
      userCommand: "帮我看看那件事的进展如何",  // ambiguous-gate-passing text
      executionMode: "auto"
    });
    assert.equal(task.task_spec.tool_policy.web_search_fetch.mode, "required",
      "merge layer must produce web=required for ambiguous query + SR=required");
    assert.equal(task.task_spec.tool_policy.policy_groups.external_web_read.mode, "required");
  });
  it("integration: createTaskRecord with SR operational rejection records stage and degrades to optional", () => {
    const contextPacket = {
      semantic_router_rejection: { kind: "rejection", code: "no_provider", reason: "no chat provider" }
    };
    const task = createTaskRecord({
      route: { executor: "fast", intent: "qa", intent_tags: [] },
      contextPacket,
      userCommand: "帮我看看那件事的进展如何",
      executionMode: "auto"
    });
    const stage = task.task_spec.decision_trace.find((e) => e.stage === STAGES.SEMANTIC_ROUTER);
    assert.ok(stage, "decision_trace must include SEMANTIC_ROUTER stage for rejection");
    assert.equal(stage.output.rejected, true);
    assert.equal(stage.output.code, "no_provider");
    // Operational rejection is not user intent. EvidencePolicy keeps
    // hard guards in place but allows optional web so tool_using can
    // decide instead of fast refusing.
    assert.equal(task.task_spec.tool_policy.web_search_fetch.mode, "optional");
    assert.equal(task.task_spec.suggested_executor, "tool_using");
  });

  // ── 13. source-level lock-in: submission paths pass routerEnrichedContext to the task-creation entry ──
  // Belt-and-suspenders against the exact bug pattern: a submission path
  // builds routerEnrichedContext via the preflight, then passes the WRONG
  // packet downstream. Since the integration tests above can't boot a full
  // runtime, we grep the submission source files instead. The task-
  // creation entry was renamed from createTaskRecord → submitTaskWithConversation
  // in Phase C (P6 conversation-as-entity); grep for either to stay
  // resilient to the next rename.
  const submissionFiles = [
    "src/service/core/context-submission.mjs",
    "src/service/core/browser-submission.mjs"
  ];
  const taskCreatePattern = /(?:createTaskRecord|submitTaskWithConversation)\(\{[\s\S]*?contextPacket:\s*([A-Za-z_$][\w$]*)/g;
  for (const filePath of submissionFiles) {
    it(`source lock-in: ${filePath} passes routerEnrichedContext to the task-creation entry`, () => {
      const src = readFileSync(filePath, "utf8");
      const calls = src.match(taskCreatePattern) ?? [];
      assert.ok(calls.length > 0, `${filePath} must call createTaskRecord/submitTaskWithConversation with a contextPacket arg`);
      for (const call of calls) {
        const match = /contextPacket:\s*([A-Za-z_$][\w$]*)/.exec(call);
        const argName = match?.[1];
        assert.equal(argName, "routerEnrichedContext",
          `${filePath} task-creation entry must receive routerEnrichedContext (got ${argName})`);
      }
    });
  }

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
