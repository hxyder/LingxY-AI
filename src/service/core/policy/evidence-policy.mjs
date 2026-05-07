/**
 * EvidencePolicy — translates IntentRoute fields into policy axes.
 * Never executes tools and never owns numeric thresholds.
 *
 * Round-6 (C18 #C' codex round-5 fix): the evidence-axis algebra
 * (which source_modes are external/local, how to derive
 * needs_external_info) is owned by `intent/evidence-axes.mjs` so
 * that EvidencePolicy and the route verifier see one definition.
 * EvidencePolicy now derives `needs_external_info` instead of
 * trusting the raw value — that prevents a stale `false` on an
 * SR-or-verifier-corrected decision from dragging the route back
 * to forbidden.
 */

import {
  EXTERNAL_SOURCE_MODES as EXTERNAL_SOURCE_MODES_SET,
  LOCAL_SOURCE_MODES as LOCAL_SOURCE_MODES_SET,
  deriveNeedsExternalInfo
} from "../intent/evidence-axes.mjs";

const EXTERNAL_SOURCE_MODES = EXTERNAL_SOURCE_MODES_SET;
const LOCAL_SOURCE_MODES = LOCAL_SOURCE_MODES_SET;

export function intentRouteNeedsConnector(decision = null) {
  if (!decision || typeof decision !== "object") return false;
  if (decision.primary_intent === "email_calendar_action") return true;
  const caps = Array.isArray(decision.needed_capabilities)
    ? decision.needed_capabilities
    : [];
  return caps.includes("email_calendar_action");
}

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

  // Round-6 (codex round-5 #B): derive needs_external_info from the
  // three normalized fields rather than reading the raw value. This
  // prevents a stale `needs_external_info=false` on an SR/verifier-
  // corrected decision from short-circuiting an upgrade to required.
  // The raw field stays available on the decision for telemetry
  // and migration but is no longer authoritative for policy.
  const effectiveNeedsExternalInfo = deriveNeedsExternalInfo({
    web_policy: decision.web_policy,
    source_mode: sourceMode,
    needs_current_information: decision.needs_current_information
  });

  if (hasStructuredEvidence && (LOCAL_SOURCE_MODES.has(sourceMode)
      || effectiveNeedsExternalInfo === false
      || capabilities.includes("none"))) {
    // ^ effectiveNeedsExternalInfo === false means: no upgrade
    // signal anywhere in the three normalized fields (i.e. SR did
    // NOT request required, source_mode is not external, and
    // needs_current_information is not true). This is the
    // canonical "stay local" condition.
    return {
      mode: "forbidden",
      reason: `IntentRoute source_mode=${sourceMode} indicates no external web read is needed.`,
      evidence
    };
  }

  if (capabilities.includes("external_web_read")
      || effectiveNeedsExternalInfo === true
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
