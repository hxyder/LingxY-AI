/**
 * UCA-077 P1-03: Tool policy resolver — single source of truth for whether
 * external web reading is forbidden / optional / required for the current
 * task.
 *
 * Replaces the three independent decision points that previously voted
 * inconsistently:
 *   - task-spec.mjs:183-191  WEB_DATA_PATTERNS → needs_current_web_data flag
 *   - task-spec.mjs:425-430  applyHardenedRules pushed web_search_fetch step
 *   - tool_using/agent-loop.mjs:31-39 / 681-696 / 724-727  isSearchOrNewsRequest
 *
 * Inputs are signals (built by intent/signals/) plus the request context.
 * Output carries the decision plus full evidence for tracing.
 *
 * Decision priority (short-circuit in order):
 *   1. explicit_external (strong)             → required
 *   2. explicit_entity (strong) + scope=none  → required
 *   3. source_scope ∈ local set               → forbidden
 *   4. explicit_search (strong)               → optional
 *   5. weak_freshness (weak)                  → optional
 *   6. default                                → forbidden
 *
 * The resolver never returns "required" off a weak signal alone — that was
 * the root cause of the "最近这个框架很慢 → 误联网" symptom.
 *
 * UCA-077 P4-00 (Issue β / RR-03): the resolver decides at the policy-group
 * level (currently only `external_web_read`) and emits TWO views of the same
 * decision in the returned policy:
 *
 *   1. `tool_policy.policy_groups.external_web_read` — canonical group entry
 *      consumed by the registry-level policy guard for capability-based
 *      forbidden checks.
 *   2. `tool_policy.<toolId>` for every member of the group — back-compat
 *      with consumers (agent-loop, executor-resolver, success-contract,
 *      task-contract, agentic prompt-builder) that read
 *      `tool_policy.web_search_fetch.mode` directly.
 *
 * Both views carry the same `mode`, `reason`, `evidence`, and a
 * `policy_group` tag for traceability. The single source of truth for which
 * toolIds belong to which group lives in `policy-groups.mjs`.
 */

import { toolsInGroup } from "./policy-groups.mjs";
import { PENDING_OFFER_EXTERNAL_INTENTS } from "../intent/signals/pending-offer.mjs";

const LOCAL_SCOPES = new Set(["uploaded_files", "current_context", "local_project", "selection"]);
const PRIMARY_GROUP = "external_web_read";

/**
 * @typedef {Object} ToolPolicy
 * @property {Object} web_search_fetch
 * @property {"forbidden"|"optional"|"required"} web_search_fetch.mode
 * @property {string} web_search_fetch.reason
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} web_search_fetch.evidence
 */

/**
 * @param {{ signals: import("../intent/signals/_signal-types.mjs").SignalBundle["signals"], contextPacket?: object }} input
 * @returns {ToolPolicy}
 */
