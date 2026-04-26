/**
 * UCA-077 P4-02.x C4 (plan p4-03-p4-02-goofy-forest): pending-offer signal.
 *
 * Detects the "user is replying with a short affirmative to an offer the
 * assistant just made" pattern. Both halves must hold:
 *
 *   1. The current `text` is a short-affirmative reply
 *      (`需要`, `继续`, `是的`, `yes`, `ok`, `好的`, etc.).
 *
 *   2. The LAST assistant turn in `contextPacket.selection_metadata
 *      .conversation_turns` matches an offer pattern
 *      (`想.*?(看|要|查|获取|抓取|帮你).*?吗?[？?]\s*$` or English
 *      equivalent) and that offer mentions a high-freshness external
 *      entity (weather / news / stock / flight / etc.).
 *
 * When both hold, we emit `kind: "hint"` with `hint.pending_intent` =
 * the inferred entity. The policy resolver consumes this to upgrade
 * `external_web_read` to `required` (see resolver short-circuit at the
 * head of the priority chain), so "需要" after "想看天气吗？" routes to
 * tool_using with web=required instead of fast with web=forbidden.
 *
 * Why detector-side dual-check (not resolver-side):
 *
 *   `resolveToolPolicy({ signals, contextPacket })` does NOT receive
 *   `userText`. Per plan §18.2 review, the cleanest fix is to make this
 *   detector own both conditions; resolver just reads
 *   `signals.pending_offer.matched`. Resolver signature stays unchanged.
 *
 * Heuristic-only this round. Plan §19 tracks a follow-up: structured
 * `pending_offer` metadata emitted by the assistant turn itself
 * (cleaner long-term, survives paraphrase, but doubles scope).
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "pending_offer";

// Step 1 — short-affirmative regex over the user's current text.
// Tight: must match the WHOLE trimmed text. Avoids matching "我需要…"
// (the user is making a new request, not affirming an offer).
const SHORT_AFFIRMATIVE = /^(需要|要|继续|可以|好的?|嗯|是的?|对|ok|okay|yes|sure|please)\s*[!.！。]?$/i;

// Step 2 — the LAST assistant turn must match an offer pattern. Two
// dialects supported:
//   Chinese: "想 + ... + (看|要|查|获取|抓取|帮你) + ... + 吗?" with question mark
//   English: "want / need / like / interested / shall I / do you want
//             ... ? "
const OFFER_PATTERN_ZH = /(想要?|要不要?|需要(?:我)?(?:帮)?|是否(?:需要|要))[\s\S]{0,60}?(看|查(?:阅|找|看)?|获取|抓取|拉取|读取|帮你|为你|给你)[\s\S]{0,40}?(吗?\s*[？?]|呢\s*[？?])/;
const OFFER_PATTERN_EN = /\b(want|need|like|interested|shall\s+i|should\s+i|do\s+you\s+(?:want|need))\b[\s\S]{0,80}?\?\s*$/i;

// Step 3 — entity detection over the offer text. Reuses the same word
// list as explicit-entity.mjs but kept inline so this signal stays
// self-contained (intent layer doesn't import other signals — they're
// orthogonal observations).
const PENDING_INTENT_RULES = Object.freeze([
  { intent: "weather",       pattern: /(weather|forecast|天气|气温|气象)/i },
  { intent: "news",          pattern: /(news|新闻|时事|要闻|今日要闻|breaking\s+news)/i },
  { intent: "stock",         pattern: /(stock|股(价|票|市)|大盘|纳指|nasdaq|dow|s&p\s*500|股票走势|share\s*price)/i },
  { intent: "flight",        pattern: /(flight|航班|机票|订机票)/i },
  { intent: "exchange_rate", pattern: /(exchange\s*rate|汇率|外汇)/i },
  { intent: "geopolitics",   pattern: /(局势|形势|事态|election|geopolitic)/i }
]);

function inferPendingIntent(assistantText) {
  for (const rule of PENDING_INTENT_RULES) {
    if (rule.pattern.test(assistantText)) return rule.intent;
  }
  return null;
}

function findLastAssistantTurn(contextPacket) {
  const turns = contextPacket?.selection_metadata?.conversation_turns;
  if (!Array.isArray(turns) || turns.length === 0) return null;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.role === "assistant" && typeof turn.content === "string" && turn.content.trim().length > 0) {
      return turn;
    }
  }
  return null;
}

/**
 * @param {string} text
 * @param {object} contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, contextPacket = {}) {
  const command = String(text ?? "").trim();
  if (!command) return emptySignal(NAME);
  if (!SHORT_AFFIRMATIVE.test(command)) return emptySignal(NAME);

  const lastAssistant = findLastAssistantTurn(contextPacket);
  if (!lastAssistant) return emptySignal(NAME);

  const assistantText = lastAssistant.content;
  const isOffer = OFFER_PATTERN_ZH.test(assistantText) || OFFER_PATTERN_EN.test(assistantText);
  if (!isOffer) return emptySignal(NAME);

  const pendingIntent = inferPendingIntent(assistantText);
  if (!pendingIntent) return emptySignal(NAME);

  // Both halves hold. Emit a hint-kind signal so SemanticRouter knows
  // this is conventional inference (regex over assistant phrasing) not
  // a hard fact.
  const snippet = assistantText.length > 200
    ? `${assistantText.slice(0, 200)}…`
    : assistantText;
  return {
    name: NAME,
    matched: true,
    strength: "strong",
    kind: "hint",
    evidence: [{
      type: "context",
      source: NAME,
      matched: command,
      reason: `short-affirmative reply ("${command}") to assistant offer about ${pendingIntent}`
    }],
    hint: { pending_intent: pendingIntent, raw: snippet }
  };
}

/** Exported for resolver short-circuit. */
export const PENDING_OFFER_EXTERNAL_INTENTS = Object.freeze(new Set([
  "weather", "news", "stock", "flight", "exchange_rate", "geopolitics"
]));
