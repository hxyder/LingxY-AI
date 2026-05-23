/**
 * UCA-077 P1-02: weak freshness detector.
 *
 * Captures weak time markers ("最近/当前/今天/current") that on their own
 * never imply external-data need. The policy resolver treats this as a
 * tracing-only signal — it never escalates a request to "required" by
 * itself, and does not even change the default ("forbidden") without a
 * companion signal (explicit_search, topic_hint, source_scope).
 *
 * Inherits the regex previously known as WEB_DATA_PATTERNS in
 * task-spec.mjs:183-186, stripped of entity nouns (天气/汇率/etc moved to
 * topic-hint) and search verbs (moved to explicit-search).
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "weak_freshness";

const PATTERN_ZH = /(最新|最近|今日|今天|今年|本周|这周|周末|下周|本月|明天|后天|明日|昨天|当前|目前|刚才|实时|变化|趋势|这阵子|这两天|这几天)/;
const PATTERN_EN = /\b(latest|recent|recently|today|tomorrow|yesterday|current|currently|now|presently|nowadays)\b/i;

/**
 * @param {string} text
 * @param {object} _contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket) {
  const matchZh = PATTERN_ZH.exec(text);
  const matchEn = PATTERN_EN.exec(text);
  const match = matchZh ?? matchEn;
  if (!match) return emptySignal(NAME);

  // P4-01 kind=hint: a freshness marker is a soft signal — "最近怎么样"
  // is chitchat; "最近的开源项目" pairs with explicit_search to request a
  // search. The detector observes the marker, never the intent.
  return {
    name: NAME,
    matched: true,
    strength: "weak",
    kind: "hint",
    evidence: [{
      type: "regex",
      source: NAME,
      matched: match[0],
      reason: "weak time marker — does not imply external data on its own"
    }],
    hint: {}
  };
}
