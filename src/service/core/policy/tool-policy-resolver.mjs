/**
 * Tool policy resolver — single source of truth for the external_web_read
 * mode (forbidden / optional / required) on a TaskSpec.
 *
 * Decision order:
 *   0a. explicit_no_search (kind=fact)         → forbidden  (hard)
 *   0b. explicit_single_url + inline URL       → required   (named source)
 *   0c. local_only_constraint (kind=fact)      → forbidden  (hard)
 *   0d. pending_offer external intent          → required   (hard)
 *   1.  explicit_external strong               → required   (hard)
 *   2a. provided URL/link context              → required   (exact source read)
 *   2c. source_scope + LOCAL, no search intent → forbidden  (local fallback)
 *   3.  explicit_search strong                 → required, or optional with local input
 *   4/5/6. default                             → see resolveDeterministicPolicy
 *
 * P5 — the LLM (SemanticRouter / IntentRoute) is the primary classifier;
 * this module is a guardrail. When no hard signal fires the default is
 * `optional`, not `forbidden`. SR (when present) drives the actual
 * mode via mergeSemanticRouterDecision; without SR the task stays on a
 * tool-capable executor and the LLM decides whether to reach for tools.
 *
 * The returned policy carries both the canonical
 * `policy_groups.external_web_read` entry (consumed by the registry
 * guard) and `<toolId>` per-tool entries (back-compat readers).
 */

import { toolsInGroup } from "./policy-groups.mjs";
import { deriveExternalWebPolicyFromIntentRoute } from "./evidence-policy.mjs";
import { PENDING_OFFER_EXTERNAL_INTENTS } from "../intent/signals/pending-offer.mjs";
import { extractLaunchAppCandidates, extractPureLaunchApp } from "../router/fast-path-router.mjs";

