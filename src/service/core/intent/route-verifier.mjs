/**
 * route-verifier.mjs — C18 #C' (codex round-1 design)
 *
 * Replaces the topic-regex-driven `stable-qa-override.mjs` with a
 * structured route verifier: an out-of-band cheap LLM ("router_judge")
 * audits SR's policy decision against the user's actual intent +
 * structural signals, and emits a schema-bound `accept|reject|abstain`
 * with corrected fields when it rejects.
 *
 * ## Why this layer exists
 *
 * `stable-qa-override.mjs` patched SR mistakes by maintaining two
 * topic dictionaries (LEARNING_VERB_RE: 18 verbs, FRESHNESS_TOPIC_
 * WORD_RE: 22 nouns). The user's `feedback_no_test_case_patches.md`
 * memory explicitly rejected this pattern: hard signals must remain
 * narrow and structural (URL / attachment / explicit search verb /
 * explicit no-search / time-sensitive / external side effect /
 * destructive action). Topic regex is reserved for SR itself, not
 * for sibling rules.
 *
 * The verifier is a framework-level fix: instead of growing the
 * dictionary every time a new failure case shows up, a different
 * model family (Anthropic Haiku 4.5 — uncorrelated errors with the
 * DeepSeek SR) audits SR output against the structural signals SR
 * already saw, plus the same calibration examples we baked into SR's
 * prompt. New failure cases are corrected by the judge generalizing
 * from examples, not by us editing a regex.
 *
 * ## Schema (codex round-1 design)
 *
 * The judge MUST emit:
 *   {
 *     verdict: "accept" | "reject" | "abstain",
 *     corrected_web_policy?: "required" | "optional" | "forbidden",
 *     corrected_source_mode?: "no_external" | "provided_context" | ...,
 *     confidence: number in [0, 1],
 *     reason: string (operator-facing),
 *     evidence_basis: string[]  // which structural signals / phrases
 *                                // grounded the verdict
 *   }
 *
 * Free-text "is this reasonable?" is explicitly NOT acceptable —
 * this contract forces the judge to identify which structural
 * signals support its verdict so we can audit the audits.
 *
 * ## Fallback rules (codex round-1)
 *
 *   - Hard structural signals always dominate: explicit no-search /
 *     local-only / destructive / side-effect → conservative path,
 *     never overridden by the judge.
 *   - judge timeout / no key / schema invalid → mark
 *     `sr_judge_unavailable`, never throw.
 *   - SR=required + no hard external signal + judge unavailable
 *     → degrade to `optional` (avoid unverified mandatory web).
 *   - SR=required + hard external signal (URL / explicit search /
 *     time-sensitive) → keep `required` regardless of judge.
 *   - SR=forbidden + judge unavailable → keep `forbidden` (unless
 *     deterministic layer already raised hard external signals).
 *
 * ## Modes
 *
 * Created with `mode: "shadow"` by default. In shadow mode the
 * verifier runs and logs its diff vs SR but does NOT change the
 * decision — caller still gets SR's original output. Switching to
 * `enforce` mode lets the verdict actually patch the decision.
 * The plan: shadow for a corpus run cycle, validate diff stability,
 * then enforce.
 */

export const VERIFIER_MODES = Object.freeze(["off", "shadow", "enforce"]);
export const DEFAULT_VERIFIER_MODE = "shadow";

const VALID_VERDICTS = new Set(["accept", "reject", "abstain"]);
const VALID_WEB_POLICIES = new Set(["required", "optional", "forbidden"]);
const VALID_SOURCE_MODES = new Set([
  "no_external",
  "provided_context",
  "single_lookup",
  "multi_source_research",
  "deep_research"
]);

/**
 * Detect "hard structural signals" that the judge cannot override.
 * The judge's verdict only takes effect when none of these dominate;
 * otherwise the SR-or-deterministic decision is final.
 */
export function detectHardStructuralSignals(signals = {}) {
  const hard = [];
  if (signals?.explicit_search?.matched) hard.push("explicit_search");
  if (signals?.explicit_external?.matched) hard.push("explicit_external");
  if (signals?.explicit_no_search?.matched) hard.push("explicit_no_search");
  if (signals?.explicit_single_url?.matched) hard.push("explicit_single_url");
  if (signals?.explicit_local_only?.matched) hard.push("explicit_local_only");
  if (signals?.attachment_present?.matched) hard.push("attachment_present");
  if (signals?.destructive_action?.matched) hard.push("destructive_action");
  if (signals?.external_side_effect?.matched) hard.push("external_side_effect");
  return hard;
}

function validateJudgePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!VALID_VERDICTS.has(payload.verdict)) return null;
  if (typeof payload.confidence !== "number"
      || payload.confidence < 0
      || payload.confidence > 1) {
    return null;
  }
  if (typeof payload.reason !== "string" || !payload.reason.trim()) return null;
  if (payload.verdict === "reject") {
    // Reject must specify at least one corrected field.
    const hasWebPolicy = payload.corrected_web_policy !== undefined
      ? VALID_WEB_POLICIES.has(payload.corrected_web_policy)
      : false;
    const hasSourceMode = payload.corrected_source_mode !== undefined
      ? VALID_SOURCE_MODES.has(payload.corrected_source_mode)
      : false;
    if (!hasWebPolicy && !hasSourceMode) return null;
  }
  return payload;
}

/**
 * Apply the judge's verdict to the SR decision, respecting hard
 * structural signals and the configured mode.
 *
 * Returns:
 *   {
 *     applied: boolean,         // did the verdict actually change the decision?
 *     decision: object,         // final decision (== SR decision in shadow / abstain / accept)
 *     diff: object|null,        // shape of the change, for shadow logging
 *     reason: string,           // why we did or didn't apply
 *     mode: "off"|"shadow"|"enforce",
 *     judge_status: "ok"|"unavailable"|"abstain"|"hard_signal_override"|"invalid_payload"
 *   }
 */
export function applyJudgeVerdict({
  decision,
  signals = {},
  judgePayload = null,
  judgeError = null,
  mode = DEFAULT_VERIFIER_MODE
} = {}) {
  if (!VERIFIER_MODES.includes(mode)) {
    throw new Error(`route-verifier: invalid mode '${mode}'`);
  }
  if (!decision || typeof decision !== "object") {
    throw new Error("route-verifier: decision is required");
  }
  if (mode === "off") {
    return { applied: false, decision, diff: null, reason: "verifier_off", mode, judge_status: "ok" };
  }

  // Judge unavailable → conservative fallback.
  if (judgeError) {
    const hard = detectHardStructuralSignals(signals);
    let next = decision;
    let applied = false;
    if (mode === "enforce" && decision.web_policy === "required" && hard.length === 0) {
      // SR demanded mandatory web with no hard external signal —
      // degrade to optional rather than burn search calls on an
      // unverified policy.
      next = { ...decision, web_policy: "optional" };
      applied = true;
    }
    return {
      applied,
      decision: next,
      diff: applied ? { web_policy: { from: decision.web_policy, to: next.web_policy } } : null,
      reason: `judge_unavailable: ${judgeError?.message ?? String(judgeError)}`,
      mode,
      judge_status: "unavailable"
    };
  }

  const valid = validateJudgePayload(judgePayload);
  if (!valid) {
    return {
      applied: false,
      decision,
      diff: null,
      reason: "invalid_judge_payload",
      mode,
      judge_status: "invalid_payload"
    };
  }

  if (valid.verdict === "accept" || valid.verdict === "abstain") {
    return {
      applied: false,
      decision,
      diff: null,
      reason: `judge_${valid.verdict}: ${valid.reason}`,
      mode,
      judge_status: valid.verdict === "abstain" ? "abstain" : "ok"
    };
  }

  // Reject: judge wants to change the decision. Hard structural
  // signals can veto the judge.
  const hard = detectHardStructuralSignals(signals);
  if (hard.length > 0) {
    return {
      applied: false,
      decision,
      diff: null,
      reason: `hard_structural_signals_dominate: ${hard.join(",")}`,
      mode,
      judge_status: "hard_signal_override"
    };
  }

  const proposedDiff = {};
  if (valid.corrected_web_policy && valid.corrected_web_policy !== decision.web_policy) {
    proposedDiff.web_policy = { from: decision.web_policy, to: valid.corrected_web_policy };
  }
  if (valid.corrected_source_mode && valid.corrected_source_mode !== decision.source_mode) {
    proposedDiff.source_mode = { from: decision.source_mode, to: valid.corrected_source_mode };
  }

  if (Object.keys(proposedDiff).length === 0) {
    // Judge said "reject" but didn't change anything — treat as accept.
    return {
      applied: false,
      decision,
      diff: null,
      reason: `judge_reject_no_diff: ${valid.reason}`,
      mode,
      judge_status: "ok"
    };
  }

  if (mode === "shadow") {
    // Shadow: log diff, return original decision unchanged.
    return {
      applied: false,
      decision,
      diff: proposedDiff,
      reason: `shadow: ${valid.reason}`,
      mode,
      judge_status: "ok"
    };
  }

  // Enforce: actually apply.
  const next = { ...decision };
  if (proposedDiff.web_policy) next.web_policy = proposedDiff.web_policy.to;
  if (proposedDiff.source_mode) next.source_mode = proposedDiff.source_mode.to;
  return {
    applied: true,
    decision: next,
    diff: proposedDiff,
    reason: `enforce: ${valid.reason}`,
    mode,
    judge_status: "ok"
  };
}

