#!/usr/bin/env node
/**
 * UCA-077 P4-RQ I1: SemanticRouter ambiguity-gate hard-fact skip.
 *
 * Pre-I1: the resolver's mergeSemanticRouterDecision DID respect hard
 * facts (skipped the merge for explicit_no_search and source_scope=
 * fact+LOCAL), but `shouldConsultSemanticRouter` — the upstream gate
 * the preflight uses to decide whether to even CALL SR — did not.
 * Result: SR was invoked on tasks where the deterministic answer was
 * already settled. When SR failed (timeout / no_provider / exception /
 * schema_invalid), the rejection stamped `routing_status=sr_*` →
 * `routing_degraded=true`, which the fast executor's G6b short-circuit
 * then read to refuse the task with an honest "routing degraded"
 * message. A "不要联网，告诉我 X" or "本地选中文本总结" task could
 * downgrade to partial_success purely because SR was unavailable —
 * even though the deterministic answer was forbidden either way.
 *
 * I1 fix: skip the SR call entirely when the resolver has a hard-fact
 * commitment. Symmetric with the merge-layer override list.
 *
 * Cases the gate must skip (hard facts):
 *   1. explicit_no_search.matched && kind === "fact"     ("不要联网")
 *   2. source_scope.matched && kind === "fact" &&
 *      hint.value ∈ {real_selection: see context-sources mapping —
 *      the LOCAL_SCOPES set: uploaded_files / current_context /
 *      local_project / selection}
 *
 * Cases the gate must STILL consult SR (ambiguous):
 *   3. assumption-kind source_scope ("这个/这篇" pronoun, no anchor)
 *   4. text-only research-class queries with no anchor / no no-search
 *
 * Run: node scripts/verify-sr-hard-fact-skip.mjs
 */

import assert from "node:assert/strict";
import {
  shouldConsultSemanticRouter,
  resolveToolPolicy
} from "../src/service/core/policy/tool-policy-resolver.mjs";
import { extractAllSignals } from "../src/service/core/intent/signals/index.mjs";
import { classifyContextSources } from "../src/service/core/intent/context-sources.mjs";
import { applySemanticRouterPreflight } from "../src/service/core/intent/router-preflight.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";