const LOCAL_SCOPES = new Set(["uploaded_files", "current_context", "local_project", "selection"]);
const PRIMARY_GROUP = "external_web_read";
const SR_OPERATIONAL_FAILURE_CODES = new Set(["timeout", "no_provider", "exception", "schema_invalid"]);

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
  const merged = mergeSemanticRouterDecision({ deterministicPolicy: det, signals, contextPacket, text });
  return mergeSemanticRouterOperationalFallback({
    deterministicPolicy: merged,
    signals,
    contextPacket,
    text
  });
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
  // P4-RQ E3 stage C1: topic_hint is observability-only at the
  // deterministic layer now (SR + EvidencePolicy merge owns topical
  // routing). Reference is left out of the destructuring; the
  // signal is still emitted by the detector and surfaced in the SR
  // prompt + decision trace. Re-add when a structural use re-emerges.
  const sourceScope = signals.source_scope;
  const explicitSearch = signals.explicit_search;
  const weakFreshness = signals.weak_freshness;
  const pendingOffer = signals.pending_offer;
  const explicitNoSearch = signals.explicit_no_search;
  const localOnlyConstraint = signals.local_only_constraint;
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

  // 0b. P4-RQ E2: explicit single-URL anchor. The user pasted a URL
  // alongside a summarise-style verb — the URL IS the user's anchor.
  // "Only based on this article <url>" is a source-bound request, not a
  // broad-web-search request; local_only_constraint must not block reading
  // the user-provided URL. explicit_no_search above still wins for literal
  // "do not browse / 不联网" wording.
  if (explicitSingleUrl?.matched && hasInlineUrl(text)) {
    return webSearchPolicy(
      "required",
      "User named a single specific URL/article — must fetch it via fetch_url_content (single_lookup task).",
      explicitSingleUrl.evidence
    );
  }

  // 0c. Local-only constraint. This is separate from source_scope:
  // source_scope says local evidence exists; local_only_constraint says
  // the user explicitly limited the task to that evidence.
  if (localOnlyConstraint?.matched) {
    return webSearchPolicy(
      "forbidden",
      "User explicitly constrained the task to local/provided material (local-only).",
      localOnlyConstraint.evidence
    );
  }

  // 0d. Pending-offer inheritance (P4-02.x C4). When the user replies with
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

  // 1. Explicit external opt-in — overrides local evidence, but not hard
  // no-search/local-only constraints handled above.
  if (explicitExternal?.matched && explicitExternal.strength === "strong") {
    return webSearchPolicy(
      "required",
      "User explicitly asked for an online/external lookup.",
      explicitExternal.evidence
    );
  }

  const scopeValue = sourceScope?.hint?.value ?? "none";
  const hasLocalScope = isLocalSourceScope(sourceScope);
  const neutralSearch = isStrongExplicitSearch(explicitSearch);

  // 2a. User-provided URL context. A URL selected by the user or handed to us
  // as a browser link is not a broad web search. It is the explicit source the
  // user pointed at, so exact-source reading is required unless the user also
  // gave a hard no-search/local-only constraint above. This prevents URL-only
  // selections from devolving into "I cannot browse" final answers: the task
  // contract now says to fetch that specific source or report the real fetch
  // failure. Text selections that merely carry page metadata stay optional.
  if (requiresExactUrlContextRead(contextPacket)) {
    return webSearchPolicy(
      "required",
      "User provided a URL/link as task context; exact-source reading is required via fetch_url_content, while broad web search remains unnecessary.",
      [{ type: "context", source: "context.url", reason: "provided URL/link source" }]
    );
  }

  // 2b. Local input fallback. Local evidence is not a hard no-web
  // constraint, but when the user did not ask to search, browse, or fetch a
  // URL, the deterministic fallback remains local. When a neutral search
  // verb is present ("查一下我的文件" vs "结合本地材料搜索外部机会"), fall through to
  // step 3 so SR / the planner can disambiguate the search object.
  if (hasLocalScope && !neutralSearch) {
    return webSearchPolicy(
      "forbidden",
      `Task is anchored to ${scopeValue}; no explicit external/search request requires web data.`,
      sourceScope.evidence
    );
  }

  // 3. (REMOVED in P4-RQ E3 stage C1) The previous "strong topic
  //    entity (weather/stock/news/etc.) + scope=none → required"
  //    branch routed entity-only queries deterministically. Per the
  //    E3 audit + user direction (Option C), topic-domain regex is
  //    now observability-only at the deterministic layer; the SR +
  //    EvidencePolicy merge owns this decision. When SR is
  //    unavailable the conservative fallback is `forbidden` —
  //    operators who turn SR off opt into the explicit-search
  //    escape hatch ("查一下 / search the web") rather than being
  //    auto-escalated by topic regex.
  //
  //    The signal still fires (kept for SR prompt + decision-trace
  //    observability); only its deterministic-required power is
  //    revoked here. `topicHint` reference kept above so future
  //    additions don't have to re-import.

  // 4. P4-RQ E5: explicit search verb (structural hard signal)
  //    → required unless local input makes the search object ambiguous.
  //    Symmetry with explicit_external (step 1 →
  //    required) and explicit_no_search (step 0a → forbidden) —
  //    all three are explicit user verbs about the search axis,
  //    each respected verbatim by the resolver.
  //
  //    Pre-E5 this returned `optional` and waited for SR to upgrade.
  //    The "wait for SR" default was wrong: when the user typed
  //    "查一下 / search for / google it", they declared intent. Local-input
  //    cases are the exception: "查一下我的文件" and
  //    "结合本地材料搜索外部机会"
  //    both contain local evidence, so deterministic policy stays optional
  //    until SR / the planner identifies the search object.
  if (explicitSearch?.matched && explicitSearch.strength === "strong") {
    if (hasLocalScope) {
      return webSearchPolicy(
        "optional",
        `User used a neutral search verb with local input (${scopeValue}); SemanticRouter or the tool planner must decide whether the search target is local or external.`,
        explicitSearch.evidence
      );
    }
    return webSearchPolicy(
      "required",
      "User used an explicit search verb (structural hard signal); web_search required.",
      explicitSearch.evidence
    );
  }

  // Default. Structural chitchat (≤3 chars) goes forbidden so fast can
  // answer immediately; otherwise optional so SR / tool_using can decide.
  const trailingEvidence = [];
  if (weakFreshness?.matched) trailingEvidence.push(...weakFreshness.evidence);
  trailingEvidence.push({ type: "default", source: "tool-policy-resolver", reason: "no companion signal" });
  if (String(text ?? "").trim().length <= 3) {
    return webSearchPolicy(
      "forbidden",
      "Structural chitchat (text ≤ 3 chars); deterministic baseline forbids external web.",
      trailingEvidence
    );
  }
  return webSearchPolicy(
    "optional",
    "No deterministic hard signal forbids/requires web; LLM-primary baseline is optional.",
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

function hasProvidedUrlContext(contextPacket = {}) {
  if (!contextPacket || typeof contextPacket !== "object") return false;
  const sourceType = String(contextPacket.source_type ?? contextPacket.sourceType ?? "");
  if (sourceType === "link" && isBareUrlString(contextPacket.url)) return true;
  if (sourceType === "text_selection" || sourceType === "selection") {
    return isBareUrlString(contextPacket.text)
      || isBareUrlString(contextPacket.selection_text)
      || isBareUrlString(contextPacket.selectionText)
      || isBareUrlString(contextPacket.selection_metadata?.selection_text);
  }
  return false;
}

function requiresExactUrlContextRead(contextPacket = {}) {
  if (!hasProvidedUrlContext(contextPacket)) return false;
  const sourceType = String(contextPacket.source_type ?? contextPacket.sourceType ?? "");
  if (sourceType === "link") return true;
  const text = String(contextPacket.text ?? contextPacket.selection_text ?? contextPacket.selectionText ?? "").trim();
  return isBareUrlString(text);
}

function isBareUrlString(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function webSearchPolicy(mode, reason, evidence) {
  return buildExternalWebReadPolicy(mode, reason, evidence);
}

function isStrongExplicitSearch(signal) {
  return Boolean(signal?.matched && signal.strength === "strong");
}

function isLocalSourceScope(signal) {
  return Boolean(signal?.matched && LOCAL_SCOPES.has(signal.hint?.value));
}

function hasHardLocalOnlyConstraint(signals) {
  return Boolean(
    signals?.explicit_no_search?.matched
    || signals?.local_only_constraint?.matched
  );
}

/**
 * P4-03 / P6: gate for SemanticRouter consultation.
 *
 * SemanticRouter is the primary semantic classifier. This gate skips it
 * only for narrow structural hard signals where the LLM cannot add useful
 * routing meaning or must not be asked to overrule the user/runtime fact:
 * local-only/no-search constraints, pure attachments with no search verb,
 * explicit online opt-in, and tiny chitchat, plus narrow side-effect actions
 * like a pure app launch.
 *
 * @param {{ signals: object, contextPacket?: object, text?: string }} input
 * @returns {boolean}
 */
export function shouldConsultSemanticRouter({ signals, contextPacket = {}, text = "" } = {}) {
  if (extractPureLaunchApp(text) || extractLaunchAppCandidates(text).length > 0) return false;

  const neutralSearch = isStrongExplicitSearch(signals?.explicit_search);
  if (Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0 && !neutralSearch) return false;
  if (Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0 && !neutralSearch) return false;

  const explicitExternal = signals?.explicit_external;
  if (explicitExternal?.matched && explicitExternal.strength === "strong") return false;

  const explicitNoSearch = signals?.explicit_no_search;
  if (explicitNoSearch?.matched && explicitNoSearch.kind === "fact") return false;

  const localOnlyConstraint = signals?.local_only_constraint;
  if (localOnlyConstraint?.matched && localOnlyConstraint.kind === "fact") return false;

  // Topic classification belongs to SR. The retired topic_hint
  // compatibility signal never skips SR; short topical requests need the
  // model-owned classifier instead of a deterministic topic-word table.
  //
  // P4-RQ E3 stage C1: text-length threshold lowered from 8 → 3.
  // The original 8-char threshold was tuned for English chitchat
  // ("hi", "thanks") AND was safe because entity regex was the
  // fast path for short topical queries (e.g. "今天天气" 5 chars).
  // With Option C the entity fast path is gone — short topical
  // queries MUST reach SR or get the conservative-forbidden
  // fallback. 3-char skip keeps obvious chitchat ("你好" 2,
  // "嗯" 1, "在吗" 2, "好的" 2, "对" 1) out of SR while letting
  // 4+ char real intent through.
  if (String(text ?? "").trim().length <= 3) return false;
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
 *   - When a hard no-search/local-only constraint is present → ignore SR.
 *   - When local input has no neutral search verb → ignore SR. Local input is
 *     evidence, not a policy constraint, but without a search/external signal
 *     the deterministic local fallback is settled.
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
  if (signals?.local_only_constraint?.matched) {
    return stampResearchHint(deterministicPolicy, sr);
  }

  const detMode = deterministicPolicy?.web_search_fetch?.mode;
  if (detMode === "required") return stampResearchHint(deterministicPolicy, sr);

  const sourceScope = signals?.source_scope;
  if (isLocalSourceScope(sourceScope) && !isStrongExplicitSearch(signals?.explicit_search)) {
    return stampResearchHint(deterministicPolicy, sr);
  }

  const evidencePolicy = deriveExternalWebPolicyFromIntentRoute(sr);
  const nextMode = evidencePolicy?.mode ?? sr.web_policy;
  const reason = evidencePolicy?.reason
    ?? `Semantic router suggested ${sr.web_policy} (confidence=${typeof sr.confidence === "number" ? sr.confidence.toFixed(2) : "?"}); deterministic baseline was ${detMode}.`;
  const merged = buildExternalWebReadPolicy(
    nextMode,
    reason,
    [
      ...(evidencePolicy?.evidence ?? []),
      { type: "semantic_router", source: "semantic_router", reason: String(sr.reason ?? "").slice(0, 200) },
      ...(deterministicPolicy?.web_search_fetch?.evidence ?? [])
    ]
  );
  return stampResearchHint(merged, sr);
}

/**
 * Fallback when SR didn't produce a judgement: covers operational
 * failures (rejection.code in SR_OPERATIONAL_FAILURE_CODES) and
 * "should have consulted but didn't". Upgrades default-rule/local-search
 * ambiguity to optional, but never overrides a hard no-search/local-only
 * constraint or a pure local-input task with no search verb.
 */
export function mergeSemanticRouterOperationalFallback({
  deterministicPolicy,
  signals,
  contextPacket = {},
  text = ""
} = {}) {
  if (contextPacket?.semantic_router_decision) return deterministicPolicy;
  const rejection = contextPacket?.semantic_router_rejection;
  const hasRejection = rejection && typeof rejection === "object";
  if (hasRejection && !SR_OPERATIONAL_FAILURE_CODES.has(rejection.code)) return deterministicPolicy;
  if (!shouldConsultSemanticRouter({ signals, contextPacket, text })) return deterministicPolicy;

  const detMode = deterministicPolicy?.policy_groups?.external_web_read?.mode
    ?? deterministicPolicy?.web_search_fetch?.mode;
  if (detMode !== "forbidden") return deterministicPolicy;

  const sourceScope = signals?.source_scope;
  if (hasHardLocalOnlyConstraint(signals)) {
    return deterministicPolicy;
  }
  if (isLocalSourceScope(sourceScope) && !isStrongExplicitSearch(signals?.explicit_search)) {
    return deterministicPolicy;
  }

  const cause = hasRejection ? `operational_failure:${rejection.code}` : "not_invoked";
  return buildExternalWebReadPolicy(
    "optional",
    `SemanticRouter did not produce a judgement (${cause}); LLM-primary fallback to optional.`,
    [
      { type: "semantic_router", source: "semantic_router", reason: cause },
      ...(deterministicPolicy?.web_search_fetch?.evidence ?? [])
    ]
  );
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
