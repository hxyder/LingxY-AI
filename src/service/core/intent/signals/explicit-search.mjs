/**
 * UCA-077 P1-02: explicit search-verb detector.
 *
 * Neutral search verbs ("搜索/查一下/查询/google/bing"). One of the 6
 * structural hard signals both reference docs preserve as
 * deterministic regex. Today (post-E3 C1) it escalates web_search to
 * `optional`; the E5 follow-up tracks promoting it to `required`
 * — the user's directive: "explicit_search 是结构性 hard signal,
 * 应该升级到 external_search=required, 而不是只 optional 后等 SR".
 * Required-grade external intent currently also fires from
 * `explicit_external` (step 1) and `pending_offer` (step 0b).
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

  // P4-01 kind=hint: search verb observed; the LLM still has to judge
  // whether to actually call a tool (resolver maps strong → "optional",
  // not "required"). The verb is the marker, the action is conventional.
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
