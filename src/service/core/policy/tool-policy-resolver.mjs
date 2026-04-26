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
 * @param {{ signals: import("../intent/signals/_signal-types.mjs").SignalBundle["signals"], contextPacket?: object, text?: string }} input
 * @returns {ToolPolicy}
 */
export function resolveToolPolicy({ signals, contextPacket = {}, text = "" } = {}) {
  if (!signals) {
    throw new Error("resolveToolPolicy: signals bundle is required");
  }

  const det = resolveDeterministicPolicy({ signals, contextPacket, text });
  // P4-03: when an upstream async caller has stamped a SemanticRouter
  // decision onto contextPacket.semantic_router_decision and the request
  // is "ambiguous" (no strong deterministic signal), the LLM suggestion
  // can upgrade an otherwise default-forbidden policy. Non-ambiguous
  // cases ignore the stamped decision — rules are still authoritative.
  return mergeSemanticRouterDecision({ deterministicPolicy: det, signals, contextPacket, text });
}

/**
 * The 6-step deterministic chain. Extracted so P4-03 merge logic wraps it
 * cleanly. External callers always go through `resolveToolPolicy` above
 * — this internal export is only for test introspection (see
 * scripts/verify-resolver-merge.mjs).
 *
 * @param {{ signals: object, contextPacket: object, text: string }} input
 * @returns {ToolPolicy}
 */