/**
 * Build the user prompt sent to the router_judge LLM. Kept in this
 * module so tests can assert structural shape — caller passes its
 * provider invoker but the prompt contract is owned here.
 */
export function buildJudgePrompt({ text, decision, signals }) {
  const structural = detectHardStructuralSignals(signals);
  return [
    "You are LingxY's IntentRoute Verifier. Audit the upstream Semantic Router's policy decision against the user's request and structural signals.",
    "",
    "INPUTS",
    `user_command: ${JSON.stringify(text ?? "")}`,
    `sr_decision (subset): ${JSON.stringify({
      web_policy: decision?.web_policy,
      source_mode: decision?.source_mode,
      needs_current_information: decision?.needs_current_information ?? null
    })}`,
    `structural_signals_present: ${JSON.stringify(structural)}`,
    "",
    "RULES",
    "1. accept = SR is right. abstain = you cannot tell from inputs alone (do NOT guess).",
    "2. reject = SR is clearly wrong; you MUST emit corrected_web_policy and/or corrected_source_mode.",
    "3. Stable QA (\"什么是 X\", \"如何 do Y\", \"解释 Z\", \"comparison of A vs B without 最新/current\") → forbidden / no_external when no freshness signal exists.",
    "4. Freshness-bearing requests (volatile facts: today's price/score, current version, latest news, ongoing policies) → required / single_lookup or multi_source_research.",
    "5. Hard structural signals (explicit search verb, attachment, no-search, URL, etc.) take priority over your verdict — but you should still emit your own assessment; the framework will handle veto.",
    "",
    "OUTPUT (JSON only, no prose)",
    "{",
    '  "verdict": "accept|reject|abstain",',
    '  "corrected_web_policy": "required|optional|forbidden" | null,',
    '  "corrected_source_mode": "no_external|provided_context|single_lookup|multi_source_research|deep_research" | null,',
    '  "confidence": 0-1,',
    '  "reason": "one sentence",',
    '  "evidence_basis": ["which signals/phrases grounded your verdict"]',
    "}"
  ].join("\n");
}

/**
 * Run the verifier end-to-end. The caller injects `invokeJudge`
 * (an async function that takes a prompt and returns the JSON
 * payload, or throws/returns null on failure). This keeps the
 * module testable without an LLM.
 */
export async function runRouteVerifier({
  text,
  decision,
  signals = {},
  invokeJudge,
  mode = DEFAULT_VERIFIER_MODE
} = {}) {
  if (mode === "off") {
    return applyJudgeVerdict({ decision, signals, mode });
  }
  if (typeof invokeJudge !== "function") {
    return applyJudgeVerdict({
      decision,
      signals,
      judgeError: new Error("invokeJudge_missing"),
      mode
    });
  }
  const prompt = buildJudgePrompt({ text, decision, signals });
  let payload = null;
  let error = null;
  try {
    payload = await invokeJudge(prompt);
  } catch (e) {
    error = e;
  }
  return applyJudgeVerdict({
    decision,
    signals,
    judgePayload: payload,
    judgeError: error,
    mode
  });
}
