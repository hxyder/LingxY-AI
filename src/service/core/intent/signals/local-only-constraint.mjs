/**
 * Structural local-only constraint detector.
 *
 * This signal captures explicit user constraints such as "only use the
 * attachment" / "仅基于这份文件". It is deliberately separate from
 * source_scope: source_scope says what input exists; this signal says the
 * user forbade external sources for this task.
 */

import { emptySignal } from "./_signal-types.mjs";

const SIGNAL_NAME = "local_only_constraint";

const LOCAL_MODALITY_CN = "(?:附件|文件|文档|资料|内容|图片|截图|表格|PDF|pdf|选区|页面|项目)";
const LOCAL_OBJECT_CN = `(?:这(?:一)?(?:份|个|篇|张|段)\\s*\\S{1,24}|上传(?:的)?\\s*(?:${LOCAL_MODALITY_CN}|\\S{1,24})|${LOCAL_MODALITY_CN}|本地(?:${LOCAL_MODALITY_CN})?|当前(?:${LOCAL_MODALITY_CN})?|所给(?:${LOCAL_MODALITY_CN}|\\S{1,24})?|提供(?:的)?(?:${LOCAL_MODALITY_CN}|\\S{1,24})?)`;
const LOCAL_MODALITY_EN = "(?:file|document|attachment|content|image|screenshot|pdf|spreadsheet|text|selection|page|project)";
const LOCAL_OBJECT_EN = `(?:this|the|attached|uploaded|provided|local|current)\\s+(?:${LOCAL_MODALITY_EN}|[a-z][\\w-]{0,30})`;

const PATTERNS_CN = [
  new RegExp(`(?:只|仅|仅仅|严格)\\s*(?:基于|依据|根据|参考|使用|用|看|读取|分析)?\\s*${LOCAL_OBJECT_CN}`, "i"),
  new RegExp(`(?:基于|依据|根据)\\s*${LOCAL_OBJECT_CN}\\s*(?:即可|就行|就好|为准)`, "i"),
  /(?:不要|不需要|不用|无需|别)\s*(?:参考|使用|看|查|搜索|检索)?\s*(?:外部|网上|网络|互联网|其他来源|额外资料|外部资料)/i
];

const PATTERNS_EN = [
  new RegExp(`\\b(?:only|just|solely|strictly)\\s+(?:use|using|from|based\\s+on|look\\s+at|read|analy[sz]e)?\\s*${LOCAL_OBJECT_EN}\\b`, "i"),
  new RegExp(`\\b(?:based|rely)\\s+only\\s+on\\s+${LOCAL_OBJECT_EN}\\b`, "i"),
  /\b(?:do\s+not|don't|no|without)\s+(?:use|reference|look\s+at|search|check)\s+(?:external|outside|web|internet|online)\s+(?:sources|material|data|info|information)\b/i
];

/**
 * @param {string} text
 * @param {object} [_contextPacket]
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket = {}) {
  if (typeof text !== "string" || text.length === 0) return emptySignal(SIGNAL_NAME);

  const matched =
    PATTERNS_CN.some((pattern) => pattern.test(text)) ||
    PATTERNS_EN.some((pattern) => pattern.test(text));

  if (!matched) return emptySignal(SIGNAL_NAME);

  return {
    name: SIGNAL_NAME,
    matched: true,
    strength: "strong",
    kind: "fact",
    evidence: [{
      type: "regex",
      source: SIGNAL_NAME,
      reason: "user explicitly constrained the task to local/provided material"
    }],
    hint: { value: "local_only", constraint: "local_only" }
  };
}

export const LOCAL_ONLY_CONSTRAINT_SIGNAL_NAME = SIGNAL_NAME;
