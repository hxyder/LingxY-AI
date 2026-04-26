/**
 * UCA-077 P1-02: explicit external-source marker.
 *
 * Captures phrases that explicitly route the request to the external web
 * (e.g. "网上 / online / 外网 / 联网查"). When this fires, source_scope
 * cannot keep web_search forbidden — the user's opt-in beats local context.
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "explicit_external";

const PATTERN = /(网上|网络上|外网|联网查|去网上查|上网查|网上搜|搜一下网上|外部资料|互联网上|online\s+(?:search|lookup)?|on\s+the\s+(?:web|internet)|web\s*上)/i;

/**
 * @param {string} text
 * @param {object} _contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(text, _contextPacket) {
  const match = PATTERN.exec(text);
  if (!match) return emptySignal(NAME);

  return {
    name: NAME,
    matched: true,
    strength: "strong",
    evidence: [{
      type: "explicit_phrase",
      source: NAME,
      matched: match[0],
      reason: "user explicitly asked for external/online lookup"
    }],
    hint: { source_scope: "external_world" }
  };
}
