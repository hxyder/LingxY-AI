/**
 * UCA-077 P1-02 → P4-RQ E5: explicit search-verb detector.
 *
 * Neutral search verbs ("搜索/查一下/查询/google/bing"). One of the 6
 * structural hard signals both reference docs preserve as
 * deterministic regex. Post-E5 this signal escalates the resolver
 * to web=required (step 3 in the chain) — symmetry with
 * `explicit_external` (step 1 → required) and `explicit_no_search`
 * (step 0a → forbidden). All three are explicit user verbs about
 * the search axis, each respected verbatim.
 *
 * Local-anchor cases ("查一下我的文件" + file_paths) still short-
 * circuit at resolver step 2a (fact-local source-scope) before
 * reaching this rule, so the promotion does NOT auto-route local
 * search to the web.
 *
 * Inherits from the regex previously hard-coded as `isSearchOrNewsRequest` in
 * tool_using/agent-loop.mjs:338-341, with weak time markers and entity
 * keywords removed (those split out into weak-freshness / topic-hint).
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "explicit_search";

const PATTERN = /(搜索|搜一下|查找|查一下|查询|查阅|查阅一下|检索|帮我查|帮忙查|google\b|\bbing\b|百度一下|百度搜|\bsearch\s+(?:for|the)\b|look\s+(?:up|it\s+up))/i;

/**
 * @param {string} text
 * @param {object} _contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket) {
  const match = PATTERN.exec(text);
  if (!match) return emptySignal(NAME);

  // P4-01 kind=hint: the search verb is observable text (fact-like),
  // but the inference "search verb → user wants to consult external
  // sources" is conventional. Post-E5 the resolver maps strong →
  // `required` at step 3 (structural hard-signal symmetry with
  // explicit_external and explicit_no_search); local-anchor cases
  // still short-circuit at step 2a before reaching it.
  return {
    name: NAME,
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{
      type: "regex",
      source: NAME,
      matched: match[0],
      reason: "user used a neutral search verb"
    }],
    hint: {}
  };
}