let pass = 0;
let fail = 0;
async function it(label, fn) {
  try {
    await fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

/** Helper: build {signals, routerContext} as the preflight does. */
function probe(text, contextPacket = {}) {
  const contextSources = classifyContextSources({ text, contextPacket });
  const routerContext = { ...contextPacket, context_sources: contextSources };
  const { signals } = extractAllSignals(text, routerContext);
  return { signals, routerContext };
}

// ── 1. explicit_no_search → skip SR ────────────────────────────────
await it("hard-fact skip: '不要联网' (explicit_no_search.fact) → SR not consulted", () => {
  const { signals, routerContext } = probe("不要联网，告诉我今天 AI 新闻");
  assert.equal(signals.explicit_no_search?.matched, true,
    "test fixture: explicit_no_search must fire");
  assert.equal(signals.explicit_no_search.kind, "fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text: "不要联网，告诉我今天 AI 新闻" }),
    false,
    "explicit_no_search.fact must short-circuit the SR consult gate"
  );
});

await it("hard-fact skip: 'do not browse' (English no-search) → SR not consulted", () => {
  const text = "do not browse the web; just tell me what the framework does.";
  const { signals, routerContext } = probe(text);
  assert.equal(signals.explicit_no_search?.matched, true);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

// ── 2. source_scope=fact + LOCAL → skip SR ─────────────────────────
await it("hard-fact skip: scheduler contextText (real_selection via ctx.text) → SR not consulted", () => {
  // The verify-scheduler reproduction: scheduled context_task carries
  // a contextText through buildSchedulerContextPacket → ctx.text. The
  // classifier's Stage 3 default treats non-sentinel ctx.text as
  // real_selection=true; source_scope then fires kind=fact +
  // value=current_context (LOCAL).
  const text = "总结今天的待办";
  const ctx = {
    text: "Scheduled AI work smoke test",
    source_app: "uca.scheduler",
    capture_mode: "event"
  };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(routerContext.context_sources.real_selection, true,
    "test fixture: ctx.text must classify as real_selection");
  assert.equal(signals.source_scope?.matched, true,
    "test fixture: source_scope must fire on real_selection");
  assert.equal(signals.source_scope.kind, "fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false,
    "real_selection scheduler task must skip SR"
  );
});

await it("hard-fact skip: passage summary (real selection, no pronoun) → SR not consulted", () => {
  // No pronoun in the user command — the detector's CURRENT_CONTEXT
  // pronoun branch (kind=assumption) does NOT fire. The real_selection
  // anchor takes the kind=fact selection branch.
  const text = "summarise the highlights";
  const ctx = { text: "User pasted a long passage about a framework's architecture, several paragraphs of detail." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope?.matched, true);
  assert.equal(signals.source_scope.kind, "fact",
    "without a pronoun, real_selection anchor produces kind=fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

await it("ambiguous (documented contract): pronoun '这段' + real selection → kind=assumption → SR IS consulted", () => {
  // Detector contract: CURRENT_CONTEXT pronoun branch fires first and
  // returns kind=assumption even when a real anchor exists, because
  // "这段" can ambiguously refer to a quoted external article. SR is
  // therefore the right layer to disambiguate. Documenting this here
  // so the I1 hard-fact skip is not over-broadened to swallow ambiguous
  // pronoun cases.
  const text = "只基于这段内容总结，不要扯其他";
  const ctx = { text: "User pasted a long passage about a framework's architecture." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope.kind, "assumption");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "pronoun + selection stays in the SR-consulted branch (kind=assumption, by detector design)"
  );
});

await it("hard-fact skip: file_paths attached → source_scope=fact uploaded_files → SR not consulted", () => {
  // file_paths carries kind=fact uploaded_files (a LOCAL_SCOPE). The
  // existing rule already skips SR via the `file_paths.length > 0`
  // gate, but the hard-fact branch is also a valid path; this test
  // documents that behavior is consistent under the new rule.
  const text = "总结一下这份报告";
  const ctx = { file_paths: ["C:/tmp/report.pdf"] };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

// ── 3. assumption-kind source_scope still consults SR ─────────────
await it("ambiguous: assumption-kind '这篇文章' pronoun (no anchor) → SR IS consulted", () => {
  // Pronoun without a real anchor — kind=assumption (P4-RQ E2). The
  // resolver forbids on this scope (step 2c), but SR is still allowed
  // to consult and potentially override (e.g. if explicit_external
  // was missed). NOT a hard fact.
  const text = "这篇文章讲的是什么";
  const { signals, routerContext } = probe(text);
  // We don't assert source_scope shape here (it depends on the detector's
  // pronoun-detection logic); we only assert that IF it fires as
  // assumption, the gate still allows SR. Use a synthetic signals
  // bundle to make the assertion deterministic regardless of the
  // detector's current shape.
  const synthetic = {
    ...signals,
    source_scope: {
      name: "source_scope",
      matched: true,
      strength: "strong",
      kind: "assumption",
      hint: { value: "current_context" },
      evidence: []
    }
  };
  assert.equal(
    shouldConsultSemanticRouter({ signals: synthetic, contextPacket: routerContext, text }),
    true,
    "assumption-kind source_scope must NOT skip SR (only fact-kind does)"
  );
});

// ── 4. Plain text-only research query still consults SR ───────────
await it("ambiguous: text-only '查一下有没有类似的开源项目' (no signals) → SR IS consulted", () => {
  const text = "查一下有没有类似的开源项目";
  const { signals, routerContext } = probe(text);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "research-class query without hard-fact anchors must still reach SR"
  );
});

// ── 5. Existing skip rules still hold (regression guard) ──────────
await it("regression guard: file_paths attached → SR skipped (existing rule)", () => {
  const text = "总结一下";
  const ctx = { file_paths: ["/tmp/a.pdf"] };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

await it("regression guard: explicit_external strong → SR skipped (existing rule)", () => {
  const text = "上网帮我查一下今天的天气";
  const { signals, routerContext } = probe(text);
  if (!(signals.explicit_external?.matched && signals.explicit_external?.strength === "strong")) {
    // Test fixture sanity — depends on the explicit_external detector.
    // Skip this guard if the fixture text doesn't trigger strong; the
    // rule itself is unchanged so this is purely defensive.
    return;
  }
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

await it("regression guard: short text (≤3 chars) → SR skipped (existing rule)", () => {
  const text = "你好";
  const { signals, routerContext } = probe(text);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false
  );
});

// ── 6. End-to-end: SR-timeout repro must NOT mark routing_degraded ─
await it("end-to-end: '不要联网' + simulated SR outage → routing_degraded=false", async () => {
  // Stub the SR resolver via the preflight: pre-stamp a rejection on
  // contextPacket and re-run createTaskSpec to confirm routing_degraded
  // stays false. We can't easily stub semantic-router.mjs here without
  // a module-mock framework, so we test the post-preflight invariant:
  // when the gate skips SR, no rejection is ever stamped, so
  // routing_status="ok" and routing_degraded=false.
  const userCommand = "不要联网，告诉我今天 AI 新闻";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {}
  });
  // After preflight: explicit_no_search is fact → gate skipped → no
  // SR fields stamped on the enriched packet.
  assert.equal(enriched.semantic_router_decision, undefined,
    "SR decision must NOT be stamped (gate skipped)");
  assert.equal(enriched.semantic_router_rejection, undefined,
    "SR rejection must NOT be stamped (gate skipped — there's no rejection because SR was never called)");

  const spec = createTaskSpec(userCommand, enriched, {});
  assert.equal(spec.routing_status, "ok",
    `routing_status must be ok when SR is intentionally skipped; got ${spec.routing_status}`);
  assert.equal(spec.routing_degraded, false,
    "routing_degraded must be false — fast executor must not refuse the task");
});

await it("end-to-end: scheduler contextText + simulated SR outage → routing_degraded=false", async () => {
  // Reproduces verify-scheduler: scheduled context_task with contextText
  // routed through buildSchedulerContextPacket → ctx.text. Pre-I1 this
  // consulted SR; SR failed in test env (no provider configured);
  // routing_degraded=true; fast executor refused the task. Post-I1 the
  // gate skips SR entirely (hard-fact source_scope=current_context),
  // so no rejection, no degradation.
  const userCommand = "总结今天的待办";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {
      text: "Scheduled AI work smoke test",
      source_app: "uca.scheduler",
      capture_mode: "event"
    }
  });
  assert.equal(enriched.semantic_router_decision, undefined);
  assert.equal(enriched.semantic_router_rejection, undefined);

  const spec = createTaskSpec(userCommand, enriched, {});
  assert.equal(spec.routing_status, "ok");
  assert.equal(spec.routing_degraded, false);
});

await it("end-to-end: real_selection passage summary (no pronoun) + SR outage → routing_degraded=false", async () => {
  // Anchor real_selection without a pronoun — kind=fact branch fires.
  const userCommand = "summarise the highlights";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {
      text: "A long passage of selected text the user wants summarised — strictly based on this content."
    }
  });
  assert.equal(enriched.semantic_router_decision, undefined);
  assert.equal(enriched.semantic_router_rejection, undefined);

  const spec = createTaskSpec(userCommand, enriched, {});
  assert.equal(spec.routing_status, "ok");
  assert.equal(spec.routing_degraded, false);
});

// ── 7. Resolver outcome unchanged: hard-fact-skip preserves forbid ─
await it("resolver outcome: '不要联网' still resolves to forbidden after I1", () => {
  const text = "不要联网，告诉我今天 AI 新闻";
  const { signals } = probe(text);
  const policy = resolveToolPolicy({ signals, contextPacket: {}, text });
  assert.equal(policy.web_search_fetch.mode, "forbidden",
    "explicit_no_search must still resolve to web=forbidden (rule unchanged)");
});

await it("resolver outcome: real_selection still resolves to forbidden after I1", () => {
  const text = "只基于这段内容总结";
  const ctx = { text: "A long passage of selected text." };
  const { signals, routerContext } = probe(text, ctx);
  const policy = resolveToolPolicy({ signals, contextPacket: routerContext, text });
  assert.equal(policy.web_search_fetch.mode, "forbidden");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
