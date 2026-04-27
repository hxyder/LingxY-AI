/**
 * UCA-077 P4-RQ D1: research_quality TaskSpec field + inference.
 *
 * Pure helper. Decides whether a task-with-web requires multi-source
 * synthesis (`multi_source_research`) or is a single-source task
 * (`single_lookup` — user explicitly summarising one article/URL or
 * working off a local selection/file). Output is stamped onto
 * `task_spec.research_quality`; the success-contract validator and
 * the per-step phase gate read it to enforce coverage thresholds
 * deterministically (D3).
 *
 * Why determinism (re-introduced after the prompt-only round): the
 * LLM principles in C1 are necessary but not sufficient. Production
 * regressed when a model shipped a single ScienceNet weekly-review
 * page as the answer to "今天 AI 新闻" — the prompt told it not to,
 * but nothing forced it to do otherwise. With this layer, the
 * validator REJECTS that completion and the loop has to find more
 * sources.
 *
 * Layer placement (per main plan §12.7 / §18.x):
 *   - Layer 1 (context-sources.mjs) classifies content into anchors;
 *     this module reads `real_selection` / `file_text` via
 *     `hasLocalAnchor`.
 *   - Layer 2 (signals/explicit-single-url.mjs) fires the
 *     `explicit_single_url` signal on user phrasing; this module
 *     reads the signal output, NOT the regex (architecturally
 *     cleaner — same pattern as tool-policy-resolver consuming
 *     other signals).
 *   - Layer 4 (this module) derives `research_quality` from the
 *     above + `tool_policy.policy_groups.external_web_read.mode`.
 *   - Layer 7 (success-contract-validator.mjs) reads the field and
 *     enforces deterministic coverage thresholds against the
 *     evidence-normalizer's transcript walk (D3).
 *
 * Profile selection:
 *   - `forbidden` web policy → null (no research enforcement applies)
 *   - local anchor (real_selection / file_text) → single_lookup
 *     (user pointed us at THIS thing — don't fan out)
 *   - `signals.explicit_single_url.matched` → single_lookup
 *   - otherwise (web allowed, no anchor) → multi_source_research
 *
 * Default thresholds for `multi_source_research` (per user spec):
 *   - min_sources: 3              "at least 3 distinct URLs"
 *   - min_distinct_domains: 2     "from at least 2 publishers"
 *   - single_source_digest_satisfies: false   "a roundup page from
 *                                              one publisher does
 *                                              NOT satisfy the
 *                                              contract"
 *
 * `single_lookup` collapses to 1/1/true — single source from one
 * publisher is the entire point.
 */

import { hasLocalAnchor } from "../intent/context-sources.mjs";

export const RESEARCH_PROFILES = Object.freeze({
  MULTI_SOURCE_RESEARCH: "multi_source_research",
  SINGLE_LOOKUP: "single_lookup",
  // K3: deep_research profile. Stricter than multi_source_research —
  // triggers only when the SemanticRouter classifies the request as
  // "deep_research" (user explicitly asked for thorough / comprehensive /
  // in-depth coverage: "深入调研", "全面对比", "comprehensive review",
  // "exhaustive research"). Same shape as multi_source_research; only
  // the threshold numbers differ. The prompt-side budget block (K2)
  // and the validator's `checkResearchCoverage` are data-driven on
  // `min_sources` / `min_distinct_domains` so neither needs special
  // handling — adding deep_research is a profile-list extension.
  DEEP_RESEARCH: "deep_research"
});

export const DEFAULT_MULTI_SOURCE_THRESHOLDS = Object.freeze({
  min_sources: 3,
  min_distinct_domains: 2,
  single_source_digest_satisfies: false
});

export const SINGLE_LOOKUP_THRESHOLDS = Object.freeze({
  min_sources: 1,
  min_distinct_domains: 1,
  single_source_digest_satisfies: true
});

