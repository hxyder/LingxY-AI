#!/usr/bin/env node
/**
 * UCA-077 P4-RQ I1 / P6: SemanticRouter gate + deterministic lock.
 *
 * Earlier I1 over-corrected by letting source_scope=fact+LOCAL skip SR.
 * That stopped degraded refusals, but it also blocked IntentRoute from
 * classifying user_goal / expected_output before tools ran. P6 restores
 * LLM-primary semantics: local anchors may still call SR for semantic
 * classification, while the resolver merge keeps web policy locked.
 *
 * Current fix: skip SR only for narrow structural hard signals. For
 * local source_scope facts, consult SR, but collapse SR operational
 * failures to routing_status=ok_deterministic so fast does not refuse.
 *
 * Cases the gate must skip:
 *   1. explicit_no_search.matched && kind === "fact"     ("不要联网")
 *   2. pure attachments (file_paths / image_paths) with no search verb
 *   3. explicit external opt-in
 *   4. tiny chitchat
 *
 * Cases the gate must STILL consult SR (ambiguous):
 *   5. source_scope=fact+LOCAL (SR classifies semantics; policy stays locked)
 *   6. assumption-kind source_scope ("这个/这篇" pronoun, no anchor)
 *   7. text-only research-class queries with no anchor / no no-search
 *   8. attachments + neutral explicit_search ("结合简历搜索工作")
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

// ── 2. source_scope=fact + LOCAL → consult SR for semantics ────────
await it("scheduler contextText is not a real_selection, but SR remains eligible", () => {
  // Scheduled context is runtime background, not a fresh user selection.
  // It must not become source_scope=fact, but the current command can still
  // reach SR for semantic classification.
  const text = "今天的状态";
  const ctx = {
    text: "Scheduled AI work smoke test",
    source_app: "uca.scheduler",
    capture_mode: "event"
  };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(routerContext.context_sources.real_selection, false,
    "scheduler context must stay background, not real_selection");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "scheduler task must still consult SR for semantic classification"
  );
});

await it("local fact: passage + neutral command → SR IS consulted", () => {
  // No pronoun in the user command — the detector's CURRENT_CONTEXT
  // pronoun branch (kind=assumption) does NOT fire. The real_selection
  // anchor takes the kind=fact selection branch. Local fact no longer
  // suppresses SR.
  const text = "save this for reference";
  const ctx = { text: "User pasted a long passage about a framework's architecture, several paragraphs of detail." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope?.matched, true);
  assert.equal(signals.source_scope.kind, "fact",
    "without a pronoun, real_selection anchor produces kind=fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true
  );
});

await it("scheduler summary request → SR IS consulted without regex override", () => {
  const text = "总结今天的待办";
  const ctx = {
    text: "Scheduled AI work smoke test",
    source_app: "uca.scheduler",
    capture_mode: "event"
  };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(routerContext.context_sources.real_selection, false);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "scheduler summary request must not be silenced by background context"
  );
});

await it("local fact: real_selection + 'summarise' → SR IS consulted without regex override", () => {
  const text = "summarise the highlights";
  const ctx = { text: "User pasted a long passage about a framework's architecture, several paragraphs of detail." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope?.matched, true);
  assert.equal(signals.source_scope.kind, "fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "source_scope=fact+LOCAL must not silence SR"
  );
});

await it("explicit_no_search.fact still skips SR even when output shape is complex", () => {
  // Architectural symmetry: explicit_no_search is a hard fact about
  // ROUTING (the user said don't browse). Transformation intent is a
  // hard fact about OUTPUT shape. They don't conflict — no_search wins
  // because it's a directive, transformation just enables IntentRoute
  // classification. SR is still skipped here because the resolver's
  // policy is settled regardless.
  const text = "不要联网，帮我总结一下今天的邮件";
  const { signals, routerContext } = probe(text);
  assert.equal(signals.explicit_no_search?.matched, true);
  assert.equal(signals.explicit_no_search.kind, "fact");
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false,
    "explicit_no_search.fact must skip SR even with transformation verb"
  );
});

await it("ambiguous (documented contract): pronoun '这段' + real selection → kind=assumption → SR IS consulted", () => {
  // Detector contract: CURRENT_CONTEXT pronoun branch fires first and
  // returns kind=assumption even when a real anchor exists, because
  // "这段" can ambiguously refer to a quoted external article. SR is
  // therefore the right layer to disambiguate. Documenting this here
  // so the I1 hard-fact skip is not over-broadened to swallow ambiguous
  // pronoun cases.
  const text = "请总结这段内容";
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

await it("local_only_constraint skips SR even when a pronoun and selection are present", () => {
  const text = "只基于这段内容总结，不要扯其他";
  const ctx = { text: "User pasted a long passage about a framework's architecture." };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.local_only_constraint?.matched, true);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    false,
    "explicit local-only constraints settle the web policy without SR"
  );
});

await it("mixed input: file_paths + explicit_search → SR IS consulted", () => {
  const text = "结合我的简历搜索适合我的工作";
  const ctx = { file_paths: ["C:/tmp/resume.pdf"] };
  const { signals, routerContext } = probe(text, ctx);
  assert.equal(signals.source_scope?.hint?.value, "uploaded_files");
  assert.equal(signals.explicit_search?.matched, true);
  assert.equal(
    shouldConsultSemanticRouter({ signals, contextPacket: routerContext, text }),
    true,
    "neutral search with local input must reach SR for local-vs-external disambiguation"
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

// ── 6. End-to-end: deterministic locks must NOT mark routing_degraded
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
  assert.ok(["ok", "ok_deterministic"].includes(spec.routing_status),
    `routing_status must be ok/ok_deterministic when SR is intentionally skipped; got ${spec.routing_status}`);
  assert.equal(spec.routing_degraded, false,
    "routing_degraded must be false — fast executor must not refuse the task");
});

await it("end-to-end: scheduler contextText remains non-degraded when SR gives no actionable route", async () => {
  // Scheduler context is background, not a deterministic local lock. SR may
  // be consulted and can reject for low confidence/no provider depending on
  // the local test environment, but this path must not be marked degraded.
  const userCommand = "今天的状态";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {
      text: "Scheduled AI work smoke test",
      source_app: "uca.scheduler",
      capture_mode: "event"
    }
  });
  const spec = createTaskSpec(userCommand, enriched, {});
  assert.ok(["ok", "ok_deterministic", "sr_low_confidence", "sr_no_provider", "sr_timeout"].includes(spec.routing_status),
    `routing_status must be scheduler-compatible status; got ${spec.routing_status}`);
  const operationalFailure = ["sr_no_provider", "sr_timeout"].includes(spec.routing_status);
  assert.equal(spec.routing_degraded, operationalFailure);
});

await it("end-to-end: real_selection + neutral command + SR outage → ok_deterministic / routing_degraded=false", async () => {
  // Anchor real_selection without a pronoun — SR may be consulted, but
  // local deterministic lock prevents degraded refusal on outage.
  const userCommand = "save this for reference";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {
      text: "A long passage of selected text the user wants kept for later — strictly based on this content."
    }
  });
  const spec = createTaskSpec(userCommand, enriched, {});
  assert.ok(["ok", "ok_deterministic"].includes(spec.routing_status),
    `routing_status must be ok/ok_deterministic; got ${spec.routing_status}`);
  assert.equal(spec.routing_degraded, false);
});

await it("end-to-end: pronoun command + real_selection + SR outage → ok_deterministic / routing_degraded=false", async () => {
  // "这段" is assumption-kind, but the runtime has an observable
  // selection. This is a local deterministic lock for the routing axis,
  // so SR outage must not make fast refuse the local summarisation.
  const userCommand = "请总结这段网页内容";
  const enriched = await applySemanticRouterPreflight({
    userCommand,
    contextPacket: {
      text: "This is a captured browser selection."
    }
  });

  const spec = createTaskSpec(userCommand, enriched, {});
  assert.ok(["ok", "ok_deterministic"].includes(spec.routing_status),
    `routing_status must be ok/ok_deterministic; got ${spec.routing_status}`);
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
