// B2-a (c): deterministic override that catches "stable Q&A" prompts
// the LLM mis-routed into web_policy=required. UPGRADE_PLAN.md.
//
// Rule (priority high to low — the FIRST matching condition wins):
//   1. freshness time-word OR freshness topic-word OR explicit
//      external/search signals  → leave decision untouched (search OK).
//   2. learning verb / 学习动词 in text AND none of the above
//      → force web_policy=forbidden, source_mode=no_external.
//   3. otherwise → leave decision untouched.
//
// The reverse cases the plan locks in:
//   "如何报税"             → 报税 is freshness topic → search ✓
//   "什么是 RAG"           → learning verb + no freshness → forbidden ✓
//   "解释一下 NVDA 今日股价" → 今日 + 股价 → search ✓
//   "TypeScript 5.5 怎么用 …" → 怎么 + no freshness → forbidden ✓
//   "Bun 当前版本号"        → 当前 + 版本号 → search ✓
//
// Codex round-1: freshness time-word coverage MUST come from the
// canonical repo signal (signals/weak-freshness.mjs) so we never
// drift below the existing detector — terms like 明天/后天/今年/下周
// /实时 plus the EN equivalents are owned there. Re-run detect()
// here so the override works whether or not the SR caller pre-
// computed the signal bundle.

import { detect as detectWeakFreshness } from "./signals/weak-freshness.mjs";

const LEARNING_VERB_RE = new RegExp(
  [
    "什么是", "解释", "定义", "原理", "区别",
    "如何", "怎么", "为什么",
    "介绍", "概述", "入门", "教程",
    "最佳实践", "优缺点", "对比", "举例",
    "总结", "梳理", "科普"
  ].join("|"),
  "u"
);

const FRESHNESS_TOPIC_WORD_RE = new RegExp(
  [
    "政策", "法规",
    "报税", "签证", "申请流程", "费用", "价格", "折扣",
    "活动", "上市",
    "版本号", "版本", "发布", "更新", "变更",
    "漏洞", "停服", "限购",
    "新闻", "动态",
    "股价"
  ].join("|"),
  "u"
);

function hasFreshnessSignal(text, signals = {}) {
  // Time-word freshness: defer to the canonical detector so this
  // override stays in lockstep with the rest of the SR pipeline.
  // Prefer the pre-computed signal if the caller already ran it.
  if (signals?.weak_freshness?.matched === true) return true;
  if (detectWeakFreshness(text)?.matched === true) return true;
  // Topic-word freshness is plan-specific to B2-a (c) — domains the
  // plan explicitly flagged as freshness-bearing even without a time
  // marker. (政策 / 报税 / 股价 / 版本号 etc.)
  if (FRESHNESS_TOPIC_WORD_RE.test(text)) return true;
  // Explicit user signals dominate as well.
  if (signals?.explicit_search?.matched) return true;
  if (signals?.explicit_external?.matched) return true;
  if (signals?.explicit_single_url?.matched) return true;
  return false;
}

function hasLearningVerb(text) {
  return LEARNING_VERB_RE.test(text);
}

/**
 * Given a (validated) SR decision and the original text/signals,
 * return either the same decision (no override) or a corrected one
 * with web_policy=forbidden / source_mode=no_external.
 *
 * Returns an object describing what happened:
 *   { applied: false, decision }
 *   { applied: true,  decision, reason }
 *
 * Callers that don't care about provenance can just use `.decision`.
 */
export function applyStableQAOverride({ text = "", decision, signals = {} } = {}) {
  if (!decision || typeof decision !== "object") {
    return { applied: false, decision };
  }
  if (typeof text !== "string" || !text.trim()) {
    return { applied: false, decision };
  }

  // Already forbidden — nothing to do.
  if (decision.web_policy === "forbidden") {
    return { applied: false, decision };
  }

  if (hasFreshnessSignal(text, signals)) {
    return { applied: false, decision };
  }

  if (!hasLearningVerb(text)) {
    return { applied: false, decision };
  }

  const next = {
    ...decision,
    web_policy: "forbidden",
    source_mode: "no_external"
  };
  if (Array.isArray(decision.research_quality)) {
    next.research_quality = null;
  } else if (decision.research_quality !== undefined) {
    next.research_quality = null;
  }
  return {
    applied: true,
    decision: next,
    reason: "stable_qa_override: learning verb without freshness signal"
  };
}

// Re-exported predicates for tests + downstream use.
export { hasFreshnessSignal, hasLearningVerb };
