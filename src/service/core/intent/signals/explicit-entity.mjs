/**
 * UCA-077 P1-02: explicit external-entity detector.
 *
 * Captures topic words that strongly imply external time-sensitive data —
 * weather, stock movement, flights, exchange rates, news headlines. Lets
 * queries like "current weather in Raleigh" or "查一下 AVIS 为什么暴涨"
 * win against the default-forbidden rule when source_scope is "none".
 *
 * Conservative on purpose: this signal must NOT fire on benign words that
 * happen to contain an entity stem (e.g. "新闻应用" — but acceptable trade
 * because attached file context will short-circuit at source_scope first).
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "explicit_entity";

// UCA-077 P1-10: regex grew pragmatically to cover the external-research
// classes the agentic verifiers use as fixtures (geopolitics / equities /
// monetary policy). Add new classes here when a real test case demonstrates
// a missing class — do not add general words like "投资" that fire on chitchat.
// UCA-077 Phase 3 follow-up: cross-script compounds (English token + Chinese
// noun) must allow ZERO whitespace. Chinese writing convention does not put
// a space between an English acronym and a following Chinese word, so
// `ai\s+新闻` previously missed the natural form "AI新闻". Fix is \s* — accept
// any amount of whitespace including none. English-only compounds keep \s+
// because they always have spaces in English text.
const PATTERN = /(weather|forecast|天气|气温|气象|股价|股票走势|stock\s*price|share\s*price|美股|港股|纳指|nasdaq|s&p\s*500|dow\s*jones|大盘|暴涨|暴跌|涨停|跌停|涨幅|跌幅|为什么涨|为什么跌|航班|flight\s*(?:status|info)?|订机票|订票|机票价格|exchange\s*rate|汇率|外汇|hotel\s+(?:price|rate|booking)|酒店价格|订酒店|今日新闻|今天的新闻|最新新闻|新闻头条|头条新闻|breaking\s+news|news\s+about|今日要闻|时政要闻|实时新闻|ai\s*新闻|tech\s*新闻|ai\s*资讯|ai\s*头条|科技新闻|局势|形势|事态|大选|选情|election|geopolitic|油价|金价|crude\s*oil|gold\s*price|加息|降息|利率|interest\s*rate)/i;

/**
 * @param {string} text
 * @param {object} _contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket) {
  const match = PATTERN.exec(text);
  if (!match) return emptySignal(NAME);

  // P4-01 kind=hint: the entity word is observed (fact-like), but the
  // mapping "stock / weather / flight names → user wants fresh external
  // data" is a heuristic — "新闻应用" mentions news without wanting a
  // headline lookup. Hint, not fact.
  return {
    name: NAME,
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{
      type: "entity",
      source: NAME,
      matched: match[0],
      reason: "user named a high-freshness external entity"
    }],
    hint: { favors_external: true }
  };
}
