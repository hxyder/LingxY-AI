#!/usr/bin/env node
/**
 * UCA-077 P4-01 (plan §18.3): signal kind taxonomy.
 *
 * Verifies each detector annotates its matched output with a canonical
 * `kind ∈ {fact | hint | assumption}`, matches the design rationale in
 * `_signal-types.mjs`, and that empty (unmatched) signals carry kind:null.
 *
 * Goal: SemanticRouter (P4-02) consumes `signal.kind` to decide which
 * signals are ground truth (fact), which are conventional suggestions
 * (hint), and which are interpretations the LLM may want to second-guess
 * (assumption). The 3-class taxonomy is intentionally small — see §18.3.
 *
 * Asserts:
 *   1. SIGNAL_KINDS is frozen and equals ["fact", "hint", "assumption"].
 *   2. emptySignal(name) carries kind:null (no claim until matched).
 *   3. explicit_external / explicit_search / topic_hint /
 *      weak_freshness all annotate kind:"hint" when they fire, while
 *      local_only_constraint annotates kind:"fact".
 *   4. source_scope branches:
 *        attachment        → fact
 *        LOCAL_PROJECT     → fact
 *        CURRENT_CONTEXT   → assumption (the pronoun → scope inference)
 *        selection text    → fact (text presence, even with weak strength)
 *        no match          → null
 *   5. Every detector's matched output has kind drawn from SIGNAL_KINDS.
 *   6. Every detector's unmatched output has kind:null.
 *   7. End-to-end: createTaskSpec doesn't break on the new field; the
 *      contract evidence array is unchanged in shape (kind annotates
 *      signals, not evidence — this lock-in protects callers that
 *      iterate evidence).
 *
 * Run: node scripts/verify-signal-kinds.mjs
 */

import assert from "node:assert/strict";

import { SIGNAL_KINDS, emptySignal } from "../src/service/core/intent/signals/_signal-types.mjs";
import * as signalsIndex from "../src/service/core/intent/signals/index.mjs";
import { detect as detectExternal } from "../src/service/core/intent/signals/explicit-external.mjs";
import { detect as detectSearch }   from "../src/service/core/intent/signals/explicit-search.mjs";
import { detect as detectEntity }   from "../src/service/core/intent/signals/topic-hint.mjs";
import { detect as detectFresh }    from "../src/service/core/intent/signals/weak-freshness.mjs";
import { detect as detectScope }    from "../src/service/core/intent/signals/source-scope.mjs";
import { detect as detectPending }  from "../src/service/core/intent/signals/pending-offer.mjs";
import { detect as detectLocalOnly } from "../src/service/core/intent/signals/local-only-constraint.mjs";
import { SIGNAL_NAMES }              from "../src/service/core/intent/signals/_signal-types.mjs";
import { createTaskSpec }            from "../src/service/core/task-spec.mjs";

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

