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
  SINGLE_LOOKUP: "single_lookup"
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
 *   toolPolicyMode?: "forbidden" | "optional" | "required"
 * }} input
 * @returns {ResearchQuality | null}
 */
export function inferResearchQuality({ contextSources = null, signals = null, toolPolicyMode = null } = {}) {
  // Web fully forbidden → no research enforcement applies. The
  // validator never runs research-quality checks for this case.
  if (toolPolicyMode === "forbidden") return null;

  // Local anchor — user pointed us at THIS specific content. Don't
  // fan out across independent sources.
  if (hasLocalAnchor(contextSources)) {
    return {
      profile: RESEARCH_PROFILES.SINGLE_LOOKUP,
      ...SINGLE_LOOKUP_THRESHOLDS,
      reason: "Local anchor (real_selection / file_text) — user named the content to use."
    };
  }

  // Layer 2 signal said the user explicitly named a single URL /
  // article in their command.
  if (signals?.explicit_single_url?.matched) {
    return {
      profile: RESEARCH_PROFILES.SINGLE_LOOKUP,
      ...SINGLE_LOOKUP_THRESHOLDS,
      reason: "explicit_single_url signal matched — user named a single URL / article."
    };
  }

  // Default for web-allowed: research-class. Multiple independent
  // sources are required.
  return {
    profile: RESEARCH_PROFILES.MULTI_SOURCE_RESEARCH,
    ...DEFAULT_MULTI_SOURCE_THRESHOLDS,
    reason: "Web tool reads allowed and no single-source anchor — research-class task."
  };
}
