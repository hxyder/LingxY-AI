/**
 * EvidencePolicy — bridge from structured IntentRoute judgement to
 * deterministic policy axes.
 *
 * SemanticRouter classifies; EvidencePolicy interprets that classification
 * into policy hints. It never executes tools and never owns numeric research
 * thresholds (research-quality.mjs does).
 */

const EXTERNAL_SOURCE_MODES = new Set([
  "single_lookup",
  "multi_source_research",
  "deep_research"
]);

const LOCAL_SOURCE_MODES = new Set([
  "no_external",
  "provided_context"
]);

/**
 * @param {object|null} decision
 * @returns {boolean}
 */
export function intentRouteNeedsConnector(decision = null) {
  if (!decision || typeof decision !== "object") return false;
  if (decision.primary_intent === "email_calendar_action") return true;
  const caps = Array.isArray(decision.needed_capabilities)
    ? decision.needed_capabilities
    : [];
  return caps.includes("email_calendar_action");
}

/**
 * Derive external_web_read mode from IntentRoute fields. Compatibility
 * `web_policy` remains a fallback, but the structural IntentRoute fields are
 * the preferred source.
 *
 * @param {object|null} decision
 * @returns {{ mode: "forbidden"|"optional"|"required", reason: string, evidence: object[] } | null}
 */
export function deriveExternalWebPolicyFromIntentRoute(decision = null) {
  if (!decision || typeof decision !== "object") return null;

  const sourceMode = typeof decision.source_mode === "string"
    ? decision.source_mode
    : "unknown";
  const capabilities = Array.isArray(decision.needed_capabilities)
    ? decision.needed_capabilities
    : [];
  const hasStructuredEvidence = typeof decision.source_mode === "string"
    || typeof decision.needs_external_info === "boolean"
    || typeof decision.needs_current_information === "boolean"
    || typeof decision.needs_tool_use === "boolean"
    || capabilities.length > 0;
  const evidence = [{
    type: "semantic_router",
    source: "evidence-policy",
    reason: String(decision.rationale_summary ?? decision.reason ?? "").slice(0, 240)
      || "IntentRoute judgement"
  }];

  if (hasStructuredEvidence && (LOCAL_SOURCE_MODES.has(sourceMode)
      || decision.needs_external_info === false
      || capabilities.includes("none"))) {
    return {
      mode: "forbidden",
      reason: `IntentRoute source_mode=${sourceMode} indicates no external web read is needed.`,
      evidence
    };
  }

  if (capabilities.includes("external_web_read")
      || decision.needs_external_info === true
      || decision.needs_current_information === true
      || EXTERNAL_SOURCE_MODES.has(sourceMode)) {
    return {
      mode: "required",
      reason: `IntentRoute requires external evidence (source_mode=${sourceMode}, capabilities=${capabilities.join(",") || "none"}).`,
      evidence
    };
  }

  if (decision.needs_tool_use === true) {
    return {
      mode: "optional",
      reason: `IntentRoute is tool-capable but external evidence is ambiguous (source_mode=${sourceMode}).`,
      evidence
    };
  }

  if (["forbidden", "optional", "required"].includes(decision.web_policy)) {
    return {
      mode: decision.web_policy,
      reason: `Semantic router suggested ${decision.web_policy} (confidence=${typeof decision.confidence === "number" ? decision.confidence.toFixed(2) : "?"}); IntentRoute compatibility web_policy=${decision.web_policy}.`,
      evidence
    };
  }

  return null;
}
