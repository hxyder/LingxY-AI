#!/usr/bin/env node
/**
 * verify-stable-qa-override.mjs — B2-a (c) in UPGRADE_PLAN.md
 *
 * Regression: 109 corpus had stable Q&A prompts (A.dependency_inversion,
 * A.indexing, F.par_b) that SR mistakenly routed to web_policy=required,
 * leading to needless web_search round-trips and answers cluttered with
 * irrelevant search results.
 *
 * Fix: deterministic post-SR override. If the prompt has a *learning
 * verb* (什么是 / 解释 / 怎么 / 如何 / 教程 / etc.) AND no freshness
 * signal (time-word OR topic-word OR explicit search/external/single-url
 * signal), force web_policy=forbidden / source_mode=no_external.
 *
 * Constitution:
 *   - 不打补丁: rule is class-level (learning-verb regex + freshness
 *     regex); no per-prompt if-else.
 *   - 不针对特定提问: the same regex set runs across every task;
 *     the plan locks 5 reverse cases as boundary tests:
 *       "如何报税"             → search ✓
 *       "什么是 RAG"           → forbidden ✓
 *       "解释一下 NVDA 今日股价" → search ✓
 *       "TypeScript 5.5 怎么用 inferred predicate" → forbidden ✓
 *       "Bun 当前版本号"        → search ✓
 */

import {
  applyStableQAOverride,
  hasLearningVerb,
  hasFreshnessSignal
} from "../src/service/core/intent/stable-qa-override.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

const baseDecision = {
  web_policy: "required",
  source_mode: "internet",
  research_quality: "balanced",
  confidence: 0.9
};

// ----------------------------------------------------------------------
// 1-5. The plan's 5 reverse-case judgments (locked-in boundary).
// ----------------------------------------------------------------------
const REVERSE_CASES = [
  { text: "如何报税", expectOverride: false, why: "报税 is freshness topic" },
  { text: "什么是 RAG", expectOverride: true, why: "学习动词 + no freshness" },
  { text: "解释一下 NVDA 今日股价", expectOverride: false, why: "今日 + 股价 双命中 freshness" },
  { text: "TypeScript 5.5 怎么用 inferred predicate", expectOverride: true, why: "怎么 + no freshness" },
  { text: "Bun 当前版本号", expectOverride: false, why: "当前 + 版本号 双命中 freshness" }
];

for (const c of REVERSE_CASES) {
  const result = applyStableQAOverride({ text: c.text, decision: { ...baseDecision } });
  check(
    `plan-case '${c.text}' (${c.why}) — applied=${c.expectOverride}`,
    result.applied === c.expectOverride
  );
  if (c.expectOverride) {
    check(
      `  → web_policy=forbidden, source_mode=no_external`,
      result.decision.web_policy === "forbidden"
        && result.decision.source_mode === "no_external"
    );
  }
}

// ----------------------------------------------------------------------
// 6. Stable QA across more verbs.
// ----------------------------------------------------------------------
const STABLE_QA = [
  "解释一下依赖注入的原理",
  "什么是 dependency injection",
  "RAG 的优缺点对比",
  "梳理一下 transformer 架构",
  "概述 K8s 入门教程",
  "为什么 React fiber 比旧版快",
  "举例说明 promise 链式调用"
];
for (const text of STABLE_QA) {
  const r = applyStableQAOverride({ text, decision: { ...baseDecision } });
  check(`stable-qa: '${text}' → forbidden`, r.applied && r.decision.web_policy === "forbidden");
}

// ----------------------------------------------------------------------
// 7. Freshness time-words must NOT trigger override.
// ----------------------------------------------------------------------
const FRESHNESS_TIME = [
  "解释一下今天的市场为什么大跌",
  "什么是最新 ChatGPT 模型",
  "近期 Anthropic 发布了什么",
  "目前 Bun 版本是多少"
];
for (const text of FRESHNESS_TIME) {
  const r = applyStableQAOverride({ text, decision: { ...baseDecision } });
  check(`freshness-time '${text}' → SR untouched`, r.applied === false);
}

// ----------------------------------------------------------------------
// 7b. Codex round-1: freshness terms owned by signals/weak-freshness
//     (明天/后天/今年/下周/实时 + EN equivalents) MUST NOT trigger
//     override. Previously the local time-word regex missed these.
// ----------------------------------------------------------------------
const WEAK_FRESHNESS_TERMS = [
  "如何看明天的天气",
  "怎么查实时汇率",
  "解释一下下周的会议安排",
  "什么是后天的活动",
  "今年怎么报税",
  "explain today's news",
  "what is the latest research",
  "how do recent papers compare"
];
for (const text of WEAK_FRESHNESS_TERMS) {
  const r = applyStableQAOverride({ text, decision: { ...baseDecision } });
  check(`weak-freshness '${text}' → SR untouched`, r.applied === false);
}

// ----------------------------------------------------------------------
// 7c. Pre-computed signals.weak_freshness from upstream SR pipeline
//     should also disable the override.
// ----------------------------------------------------------------------
{
  const text = "解释一下深度学习";
  const signals = { weak_freshness: { matched: true } };
  const r = applyStableQAOverride({ text, decision: { ...baseDecision }, signals });
  check(
    "pre-computed signals.weak_freshness disables override",
    r.applied === false
  );
}

// ----------------------------------------------------------------------
// 8. Freshness topic-words must NOT trigger override.
// ----------------------------------------------------------------------
const FRESHNESS_TOPIC = [
  "如何申请加拿大签证",
  "美国 H1B 政策怎么了",
  "Tesla 股价为什么大跌",
  "苹果发布的新功能介绍",
  "iPhone 16 上市怎么买"
];
for (const text of FRESHNESS_TOPIC) {
  const r = applyStableQAOverride({ text, decision: { ...baseDecision } });
  check(`freshness-topic '${text}' → SR untouched`, r.applied === false);
}

// ----------------------------------------------------------------------
// 9. Decision already forbidden → no-op override.
// ----------------------------------------------------------------------
{
  const decision = { ...baseDecision, web_policy: "forbidden" };
  const r = applyStableQAOverride({ text: "什么是 RAG", decision });
  check(
    "already forbidden: no override (no-op short circuit)",
    r.applied === false && r.decision.web_policy === "forbidden"
  );
}

// ----------------------------------------------------------------------
// 10. Empty text → no override (avoid false positives).
// ----------------------------------------------------------------------
{
  const r = applyStableQAOverride({ text: "", decision: { ...baseDecision } });
  check("empty text: no override", r.applied === false);
}

// ----------------------------------------------------------------------
// 11. Explicit search signal beats learning verb.
// ----------------------------------------------------------------------
{
  const text = "解释一下深度学习";
  const signals = { explicit_search: { matched: true } };
  const r = applyStableQAOverride({ text, decision: { ...baseDecision }, signals });
  check(
    "explicit_search signal beats learning verb",
    r.applied === false
  );
}

// ----------------------------------------------------------------------
// 12. Predicates expose-able for downstream / tests.
// ----------------------------------------------------------------------
check("hasLearningVerb('什么是 X') === true", hasLearningVerb("什么是 X") === true);
check("hasLearningVerb('summarize the news today') === false", hasLearningVerb("summarize the news today") === false);
check("hasFreshnessSignal('当前股价') === true", hasFreshnessSignal("当前股价") === true);
check("hasFreshnessSignal('什么是 X') === false", hasFreshnessSignal("什么是 X") === false);

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
