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
 * Local-input cases ("查一下我的文件" + file_paths) are mixed-intent:
 * the resolver keeps them optional and lets SemanticRouter / the tool
 * planner decide whether the search target is local or external.
 *
 * Inherits from the regex previously hard-coded as `isSearchOrNewsRequest` in
 * tool_using/agent-loop.mjs:338-341, with weak time markers and entity
 * keywords removed (those split out into weak-freshness / topic-hint).
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "explicit_search";

const PATTERN = /(搜索|搜一下|(?:帮我|帮忙|请)?搜(?!集|身)|查找|查一下|查询|查阅|查阅一下|检索|帮我查|帮忙查|(?:帮我|帮忙|请)?找(?:到|一下)?[^。！？!?\n]{0,40}(?:链接|资料|来源|岗位|职位|工作|报告|report|评级|jobs?|sources?|links?)|google\b|\bbing\b|百度一下|百度搜|\bsearch\s+(?:for|the)\b|\bfind\s+(?:me\s+)?[^.?!\n]{0,50}\b(?:links?|sources?|jobs?|reports?)\b|look\s+(?:up|it\s+up))/i;

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
  // `required` at step 3 unless local input is present; local-input cases
  // stay optional so SR / the planner can disambiguate the search object.
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
