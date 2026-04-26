/**
 * UCA-077 P4-RQ C1 (research/search quality layer): the
 * "multi-source principles" prompt block.
 *
 * Background: today's success_contract for an external_web_read task
 * passes the moment ANY single web tool returned non-empty content —
 * including a single ScienceNet weekly-review page that lists 8
 * internal articles but represents one publisher / one domain. The
 * model declares the task done and emits a single-source summary,
 * which is wrong for news / research / current-events / comparison /
 * competitor / open-source-survey workloads.
 *
 * Design choice (per user direction): no hard threshold, no roundup
 * regex, no dedicated violation kinds. The model already understands
 * the concept of "independent sources"; we just have to TELL it to
 * apply that lens to search/research tasks. This module is the
 * coaching block, rendered into both the tool_using and agentic
 * system prompts when the task allows web reads AND the user did NOT
 * anchor to a single URL/file.
 *
 * Gate logic:
 *   - If `external_web_read` is `forbidden`, the block does not render
 *     (no web allowed; principles are irrelevant).
 *   - If the user explicitly anchored to local content
 *     (real_selection / file_text — see context-sources.mjs
 *     LOCAL_ANCHOR_KEYS), the block does not render — they asked us
 *     to summarize THIS thing, not research the open web.
 *   - Otherwise (web optional or required, no local anchor), the
 *     block renders verbatim.
 *
 * Suggestion-only at the prompt layer; no determinism downstream
 * relies on the model having read it.
 */

import { hasLocalAnchor } from "../../core/intent/context-sources.mjs";

const PRINCIPLES_BLOCK = `Source quality principles (search / research / current-events / comparison tasks):
- Multiple independent sources are better than one. One publisher (regardless of how many internal articles their page lists) counts as ONE source. A "weekly review", "digest", or "roundup" page is one source.
- You decide when the evidence you have gathered is sufficient. Stop when you can answer reliably; do not keep searching for the sake of searching.
- Cite the sources you used. If your answer rests on only one publisher / one domain, say so explicitly in the answer.
- For tasks that ask you to summarise a SPECIFIC article or URL the user gave you, a single source is fine — do not look for additional ones.
- For single-fact lookups (weather, stock price, exchange rate), one authoritative source is enough.`;

/**
 * @param {object|null|undefined} toolPolicy - the resolved tool_policy
 *   shape from `policy/tool-policy-resolver.mjs`. Reads
 *   `policy_groups.external_web_read.mode`.
 * @param {object|null|undefined} contextSources - the C1 classifier
 *   output stamped onto `context_packet.context_sources`. Reads
 *   `real_selection` / `file_text` via `hasLocalAnchor`.
 * @returns {string|null} the principles block to inject into the
 *   system prompt, or null when the gate says "not applicable".
 */
export function renderResearchPrinciples(toolPolicy, contextSources) {
  const mode = toolPolicy?.policy_groups?.external_web_read?.mode;
  if (mode !== "required" && mode !== "optional") return null;
  if (hasLocalAnchor(contextSources)) return null;
  return PRINCIPLES_BLOCK;
}

export const RESEARCH_PRINCIPLES_TEXT = PRINCIPLES_BLOCK;