// K3: stricter thresholds for "deep_research" — comprehensive
// research / exhaustive comparison / in-depth review tasks. 5 sources
// from 3 distinct publishers means the LLM has to actually reach
// across the news ecosystem, not just hit one extra wire service.
// single_source_digest_satisfies stays false (a roundup is still a
// roundup, regardless of how many internal articles it lists).
export const DEEP_RESEARCH_THRESHOLDS = Object.freeze({
  min_sources: 5,
  min_distinct_domains: 3,
  single_source_digest_satisfies: false
});

/**
 * @typedef {Object} ResearchQuality
 * @property {"multi_source_research" | "single_lookup"} profile
 * @property {number}  min_sources
 * @property {number}  min_distinct_domains
 * @property {boolean} single_source_digest_satisfies
 * @property {string}  reason
 */

/**
 * @param {{
 *   contextSources?: object,
 *   signals?: object,
 *   toolPolicyMode?: "forbidden" | "optional" | "required",
 *   srResearchDepth?: "single_lookup" | "multi_source" | "deep_research" | "unknown" | null,
 *   srSourceMode?: "no_external" | "provided_context" | "single_lookup" | "multi_source_research" | "deep_research" | "unknown" | null
 * }} input
 * @returns {ResearchQuality | null}
 */
export function inferResearchQuality({
  contextSources = null,
  signals = null,
  toolPolicyMode = null,
  srResearchDepth = null,
  srSourceMode = null
} = {}) {
  // Web fully forbidden → no research enforcement applies. The
  // validator never runs research-quality checks for this case.
  if (toolPolicyMode === "forbidden") return null;

  // Local anchor — user pointed us at THIS specific content. Don't
  // fan out across independent sources. Beats SR depth (deep_research
  // doesn't override "summarise this PDF").
  if (hasLocalAnchor(contextSources)) {
    return {
      profile: RESEARCH_PROFILES.SINGLE_LOOKUP,
      ...SINGLE_LOOKUP_THRESHOLDS,
      reason: "Local anchor (real_selection / file_text) — user named the content to use."
    };
  }

  // Layer 2 signal said the user explicitly named a single URL /
  // article in their command. Same beats-SR-depth rule.
  if (signals?.explicit_single_url?.matched) {
    return {
      profile: RESEARCH_PROFILES.SINGLE_LOOKUP,
      ...SINGLE_LOOKUP_THRESHOLDS,
      reason: "explicit_single_url signal matched — user named a single URL / article."
    };
  }

  if (srSourceMode === "single_lookup" || srResearchDepth === "single_lookup") {
    return {
      profile: RESEARCH_PROFILES.SINGLE_LOOKUP,
      ...SINGLE_LOOKUP_THRESHOLDS,
      reason: "IntentRoute classified the request as single_lookup."
    };
  }

  // K3: SR-driven deep_research escalation. SR's `research_depth =
  // "deep_research"` only fires for explicit thorough/comprehensive
  // phrasings (taught in the SR prompt; see semantic-router.mjs
  // RESEARCH_DEPTHS). Stricter thresholds (5/3) than the default
  // multi_source_research (3/2). Same single_source_digest_satisfies=false
  // — a roundup never satisfies either profile.
  if (srSourceMode === "deep_research" || srResearchDepth === "deep_research") {
    return {
      profile: RESEARCH_PROFILES.DEEP_RESEARCH,
      ...DEEP_RESEARCH_THRESHOLDS,
      reason: "IntentRoute classified the request as deep_research."
    };
  }

  if (srSourceMode === "multi_source_research" || srResearchDepth === "multi_source") {
    return {
      profile: RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
      ...DEFAULT_MULTI_SOURCE_THRESHOLDS,
      reason: "IntentRoute classified the request as multi_source_research."
    };
  }

  if (toolPolicyMode === "required") {
    return {
      profile: RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
      ...DEFAULT_MULTI_SOURCE_THRESHOLDS,
      reason: "Web tool reads required and no single-source anchor — research-class task."
    };
  }

  return null;
}
