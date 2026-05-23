/**
 * UCA-077 P1-01: Signal extractor — single entry point for routing signals.
 *
 * Each signal module exports `detect(text, contextPacket)` and returns a
 * Signal object (see _signal-types.mjs). This index calls them in a fixed
 * order, returns a keyed map, and flattens evidence for downstream tracing.
 *
 * Signals do NOT call each other. Order in this file determines NOTHING about
 * priority — priority lives in policy/ resolvers.
 */

import { emptySignal, SIGNAL_NAMES, SIGNAL_KINDS } from "./_signal-types.mjs";

import { detect as detectExplicitExternal } from "./explicit-external.mjs";
import { detect as detectSourceScope } from "./source-scope.mjs";
import { detect as detectExplicitSearch } from "./explicit-search.mjs";
import { detect as detectWeakFreshness } from "./weak-freshness.mjs";
import { detect as detectExplicitEntity } from "./topic-hint.mjs";
import { detect as detectPendingOffer } from "./pending-offer.mjs";
import { detect as detectExplicitSingleUrl } from "./explicit-single-url.mjs";
import { detect as detectExplicitNoSearch } from "./explicit-no-search.mjs";
import { detect as detectLocalOnlyConstraint } from "./local-only-constraint.mjs";
import { detect as detectSemanticRouter } from "./semantic-router.mjs";

const DETECTORS = {
  explicit_external: detectExplicitExternal,
  source_scope: detectSourceScope,
  explicit_search: detectExplicitSearch,
  weak_freshness: detectWeakFreshness,
  topic_hint: detectExplicitEntity,
  pending_offer: detectPendingOffer,
  explicit_single_url: detectExplicitSingleUrl,
  explicit_no_search: detectExplicitNoSearch,
  local_only_constraint: detectLocalOnlyConstraint,
  semantic_router: detectSemanticRouter
};

/**
 * Run every registered detector and return a SignalBundle.
 *
 * @param {string} text
 * @param {Object} [contextPacket]
 * @returns {import("./_signal-types.mjs").SignalBundle}
 */
export function extractAllSignals(text, contextPacket = {}) {
  const signals = {};
  const evidence = [];

  for (const name of SIGNAL_NAMES) {
    const detector = DETECTORS[name];
    const signal = detector ? detector(String(text ?? ""), contextPacket ?? {}) : emptySignal(name);
    signals[name] = signal;
    if (signal.matched) {
      for (const item of signal.evidence) evidence.push(item);
    }
  }

  return { signals, evidence };
}

// Re-export the public protocol surface so downstream consumers (P4-02
// SemanticRouter, future tooling) can import everything they need from
// `signals/index.mjs` without reaching into `_signal-types.mjs` — the
// underscore prefix marks that file as internal.
export { SIGNAL_NAMES, SIGNAL_KINDS, emptySignal };