async function run() {
  // ── 1. taxonomy ───────────────────────────────────────────────────────
  it("taxonomy: SIGNAL_KINDS frozen with exactly fact / hint / assumption", () => {
    assert.deepEqual([...SIGNAL_KINDS], ["fact", "hint", "assumption"]);
    assert.throws(() => { SIGNAL_KINDS.push("speculation"); });
  });
  it("public surface: signals/index.mjs re-exports SIGNAL_KINDS", () => {
    // Lock-in for P4-02 SemanticRouter and future consumers: they import
    // from signals/index.mjs, never from _signal-types.mjs (internal). A
    // regression where someone removes this re-export silently pushes
    // downstream code to reach into private files.
    assert.ok(Array.isArray(signalsIndex.SIGNAL_KINDS));
    assert.deepEqual([...signalsIndex.SIGNAL_KINDS], [...SIGNAL_KINDS]);
    assert.equal(signalsIndex.SIGNAL_KINDS, SIGNAL_KINDS,
      "re-export must be the same frozen reference, not a copy");
  });

  // ── 2. empty signal default ──────────────────────────────────────────
  it("empty: emptySignal(name).kind is null", () => {
    const s = emptySignal("test");
    assert.equal(s.kind, null);
    assert.equal(s.matched, false);
  });

  // ── 3. single-kind detectors all return kind:hint ────────────────────
  it("hint: explicit_external returns kind:hint when matched", () => {
    const s = detectExternal("查一下网上最近的开源项目", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
  });
  it("hint: explicit_search returns kind:hint when matched", () => {
    const s = detectSearch("搜一下文档", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
  });
  it("hint: topic_hint returns kind:hint when matched", () => {
    const s = detectEntity("今天北京的天气", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
  });
  it("hint: weak_freshness returns kind:hint when matched", () => {
    const s = detectFresh("最近怎么样", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
  });
  it("hint: pending_offer returns kind:hint when both halves match (C4)", () => {
    const s = detectPending("需要", {
      selection_metadata: {
        conversation_turns: [
          { role: "user", content: "今天怎么样" },
          { role: "assistant", content: "想看天气文字摘要的话，我也可以帮你抓取具体数据，需要吗？" }
        ]
      }
    });
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
    assert.equal(s.hint?.pending_intent, "weather");
  });
  it("pending_offer: NOT matched without offer in conversation (C4)", () => {
    const s = detectPending("需要", {
      selection_metadata: {
        conversation_turns: [{ role: "assistant", content: "好的，已记录。" }]
      }
    });
    assert.equal(s.matched, false);
    assert.equal(s.kind, null);
  });
  it("pending_offer: NOT matched on non-affirmative even with offer (C4)", () => {
    const s = detectPending("新建一个文档吧", {
      selection_metadata: {
        conversation_turns: [{ role: "assistant", content: "想要我查一下天气吗？" }]
      }
    });
    assert.equal(s.matched, false);
  });
  it("public surface: SIGNAL_NAMES contains 'pending_offer'", () => {
    assert.ok([...SIGNAL_NAMES].includes("pending_offer"),
      "_signal-types.mjs SIGNAL_NAMES must register pending_offer");
  });

  // ── 3.5. explicit_single_url (P4-RQ D1) ──────────────────────────────
  it("explicit_single_url: matches Chinese phrasings → kind:hint", async () => {
    const { detect } = await import("../src/service/core/intent/signals/explicit-single-url.mjs");
    const s = detect("总结这个 URL: https://example.com/a", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
    assert.equal(s.strength, "strong");
    assert.equal(s.hint?.value, "single_url");
  });
  it("explicit_single_url: matches English phrasings → kind:hint", async () => {
    const { detect } = await import("../src/service/core/intent/signals/explicit-single-url.mjs");
    const s = detect("summarise this article please", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "hint");
  });
  it("explicit_single_url: NOT matched on research/news phrasing", async () => {
    const { detect } = await import("../src/service/core/intent/signals/explicit-single-url.mjs");
    const s = detect("今天有什么 AI 新闻", {});
    assert.equal(s.matched, false);
  });
  it("public surface: SIGNAL_NAMES contains 'explicit_single_url'", () => {
    assert.ok([...SIGNAL_NAMES].includes("explicit_single_url"),
      "_signal-types.mjs SIGNAL_NAMES must register explicit_single_url");
  });

  it("local_only_constraint: matches explicit local-only phrasing → kind:fact", () => {
    const s = detectLocalOnly("仅基于这份文件总结", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "fact");
    assert.equal(s.strength, "strong");
    assert.equal(s.hint?.constraint, "local_only");
  });
  it("local_only_constraint: NOT matched on neutral attachment phrasing", () => {
    const s = detectLocalOnly("结合我的简历搜索适合我的工作", {});
    assert.equal(s.matched, false);
    assert.equal(s.kind, null);
  });
  it("public surface: SIGNAL_NAMES contains 'local_only_constraint'", () => {
    assert.ok([...SIGNAL_NAMES].includes("local_only_constraint"),
      "_signal-types.mjs SIGNAL_NAMES must register local_only_constraint");
  });

  // ── 4. source_scope branches differ by inference depth ────────────────
  it("scope: attachment → kind:fact (observable state)", () => {
    const s = detectScope("帮我看看", { file_paths: ["a.docx"] });
    assert.equal(s.matched, true);
    assert.equal(s.kind, "fact");
    assert.equal(s.hint?.value, "uploaded_files");
  });
  it("scope: '整个项目' → kind:fact (literal phrase)", () => {
    const s = detectScope("整个项目里 current 字段什么意思", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "fact");
    assert.equal(s.hint?.value, "local_project");
  });
  it("scope: '这个框架' → kind:assumption (pronoun → scope inference)", () => {
    const s = detectScope("这个框架很慢，帮我分析", {});
    assert.equal(s.matched, true);
    assert.equal(s.kind, "assumption");
    assert.equal(s.hint?.value, "current_context");
  });
  it("scope: selection text → kind:fact (text presence is observable)", () => {
    // User command stays free of pronoun-style markers so the
    // CURRENT_CONTEXT branch doesn't fire first; only the contextPacket
    // text presence triggers the selection branch.
    const s = detectScope("summarize", { text: "function f(){return 1;}" });
    assert.equal(s.matched, true);
    assert.equal(s.kind, "fact");
    assert.equal(s.hint?.value, "selection");
  });
  it("scope: no match → kind:null", () => {
    const s = detectScope("你好", {});
    assert.equal(s.matched, false);
    assert.equal(s.kind, null);
  });

  // ── 5. invariant: every matched detector annotates kind ∈ SIGNAL_KINDS ─
  it("invariant: every matched detector annotates a canonical kind", () => {
    const cases = [
      detectExternal("查一下网上最近的开源项目", {}),
      detectSearch("查一下文档", {}),
      detectEntity("今日 AI 新闻", {}),
      detectFresh("最近怎么样", {}),
      detectScope("分析下面代码", {}),
      detectScope("帮我看看", { file_paths: ["a.txt"] }),
      detectLocalOnly("只看附件内容", {})
    ];
    for (const s of cases) {
      assert.equal(s.matched, true, `${s.name} should have matched`);
      assert.ok(SIGNAL_KINDS.includes(s.kind),
        `${s.name} kind=${s.kind} not in SIGNAL_KINDS`);
    }
  });

  // ── 6. invariant: unmatched detectors leave kind null ─────────────────
  it("invariant: unmatched detectors return kind:null", () => {
    const cases = [
      detectExternal("hello", {}),
      detectSearch("hello", {}),
      detectEntity("hello", {}),
      detectFresh("hello", {}),
      detectScope("hello", {}),
      detectLocalOnly("hello", {})
    ];
    for (const s of cases) {
      assert.equal(s.matched, false, `${s.name} should not have matched`);
      assert.equal(s.kind, null, `${s.name} kind should be null on no-match`);
    }
  });

  // ── 7. end-to-end: createTaskSpec doesn't break ───────────────────────
  it("e2e: createTaskSpec works with kind-annotated signals (no consumer breakage)", () => {
    const spec = createTaskSpec("查一下网上最近的开源项目", {}, {});
    assert.equal(spec.tool_policy.policy_groups.external_web_read.mode, "required");
    // Evidence remains the existing typedef (type / source / matched / reason).
    // kind is on the signal, not on each evidence item — verify shape unchanged.
    for (const ev of spec.contract.evidence) {
      assert.ok(typeof ev === "object" && ev.source);
      assert.equal(ev.kind, undefined,
        "evidence items must NOT carry a kind field — kind annotates signals only");
    }
  });

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