export function resolveDeterministicPolicy({ signals, contextPacket = {}, text = "" } = {}) {
  if (!signals) {
    throw new Error("resolveDeterministicPolicy: signals bundle is required");
  }

  const explicitExternal = signals.explicit_external;
  const explicitEntity = signals.explicit_entity;
  const sourceScope = signals.source_scope;
  const explicitSearch = signals.explicit_search;
  const weakFreshness = signals.weak_freshness;
  const pendingOffer = signals.pending_offer;
  const explicitNoSearch = signals.explicit_no_search;
  const explicitSingleUrl = signals.explicit_single_url;

  // 0a. P4-RQ E1: explicit no-search override. Highest priority —
  // beats pending_offer's intent inheritance, explicit_external's
  // required upgrade, every entity rule. The user said verbatim "do
  // not browse / 不要联网"; the resolver must respect that even if
  // the rest of the request would otherwise trigger required.
  // SignalKind=fact (literal user statement), so SR's hard-fact-conflict
  // guard would also reject any LLM suggestion that conflicts here.
  if (explicitNoSearch?.matched) {
    return webSearchPolicy(
      "forbidden",
      "User explicitly forbade web browsing for this task (do-not-browse / 不联网).",
      explicitNoSearch.evidence
    );
  }

  // 0b. Pending-offer inheritance (P4-02.x C4). When the user replies with
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

  // 2a. P4-RQ E2: hard-fact local anchor (real_selection / file_text /
  // uploaded_files / local_project) — kind=fact source-scope. Web is
  // forbidden because the user has POINTED AT specific local content
  // and the inference is direct, not a pronoun. This split (fact
  // first, assumption later) is what lets explicit_single_url
  // override the ambiguous "这篇文章" pronoun case in step 2b without
  // weakening real-selection forbids.
  const scopeValue = sourceScope?.hint?.value ?? "none";
  if (sourceScope?.matched
      && sourceScope.kind === "fact"
      && LOCAL_SCOPES.has(scopeValue)) {
    return webSearchPolicy(
      "forbidden",
      `Task is anchored to ${scopeValue} (fact-kind); external web data is not appropriate.`,
      sourceScope.evidence
    );
  }

  // 2b. P4-RQ E2: explicit single-URL anchor. The user pasted a URL
  // alongside a summarise-style verb — the URL IS the user's anchor,
  // and the resolver must force web=required (NOT optional) so the
  // executor actually fetches the URL via fetch_url_content rather
  // than answering from training memory.
  //
  // Gate: explicit_single_url MATCHED *and* an actual URL is present
  // in the user command. The signal alone is too permissive — it
  // also fires for "总结这个页面" (current-context pronoun referring
  // to the user's open browser tab, no URL in the text). Without
  // structural URL evidence we cannot upgrade web=required, since
  // there is nothing for the executor to fetch. When there's no
  // URL, fall through to step 2c (assumption-local) which forbids,
  // letting the LLM summarise from whatever local context exists.
  //
  // This keeps the explicit_single_url signal broad (D1 research-
  // quality inference still consumes it for single_lookup profile)
  // while the deterministic web upgrade requires structural
  // evidence — the structural-vs-topical distinction the reference
  // docs require.
  if (explicitSingleUrl?.matched && hasInlineUrl(text)) {
    return webSearchPolicy(
      "required",
      "User named a single specific URL/article — must fetch it via fetch_url_content (single_lookup task).",
      explicitSingleUrl.evidence
    );
  }

  // 2c. Assumption-kind local anchor — pronoun-style "这个/这篇" without
  // a URL. Without an explicit external signal to override, treat
  // as local. Same forbid as before; just split out from the
  // fact-kind case above.
  if (sourceScope?.matched
      && sourceScope.kind === "assumption"
      && LOCAL_SCOPES.has(scopeValue)) {
    return webSearchPolicy(
      "forbidden",
      `Task is anchored to ${scopeValue} (assumption-kind, e.g. "这个/这篇" pronoun); external web data is not appropriate.`,
      sourceScope.evidence
    );
  }

  // 3. Strong external entity (weather, stock, flight…) AND scope is "none"
  //    or unknown — i.e. the user did not anchor the request to local data.
  if (explicitEntity?.matched && explicitEntity.strength === "strong" && scopeValue === "none") {
    return webSearchPolicy(
      "required",
      `User named a high-freshness external entity ("${firstMatch(explicitEntity)}") with no local source attached.`,
      [...explicitEntity.evidence, { type: "context", source: "source_scope", reason: "scope=none" }]
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

/**
 * P4-RQ E2: structural URL detection. Used by the explicit_single_url
 * resolver branch to gate web=required upgrades on actual URL
 * presence in the user command. NOT a topic regex — http(s):// is a
 * structural surface signal exactly like the reference docs list as
 * keep-as-regex.
 */
function hasInlineUrl(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return /https?:\/\/\S+/i.test(text);
}

function webSearchPolicy(mode, reason, evidence) {
  return buildExternalWebReadPolicy(mode, reason, evidence);
}

/**
 * P4-03: ambiguity gate for SemanticRouter consultation.
 *
 * The deterministic resolver runs 6 fast-path rules over regex-derived
 * signals. When NONE of those rules fire decisively (no attached files,
 * no `explicit_external` strong, no strong `explicit_entity`, command
 * long enough to carry intent), the request is "ambiguous" — the
 * deterministic baseline would default to forbidden, but the user may
 * actually want web reading. SemanticRouter is consulted ONLY for those
 * ambiguous cases; fast-path tasks never trigger an LLM call (per main
 * plan §12.10 latency budget: < 5ms when fast-path hits).
 *
 * @param {{ signals: object, contextPacket?: object, text?: string }} input
 * @returns {boolean}
 */
export function shouldConsultSemanticRouter({ signals, contextPacket = {}, text = "" } = {}) {
  if (Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0) {
    return false;
  }
  if (Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0) {
    return false;
  }
  const explicitExternal = signals?.explicit_external;
  if (explicitExternal?.matched && explicitExternal.strength === "strong") return false;
  const explicitEntity = signals?.explicit_entity;
  if (explicitEntity?.matched && explicitEntity.strength === "strong") return false;
  if (String(text ?? "").trim().length <= 8) return false;
  return true;
}

/**
 * P4-03: merge an upstream-stamped SemanticRouter decision into the
 * deterministic policy. Contract:
 *
 *   - When `contextPacket.semantic_router_decision` is absent → return
 *     `deterministicPolicy` unchanged.
 *   - When `shouldConsultSemanticRouter` returns false (request is NOT
 *     ambiguous; rules fired strongly) → ignore the SR decision. Rules
 *     win when present (main plan §12.7 invariant: "required 永远尊重
 *     规则").
 *   - When deterministic mode is `required` → ignore SR. Defense-in-
 *     depth on top of the ambiguity gate.
 *   - When `signals.source_scope.kind === "fact"` and the scope is
 *     local → ignore SR. Hard facts beat soft inferences (P4-02 §18.3).
 *   - Otherwise → use the SR-suggested `web_policy` as the new mode.
 *     SemanticRouter has already filtered low-confidence and
 *     fact-conflict cases (it would have returned a rejection there);
 *     any decision stamped here has crossed the 0.6 confidence
 *     threshold and passed the conflict check.
 *
 * The merged policy is built via `buildExternalWebReadPolicy` so the
 * group + per-toolId expansion + invariants are uniform with the
 * deterministic emission. SR's `reason` is wrapped with the deterministic
 * baseline for trace clarity.
 *
 * @param {{
 *   deterministicPolicy: ToolPolicy,
 *   signals: object,
 *   contextPacket?: object,
 *   text?: string
 * }} input
 * @returns {ToolPolicy}
 */
export function mergeSemanticRouterDecision({
  deterministicPolicy,
  signals,
  contextPacket = {},
  text = ""
} = {}) {
  const sr = contextPacket?.semantic_router_decision;
  if (!sr || typeof sr !== "object" || !sr.web_policy) return deterministicPolicy;
  if (!shouldConsultSemanticRouter({ signals, contextPacket, text })) return deterministicPolicy;

  // P4-RQ E1: hard fact "no search" beats every SR suggestion. The
  // user told us not to browse — SR doesn't get to override that.
  if (signals?.explicit_no_search?.matched) {
    return stampResearchHint(deterministicPolicy, sr);
  }

  const detMode = deterministicPolicy?.web_search_fetch?.mode;
  if (detMode === "required") return stampResearchHint(deterministicPolicy, sr);

  const sourceScope = signals?.source_scope;
  if (sourceScope?.matched
      && sourceScope.kind === "fact"
      && LOCAL_SCOPES.has(sourceScope.hint?.value)) {
    return stampResearchHint(deterministicPolicy, sr);
  }

  const reason = `Semantic router suggested ${sr.web_policy} (confidence=${typeof sr.confidence === "number" ? sr.confidence.toFixed(2) : "?"}); deterministic baseline was ${detMode}.`;
  const merged = buildExternalWebReadPolicy(
    sr.web_policy,
    reason,
    [
      { type: "semantic_router", source: "semantic_router", reason: String(sr.reason ?? "").slice(0, 200) },
      ...(deterministicPolicy?.web_search_fetch?.evidence ?? [])
    ]
  );
  return stampResearchHint(merged, sr);
}

/**
 * P4-RQ C2: stamp the SR's research_depth suggestion onto the
 * resolved tool_policy as `research_hint`. Suggestion-only — no
 * downstream determinism rests on it; the prompt-builder helper
 * `renderResearchPrinciples` reads `tool_policy.policy_groups.external_web_read.mode`,
 * not this hint. Two roles for `research_hint`:
 *   1. Decision-trace observability — the operator sees what the SR
 *      thought when reviewing routing decisions.
 *   2. Future fork point — when prompt-builder grows depth-specific
 *      principle variants (§19 follow-up), this is the field it reads.
 *
 * Stamps on every merge-result path, including the "deterministic
 * baseline already correct" case. Cloning the policy to avoid mutating
 * the deterministic input — important when the caller's policy object
 * is also captured in DecisionTrace.
 */
function stampResearchHint(policy, sr) {
  const depth = sr?.research_depth;
  if (typeof depth !== "string" || depth.length === 0) return policy;
  return { ...policy, research_hint: depth };
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
