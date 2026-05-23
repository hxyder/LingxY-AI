/**
 * UCA-077 P4-RQ D1 (Layer 2 signal): user-named single-URL/article
 * intent.
 *
 * Fires when the user explicitly anchors the task to ONE specific
 * URL or article — "summarise this URL", "总结这个 URL", "只基于
 * 这篇文章" — patterns where it would be wrong to fan out across
 * independent sources. Consumed by `policy/research-quality.mjs`
 * (Layer 4 derivation) to switch the task's research_quality
 * profile from `multi_source_research` (default) to `single_lookup`,
 * which the success-contract validator then enforces with a relaxed
 * 1/1/digest-ok threshold.
 *
 * `kind: "hint"` — the phrase is a real text marker, but mapping it
 * to "single source is enough" is the conventional inference (matches
 * the SignalKind typedef: hint = pattern + conventional implication,
 * not direct observation). Future Phase 4 RAID consumers can choose
 * to surface lower confidence on these cases vs file attachments
 * (which would be `fact`).
 *
 * Design: this is a Layer 2 SIGNAL, not inline regex inside the
 * research-quality module. Reasons:
 *   1. Mirrors the existing user-intent signals (`explicit_search`,
 *      `explicit_external`, `topic_hint`, `pending_offer`).
 *   2. Available to other Layer-3+ consumers (SemanticRouter prompt,
 *      decision-trace) without each rewriting the regex.
 *   3. Tested via verify-signal-kinds along with the rest.
 */

import { emptySignal } from "./_signal-types.mjs";

const SIGNAL_NAME = "explicit_single_url";

// Chinese phrasings: "summarise this <URL/article/page>" + variants.
// Each pattern is intentionally conservative — false-positives here
// collapse a research task to single-source, which is the failure
// mode we just spent the round fixing.
const PATTERNS_CN = [
  /(总结|概括|分析|阅读|读一下|看看)\s*(这(?:一)?(篇|个|份)|此)?\s*(URL|链接|网页|页面|文章|帖子|博客|post)/i,
  /只基于这(?:一)?(篇|个|份)/,
  /基于这(?:一)?(篇|个|份)\s*(文章|页面|网页|URL|链接|帖子|文档)/i,
  /(对|关于)\s*这(?:一)?(篇|个|份)\s*(文章|页面|网页|URL|链接|文档)/i
];

const PATTERNS_EN = [
  /\bsummari[sz]e\s+(this|the)\s+(url|article|page|post|story|blog|document)\b/i,
  /\bread\s+(this|the)\s+(url|article|page|post|story|blog|document)\b/i,
  /\b(based|only|just)\s+(on|from)\s+(this|the)\s+(url|article|page|post)\b/i,
  /\babout\s+this\s+(article|page|post)\b/i
];

// Loose verb-URL adjacency: a summarise-style verb close to an
// http(s):// URL. Wider window than the named-noun patterns above —
// catches "https://… 给我总结一下" and "summarise https://… please".
const URL_VERB_ADJACENCY = [
  /(总结|概括|分析|阅读|读一下|看看).{0,40}https?:\/\//i,
  /https?:\/\/.{0,60}(总结|概括|分析|阅读|读一下|看看)/i,
  /\bsummari[sz]e\b.{0,60}https?:\/\//i,
  /https?:\/\/.{0,60}\bsummari[sz]e\b/i
];

/**
 * @param {string} text
 * @param {object} [_contextPacket]  - unused; signal is text-only
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket = {}) {
  if (typeof text !== "string" || text.length === 0) return emptySignal(SIGNAL_NAME);

  const matched =
    PATTERNS_CN.some((re) => re.test(text)) ||
    PATTERNS_EN.some((re) => re.test(text)) ||
    URL_VERB_ADJACENCY.some((re) => re.test(text));

  if (!matched) return emptySignal(SIGNAL_NAME);

  return {
    name: SIGNAL_NAME,
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [
      { type: "regex", source: SIGNAL_NAME, reason: "user named a single URL/article to analyse" }
    ],
    hint: { value: "single_url" }
  };
}

export const EXPLICIT_SINGLE_URL_SIGNAL_NAME = SIGNAL_NAME;
