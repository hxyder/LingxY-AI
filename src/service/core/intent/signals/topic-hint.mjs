/**
 * Compatibility placeholder for the retired `topic_hint` signal.
 *
 * Topic-word regex belongs in the SemanticRouter, not in deterministic
 * signal extraction. Keeping the signal name avoids breaking stored traces
 * and older callers that still expect a `signals.topic_hint` key, but the
 * detector deliberately emits an empty signal for all user text.
 */

import { emptySignal } from "./_signal-types.mjs";

const NAME = "topic_hint";

/**
 * @param {string} _text
 * @param {object} _contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(_text, _contextPacket) {
  return emptySignal(NAME);
}