export function resolveToolPolicy({ signals, contextPacket: _contextPacket = {} } = {}) {
  if (!signals) {
    throw new Error("resolveToolPolicy: signals bundle is required");
  }

  const explicitExternal = signals.explicit_external;
  const explicitEntity = signals.explicit_entity;
  const sourceScope = signals.source_scope;
  const explicitSearch = signals.explicit_search;
  const weakFreshness = signals.weak_freshness;
  const pendingOffer = signals.pending_offer;

  // 0. Pending-offer inheritance (P4-02.x C4). When the user replies with
  // a short affirmative ("需要", "继续", "yes") to an assistant offer
  // that was about a high-freshness external entity (weather / news /
  // stock / flight / …), upgrade the policy to `required`. The
  // pending-offer detector encapsulates both halves of the check
  // (current text is a short affirmative + last assistant turn made an
  // external-entity offer), so the resolver only reads its `matched`
  // flag and the inferred intent. Bug 2 reproduction: "需要" after a
  // weather offer used to route to fast (web=forbidden) because the
  // 2-char text matched no signal of its own.
  if (pendingOffer?.matched
      && PENDING_OFFER_EXTERNAL_INTENTS.has(pendingOffer.hint?.pending_intent)) {
    return webSearchPolicy(
      "required",
      `Inherits previous offer (pending_intent=${pendingOffer.hint.pending_intent}); user replied with a short affirmative.`,
      pendingOffer.evidence
    );
  }

  // 1. Explicit external opt-in — overrides everything, including local scope.
  if (explicitExternal?.matched && explicitExternal.strength === "strong") {
    return webSearchPolicy(
      "required",
      "User explicitly asked for an online/external lookup.",
      explicitExternal.evidence
    );
  }

  // 2. Strong external entity (weather, stock, flight…) AND scope is "none"
  //    or unknown — i.e. the user did not anchor the request to local data.
  const scopeValue = sourceScope?.hint?.value ?? "none";
  if (explicitEntity?.matched && explicitEntity.strength === "strong" && scopeValue === "none") {
    return webSearchPolicy(
      "required",
      `User named a high-freshness external entity ("${firstMatch(explicitEntity)}") with no local source attached.`,
      [...explicitEntity.evidence, { type: "context", source: "source_scope", reason: "scope=none" }]
    );
  }

  // 3. Local source — uploaded files, current context, local project, or
  //    a selection. The user is asking about something local; do not search.
  if (sourceScope?.matched && LOCAL_SCOPES.has(scopeValue)) {
    return webSearchPolicy(
      "forbidden",
      `Task is anchored to ${scopeValue}; external web data is not appropriate.`,
      sourceScope.evidence
    );
  }

  // 4. Neutral search verb — user explicitly invited a search but did not
  //    pin it to external data. Let downstream LLM judge whether to actually
  //    call web_search.
  if (explicitSearch?.matched && explicitSearch.strength === "strong") {
    return webSearchPolicy(
      "optional",
      "User used a neutral search verb; web_search is allowed but not required.",
      explicitSearch.evidence
    );
  }

  // 5. Default — including weak_freshness on its own. The original
  //    intuition was that "最近 / current" should let the LLM decide whether
  //    to search, but in practice that escalates plain chitchat ("最近怎么样")
  //    onto an executor that can call tools, with no useful entity to search
  //    for. We keep the weak_freshness signal in `evidence` (for tracing)
  //    but the policy stays forbidden until an explicit_search,
  //    explicit_entity, or explicit_external companion appears.
  const trailingEvidence = [];
  if (weakFreshness?.matched) trailingEvidence.push(...weakFreshness.evidence);
  trailingEvidence.push({ type: "default", source: "tool-policy-resolver", reason: "no companion signal" });
  return webSearchPolicy(
    "forbidden",
    weakFreshness?.matched
      ? "Weak freshness marker without a search verb / external entity / online phrase — treated as chitchat."
      : "No external-data signal detected.",
    trailingEvidence
  );
}

function webSearchPolicy(mode, reason, evidence) {
  return buildExternalWebReadPolicy(mode, reason, evidence);
}

/**
 * Build a fully-expanded tool_policy fragment for a group-level decision
 * about external web reading. Public so other code paths that decide to
 * forbid/require external web reads (e.g. task-spec's connector-domain
 * branch) emit the same shape — and therefore receive the same enforcement
 * — as the resolver itself.
 *
 * The output contains:
 *   - `policy_groups.external_web_read` — canonical group entry consumed
 *     by the registry policy guard for capability-based forbidden checks
 *     and rendered in the agentic prompt as "applies_to: …".
 *   - `tool_policy.<toolId>` for every member of the group — back-compat
 *     for consumers that still read e.g. `tool_policy.web_search_fetch`.
 *
 * Each entry is a fresh object so a future per-tool override can mutate
 * one without affecting siblings.
 *
 * @param {"forbidden"|"optional"|"required"} mode
 * @param {string} reason
 * @param {import("../intent/signals/_signal-types.mjs").Evidence[]} evidence
 */
export function buildExternalWebReadPolicy(mode, reason, evidence) {
  const baseFields = {
    mode,
    reason,
    evidence: Array.isArray(evidence) ? evidence : [],
    policy_group: PRIMARY_GROUP
  };
  const policy = {
    policy_groups: {
      [PRIMARY_GROUP]: { ...baseFields }
    }
  };
  for (const toolId of toolsInGroup(PRIMARY_GROUP)) {
    policy[toolId] = { ...baseFields };
  }
  return policy;
}

function firstMatch(signal) {
  return signal?.evidence?.[0]?.matched ?? "";
}
