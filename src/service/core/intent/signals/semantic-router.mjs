/**
 * UCA-077 P4-RQ §19 #5 / F1: synthetic semantic_router signal.
 *
 * Wraps `contextPacket.semantic_router_decision` (already stamped
 * upstream by the SR preflight) into a SignalBundle entry so the
 * goal classifier and other Layer-2/4 consumers can read SR's
 * structured output the same way they read regex-derived signals.
 *
 * This is NOT regex — the signal is a passthrough of an already-
 * computed structured judgement. It exists so the goal classifier
 * (task-spec.mjs `requiresSignal`) can migrate off `topic_hint`
 * (regex-driven topic-domain inference) and onto SR + EvidencePolicy
 * output, per the user's E3-followup directive: "goal/executor
 * 分类迁到 SR/EvidencePolicy 输出, 不要继续依赖 topic_hint".
 *
 * Output shape:
 *   matched      — true when contextPacket carries a usable SR
 *                  decision (kind=decision-shaped object with
 *                  web_policy in {required, optional, forbidden}).
 *                  False otherwise (no SR consulted; SR rejected;
 *                  malformed payload).
 *   strength     — "strong" when SR's confidence ≥ 0.7;
 *                  "weak" otherwise. Goal classifier (and any
 *                  future consumer) decides per its needs.
 *   kind         — "hint". SR's classification is conventional
 *                  (LLM judgement), not direct observation.
 *                  Per the SignalKind taxonomy: hint = pattern +
 *                  conventional implication.
 *   hint         — { web_policy, source_scope, research_depth,
 *                    output_kind, executor, primary_intent,
 *                    source_mode, needed_capabilities,
 *                    required_policy_groups, confidence } —
 *                  the routing axes consumers may want to read.
 *   evidence     — single entry pointing back at SR with a
 *                  truncated reason for trace.
 */

import { emptySignal } from "./_signal-types.mjs";

const SIGNAL_NAME = "semantic_router";

const VALID_WEB_POLICIES = new Set(["forbidden", "optional", "required"]);
const STRONG_CONFIDENCE_THRESHOLD = 0.7;

/**
 * @param {string} _text  - unused; signal reads contextPacket only
 * @param {object} contextPacket
 * @returns {import("./_signal-types.mjs").Signal}
 */
export function detect(_text, contextPacket = {}) {
  const decision = contextPacket?.semantic_router_decision;
  if (!decision || typeof decision !== "object") return emptySignal(SIGNAL_NAME);
  if (!VALID_WEB_POLICIES.has(decision.web_policy)) return emptySignal(SIGNAL_NAME);

  const confidence = typeof decision.confidence === "number" ? decision.confidence : 0;
  const strength = confidence >= STRONG_CONFIDENCE_THRESHOLD ? "strong" : "weak";

  return {
    name: SIGNAL_NAME,
    matched: true,
    strength,
    kind: "hint",
    evidence: [{
      type: "semantic_router",
      source: SIGNAL_NAME,
      reason: String(decision.reason ?? "").slice(0, 200) || "(no reason)"
    }],
    hint: {
      web_policy: decision.web_policy,
      source_scope: decision.source_scope ?? null,
      research_depth: decision.research_depth ?? null,
      output_kind: decision.output_kind ?? null,
      executor: decision.executor ?? null,
      primary_intent: decision.primary_intent ?? null,
      domain: decision.domain ?? null,
      expected_output: decision.expected_output ?? null,
      needs_external_info: decision.needs_external_info === true,
      needs_current_information: decision.needs_current_information === true,
      needs_user_files: decision.needs_user_files === true,
      needs_tool_use: decision.needs_tool_use === true,
      needed_capabilities: Array.isArray(decision.needed_capabilities)
        ? decision.needed_capabilities.slice()
        : [],
      required_policy_groups: Array.isArray(decision.required_policy_groups)
        ? decision.required_policy_groups.slice()
        : [],
      source_mode: decision.source_mode ?? null,
      complexity: decision.complexity ?? null,
      risk_level: decision.risk_level ?? null,
      confidence
    }
  };
}

export const SEMANTIC_ROUTER_SIGNAL_NAME = SIGNAL_NAME;
