/**
 * UCA-077 P4-RQ E1 (Layer 2 signal): user explicitly forbids web
 * browsing for this task.
 *
 * Explicit "不联网 / do not browse" must override the router and force
 * `external_search=forbidden`. Pre-this-signal there was no detector
 * for the user's explicit no-search constraint — even a literal
 * "不要联网，解释一下 X" with X being an external entity (weather / news)
 * would route to web=required because topic_hint won the chain.
 *
 * Design:
 *   - kind: "fact" — the user said this verbatim. SR's
 *     fact-conflict guard treats fact > hint > assumption, and the
 *     resolver gives this signal absolute priority over every
 *     other rule (including pending_offer's intent inheritance and
 *     explicit_external's required upgrade).
 *   - strength: "strong"
 *   - hint.value: "no_browse" — name kept distinct from the
 *     existing `none` source-scope value so consumers can tell the
 *     two apart.
 *
 * Patterns are conservative: only flag clear negative phrasings
 * with a search/browse/online verb on the same side. Silly false
 * positives ("搜不到答案", "I can't find anything") would not match
 * because the negation in those cases applies to the OUTCOME, not
 * to the user's instruction.
 */

import { emptySignal } from "./_signal-types.mjs";

const SIGNAL_NAME = "explicit_no_search";

// Chinese: 不/不要/别/无需/不必 + 联网|上网|搜索|查网|查询(网络)
const PATTERNS_CN = [
  /(不要|不|别|无需|不必|请勿|禁止)\s*(联网|上网|搜索|搜一下|查网|查网络|查询网络|搜网|检索网络)/i,
  /(不要|不|别|无需|不必|请勿|禁止)\s*(打开|访问|浏览|读取|抓取)?\s*(网页|页面|链接|URL|url|网站)/i,
  /(不要|不|别|无需|不必|请勿|禁止)[^。！？!?\n]{0,24}(打开|访问|浏览|读取|抓取)[^。！？!?\n]{0,16}(网页|页面|链接|URL|url|网站)/i,
  /(离线模式|只(?:用)?离线|仅(?:用)?离线|离线(?:回答|处理|即可|就行))/,
  /(不要|不|别|不允许)\s*(用|借助|通过|访问|使用)\s*(网络|网|互联网|因特网|互联网络)/i
];

// English: do/don't/no/without + browse/search/web/internet
const PATTERNS_EN = [
  /\b(do\s+not|don'?t|no|never|without)\s+(browse|browsing|search|searching|web\s+search|internet\s+search)\b/i,
  /\b(do\s+not|don'?t|no|never|without)\s+(open|visit|browse|access|fetch|read)\s+(the\s+)?(web\s+)?(page|url|link|site|website)\b/i,
  /\b(offline(\s+only)?|no\s+(web|internet|browsing|browser))\b/i,
  /\bwithout\s+(the\s+)?(internet|web|network|browser|browsing|searching)\b/i,
  /\b(don'?t|do\s+not)\s+(use|access)\s+(the\s+)?(internet|web|network)\b/i
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
    PATTERNS_EN.some((re) => re.test(text));

  if (!matched) return emptySignal(SIGNAL_NAME);
  if (isVisualOpenOnlyConstraint(text)) return emptySignal(SIGNAL_NAME);

  return {
    name: SIGNAL_NAME,
    matched: true,
    strength: "strong",
    kind: "fact",
    evidence: [
      { type: "regex", source: SIGNAL_NAME, reason: "user explicitly forbade web browsing for this task" }
    ],
    hint: { value: "no_browse" }
  };
}

export const EXPLICIT_NO_SEARCH_SIGNAL_NAME = SIGNAL_NAME;

function isVisualOpenOnlyConstraint(text) {
  const raw = String(text ?? "");
  if (!raw) return false;
  const forbidsOpening =
    /(不要|不|别|无需|不必|请勿|禁止)[^。！？!?\n]{0,16}(打开|弹出)[^。！？!?\n]{0,16}(网页|页面|浏览器页面|链接|URL|url|网站)/i.test(raw)
    || /\b(do\s+not|don'?t|no|never|without)\s+(open|launch)\s+(the\s+)?(browser|page|url|link|site|website)\b/i.test(raw);
  if (!forbidsOpening) return false;

  // Hard no-browse/no-fetch words still mean the user forbade external reads.
  if (/(联网|上网|搜索|查网|查网络|查询网络|检索网络|访问|读取|抓取|离线模式|离线回答|离线处理)/i.test(raw)) return false;
  if (/\b(browse|browsing|search|searching|web\s+search|internet\s+search|visit|access|fetch|read|offline|no\s+(web|internet|browsing|browser))\b/i.test(raw)) return false;

  // When the user asks us to return source/application links, "do not open"
  // means "do not navigate my browser"; background evidence fetching is still
  // required to satisfy the answer contract.
  return /(申请链接|原文链接|资料链接|来源链接|链接列|列出.*链接|给出.*链接|把.*链接.*列|links?\s+(only|listed|with|for)|application\s+links?|source\s+links?)/i.test(raw);
}
