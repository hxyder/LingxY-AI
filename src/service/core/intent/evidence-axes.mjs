/**
 * evidence-axes.mjs — C18 #C' round-6 (codex round-5 design)
 *
 * Neutral module that owns the evidence-axis algebra used by both
 * the route verifier and the EvidencePolicy. Before this module
 * existed, `route-verifier.mjs` and `evidence-policy.mjs` both
 * carried their own copy of EXTERNAL_SOURCE_MODES / LOCAL_SOURCE_
 * MODES / consistency rules — which made it impossible to have
 * EvidencePolicy import the verifier (would be a layering inversion)
 * and equally impossible for the verifier to *change* what
 * EvidencePolicy will do downstream.
 *
 * Round-5 codex review caught this as the structural blocker for
 * a real shadow corpus run: the verifier was rewriting
 * needs_external_info on enforce, but EvidencePolicy still read
 * the raw value as a standalone gate. Pulling the axis algebra
 * here lets both consumers share one definition.
 *
 * Exports:
 *   EXTERNAL_SOURCE_MODES / LOCAL_SOURCE_MODES — Set<string>
 *   isExternalSourceMode(s) / isLocalSourceMode(s) — boolean
 *   deriveNeedsExternalInfo({ web_policy, source_mode,
 *     needs_current_information }) — boolean. Single source of
 *     truth for "does this route need external info?"
 *   normalizeEvidenceAxes(decision) — returns a shallow-cloned
 *     decision with `needs_external_info` overwritten by the
 *     derived value. Used at EvidencePolicy entry and verifier
 *     enforce-apply so neither layer reads stale raw fields.
 *   detectEvidenceInconsistency(state) — returns string[] of
 *     violations. Used by verifier consistency floor; available
 *     to any other caller that wants to assert axis coherence.
 */

export const EXTERNAL_SOURCE_MODES = Object.freeze(new Set([
  "single_lookup",
  "multi_source_research",
  "deep_research"
]));

export const LOCAL_SOURCE_MODES = Object.freeze(new Set([
  "no_external",
  "provided_context"
]));

export function isExternalSourceMode(m) {
  return EXTERNAL_SOURCE_MODES.has(m);
}

export function isLocalSourceMode(m) {
  return LOCAL_SOURCE_MODES.has(m);
}

/**
 * Single source of truth for "does this route need external info?"
 * Derived from the three normalized fields:
 *   - explicit user/system signal that the answer changes with time
 *     (needs_current_information === true)
 *   - explicit policy upgrade (web_policy === "required")
 *   - external source_mode (single_lookup / multi_source_research /
 *     deep_research)
 *
 * Round-5: verifier writes this into enforced decisions; round-6:
 * EvidencePolicy uses it instead of the raw `needs_external_info`
 * so a stale `false` from SR can't drag a corrected route back to
 * forbidden.
 */
export function deriveNeedsExternalInfo({
  web_policy,
  source_mode,
  needs_current_information
} = {}) {
  if (needs_current_information === true) return true;
  if (web_policy === "required") return true;
  if (isExternalSourceMode(source_mode)) return true;
  return false;
}

/**
 * Return a shallow clone of `decision` with `needs_external_info`
 * overwritten by the derived value. EvidencePolicy and the verifier
 * both call this at the same logical seam (just before policy
 * decisions read `needs_external_info`) so the two layers see one
 * consistent record.
 */
export function normalizeEvidenceAxes(decision) {
  if (!decision || typeof decision !== "object") return decision;
  return {
    ...decision,
    needs_external_info: deriveNeedsExternalInfo({
      web_policy: decision.web_policy,
      source_mode: decision.source_mode,
      needs_current_information: decision.needs_current_information
    })
  };
}

/**
 * Inconsistency detection. Returns string[] of violation codes;
 * empty array == axis-consistent. Used by verifier consistency
 * floor and available to verify-* scripts that want to assert
 * axis coherence on harness fixtures.
 *
 *   forbidden_with_external_source_mode  — web_policy=forbidden + external source
 *   required_with_local_source_mode      — web_policy=required + no_external/provided_context
 *   needs_current_with_forbidden         — needs_current_information=true + web_policy=forbidden
 */
export function detectEvidenceInconsistency(state) {
  if (!state || typeof state !== "object") return [];
  const violations = [];
  if (state.web_policy === "forbidden" && isExternalSourceMode(state.source_mode)) {
    violations.push("forbidden_with_external_source_mode");
  }
  if (state.web_policy === "required" && isLocalSourceMode(state.source_mode)) {
    violations.push("required_with_local_source_mode");
  }
  if (state.needs_current_information === true && state.web_policy === "forbidden") {
    violations.push("needs_current_with_forbidden");
  }
  return violations;
}
