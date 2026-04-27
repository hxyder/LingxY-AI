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

/**
 * P4-RQ §19 #2 / K2: prompt-side budget block. Renders the
 * `research_quality` thresholds verbatim so the model sees the same
 * bar the validator (D3) enforces — "at least N sources from M
 * distinct publishers" instead of just the abstract principles.
 *
 * Why both: principles tell the model the SHAPE of good research;
 * budget tells it the NUMBERS the contract will check against. Pre-K2
 * the principles were the only prompt-side surface, so a model could
 * follow them in spirit (find a few sources) but still miss the
 * specific min_sources=3 / min_distinct_domains=2 bar and produce a
 * partial_success. With the numbers in the prompt, the model can
 * self-check before claiming completion.
 *
 * Gate logic (same shape as renderResearchPrinciples):
 *   - If `research_quality` is null/absent, no block (no thresholds
 *     to render).
 *   - If web policy is forbidden, no block (block is irrelevant —
 *     the model can't do web research anyway).
 *   - If user explicitly anchored to local content, no block (single
 *     source by user direction).
 *   - Otherwise render the profile-specific text:
 *       * multi_source_research → numerical bar with min_sources +
 *         min_distinct_domains
 *       * single_lookup        → "one authoritative source is fine"
 *       * deep_research        → stricter numerical bar (added by K3
 *         when that profile lands; this renderer reads min_sources /
 *         min_distinct_domains so the K3 code change is data-only)
 *
 * @param {object|null|undefined} toolPolicy
 * @param {object|null|undefined} contextSources
 * @param {object|null|undefined} researchQuality - task_spec.research_quality
 * @returns {string|null}
 */
export function renderResearchBudget(toolPolicy, contextSources, researchQuality) {
  if (!researchQuality || typeof researchQuality !== "object") return null;
  const mode = toolPolicy?.policy_groups?.external_web_read?.mode;
  if (mode !== "required" && mode !== "optional") return null;
  if (hasLocalAnchor(contextSources)) return null;

  const minSources = Number.isFinite(researchQuality.min_sources)
    ? researchQuality.min_sources : null;
  const minDomains = Number.isFinite(researchQuality.min_distinct_domains)
    ? researchQuality.min_distinct_domains : null;
  const digestOk = researchQuality.single_source_digest_satisfies === true;
  const profile = researchQuality.profile;

  if (profile === "single_lookup") {
    return [
      "Quality bar for this task:",
      "- A single authoritative source is sufficient (single-fact lookup or specific URL summary). You do not need to corroborate across publishers.",
      "- A single weekly-review / digest / roundup page is acceptable for this profile."
    ].join("\n");
  }

  // multi_source_research / deep_research / any other future numerical
  // profile — render whatever min_sources / min_distinct_domains the
  // task carries, falling back to the principles-only message when
  // the numbers are missing or non-finite.
  if (minSources === null || minDomains === null) return PRINCIPLES_BLOCK;

  const lines = [
    "Quality bar for this task:",
    `- This task requires at least ${minSources} independent source${minSources === 1 ? "" : "s"} from ${minDomains} distinct publisher${minDomains === 1 ? "" : "s"}. The success contract validates this — falling short is a partial_success, not a success.`,
    "- A single publisher (regardless of how many internal articles their page lists) counts as ONE source. nytimes.com homepage and nytimes.com/article-X are the same publisher."
  ];
  if (!digestOk) {
    lines.push(
      `- A single weekly-review / digest / roundup page does NOT satisfy this bar even if it contains many internal links. Find independent originals.`
    );
  }
  lines.push(
    `- Stop searching when the bar is met AND you can answer reliably. Do not keep searching for the sake of searching.`
  );
  return lines.join("\n");
}

export const RESEARCH_PRINCIPLES_TEXT = PRINCIPLES_BLOCK;
