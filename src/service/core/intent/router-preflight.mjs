/**
 * UCA-077 P4-03 (§19 #2): shared SemanticRouter preflight.
 *
 * Every async submission path (context / browser / file / image) needs
 * the same logic before calling createTaskSpec:
 *
 *   1. Classify context sources (Layer 1).
 *   2. Extract signals against the enriched packet so source-scope
 *      etc. read the canonical context_sources view.
 *   3. Check the ambiguity gate. Skip SR for fast-path tasks.
 *   4. Otherwise call SemanticRouter and stamp the decision/rejection
 *      onto a fresh packet clone.
 *   5. Return the enriched packet so createTaskSpec sees both the
 *      classifier output AND the (optional) SR result.
 *
 * Pre-extraction the same block was inlined into context-submission.mjs.
 * Keeping a single helper means new submission paths get correct
 * layering for free, and the (small) duplication of logic with
 * createTaskSpec's internal classifier is pure idempotent reads.
 *
 * Belt-and-suspenders: the entire preflight is wrapped in try/catch.
 * SR / classifier failures must NEVER block submission. On any error
 * we return the original packet untouched and let createTaskSpec run
 * its own classifier.
 */

import { classifyContextSources } from "./context-sources.mjs";
import { extractAllSignals } from "./signals/index.mjs";
import { resolveSemanticDecision } from "./semantic-router.mjs";
import { shouldConsultSemanticRouter } from "../policy/tool-policy-resolver.mjs";

/**
 * @param {{
 *   userCommand: string,
 *   contextPacket: object
 * }} input
 * @returns {Promise<object>}  the enriched contextPacket — never null,
 *   never throws. Caller passes the result straight to createTaskSpec.
 */
export async function applySemanticRouterPreflight({ userCommand, contextPacket } = {}) {
  if (!contextPacket || typeof contextPacket !== "object") return contextPacket;
  try {
    const contextSources = classifyContextSources({
      text: userCommand,
      contextPacket
    });
    const routerContext = { ...contextPacket, context_sources: contextSources };
    const tentativeSignals = extractAllSignals(userCommand, routerContext).signals;

    if (!shouldConsultSemanticRouter({
      signals: tentativeSignals,
      contextPacket: routerContext,
      text: userCommand
    })) {
      // Fast-path / strong-signal task — SR call would be wasted. Still
      // propagate the classifier output so createTaskSpec doesn't redo
      // work and downstream surfaces see consistent metadata.
      return routerContext;
    }

    const srResult = await resolveSemanticDecision({
      text: userCommand,
      contextPacket: routerContext,
      signals: tentativeSignals
    });
    if (srResult.kind === "decision") {
      return { ...routerContext, semantic_router_decision: srResult.decision };
    }
    return { ...routerContext, semantic_router_rejection: srResult };
  } catch {
    // Any failure degrades silently. createTaskSpec will run its own
    // classifier on the original packet.
    return contextPacket;
  }
}
