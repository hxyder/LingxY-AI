/**
 * UCA-077 P1-04: Executor resolver — single decision point for which
 * executor a task runs on.
 *
 * Replaces the precedence chain that previously let routeIntent's
 * `suggested_executor` silently override every other consideration:
 *
 *   - task-spec.mjs:389  `intentRouterResult.suggested_executor ?? deriveExecutor(...)`
 *   - browser-submission.mjs:273-302  `pickRunnableExecutor` only checks
 *     task.executor (fed from route.executor) for runtime availability.
 *
 * routeSuggestion is now evidence only. The chosen executor is derived from
 * (taskSpec, toolPolicy, runtimeCapabilities) — facts the system can defend.
 *
 * Decision table:
 *   - image-only input uses the multimodal AI executor
 *   - image + required external tools uses the tool-capable AI agent
 *   - everything else defaults to the tool-capable AI agent
 *
 * Output includes rejected candidates with reasons, which downstream
 * DecisionTrace (Phase 2) will render to the user.
 */

const KNOWN_EXECUTORS = new Set(["fast", "translate", "tool_using", "multi_modal", "agentic"]);

/**
 * @typedef {Object} ExecutorDecision
 * @property {"fast"|"translate"|"tool_using"|"multi_modal"|"agentic"} executor
 * @property {string} reason
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} evidence
 * @property {{ candidate: string, reason: string }[]} rejected
 */

/**
 * @param {{ taskSpec: object, toolPolicy: object, contextPacket?: object, runtimeCapabilities?: Set<string>, routeSuggestion?: string }} input
 * @returns {ExecutorDecision}
 */
export function resolveExecutor({ taskSpec, toolPolicy, contextPacket = {}, runtimeCapabilities, routeSuggestion } = {}) {
  if (!taskSpec) throw new Error("resolveExecutor: taskSpec is required");
  if (!toolPolicy?.web_search_fetch) throw new Error("resolveExecutor: toolPolicy.web_search_fetch is required");

  const goal = String(taskSpec.goal ?? "");
  const artifactRequired = taskSpec.artifact?.required === true;
  const webMode = toolPolicy.web_search_fetch.mode;
  const hasImage = Array.isArray(contextPacket.image_paths) && contextPacket.image_paths.length > 0;
  const requiresExternalWeb = isExternalWebRequired(taskSpec, toolPolicy);
  const canBenefitFromExternalWeb = isExternalWebOptional(taskSpec, toolPolicy);
  const evidence = [];
  const rejected = [];

  // routeSuggestion is recorded for tracing but never short-circuits.
  if (routeSuggestion) {
    evidence.push({
      type: "context",
      source: "route-suggestion",
      matched: routeSuggestion,
      reason: "intent-router suggested this executor; carried as evidence only"
    });
  }

  if (hasImage && (requiresExternalWeb || canBenefitFromExternalWeb)) {
    return decision("tool_using",
      requiresExternalWeb
        ? "Image attachments plus required external_web_read need tool-capable image understanding and search."
        : "Image attachments plus a research/search signal need tool-capable image understanding and optional external search.",
      [
        { type: "context", source: "context.image_paths",
          matched: `${contextPacket.image_paths.length} image(s)` },
        { type: "policy", source: "tool_policy.external_web_read",
          matched: requiresExternalWeb ? "required" : "optional" }
      ],
      rejectAllExcept("tool_using", routeSuggestion)
    );
  }

  if (hasImage) {
    return decision("multi_modal",
      "Image attachments require multi_modal first hop.",
      [
        { type: "context", source: "context.image_paths",
          matched: `${contextPacket.image_paths.length} image(s)` }
      ],
      rejectAllExcept("multi_modal", routeSuggestion)
    );
  }

  return decision("tool_using",
    `AI-agent default — goal=${goal}, artifact_required=${artifactRequired}, connector_domain=${taskSpec?.connector_domain === true}, web=${webMode}.`,
    [
      { type: "default", source: "executor-resolver", reason: "no specialised rule matched" }
    ],
    rejectAllExcept("tool_using", routeSuggestion)
  );

  function decision(executor, reason, rules, rejectedCandidates) {
    if (runtimeCapabilities && !runtimeCapabilities.has(executor)) {
      // Honest failure — surface that the chosen executor is unavailable
      // rather than silently downgrading to "fast" (which was the bug in
      // browser-submission.mjs:273-302).
      throw new Error(
        `resolveExecutor: chose ${executor} but runtime does not advertise that capability. ` +
        `Available: ${[...runtimeCapabilities].join(", ")}`
      );
    }
    return {
      executor,
      reason,
      evidence: [...evidence, ...rules],
      rejected: rejectedCandidates
    };
  }
}

function isExternalWebRequired(taskSpec = {}, toolPolicy = {}) {
  return toolPolicy?.web_search_fetch?.mode === "required"
    || toolPolicy?.policy_groups?.external_web_read?.mode === "required"
    || (Array.isArray(taskSpec?.success_contract?.required_policy_groups)
      && taskSpec.success_contract.required_policy_groups.includes("external_web_read"));
}

function isExternalWebOptional(taskSpec = {}, toolPolicy = {}) {
  const mode = toolPolicy?.policy_groups?.external_web_read?.mode
    ?? toolPolicy?.web_search_fetch?.mode;
  const capabilities = taskSpec?.contract?.needed_capabilities
    ?? taskSpec?.needed_capabilities
    ?? [];
  return mode === "optional"
    && (taskSpec?.research_signals_present === true
      || (Array.isArray(capabilities) && capabilities.includes("external_web_read")));
}

function rejectAllExcept(chosen, routeSuggestion) {
  const rejected = [];
  for (const candidate of KNOWN_EXECUTORS) {
    if (candidate === chosen) continue;
    let reason = "rule did not match";
    if (routeSuggestion === candidate) {
      reason = "intent-router suggested this candidate but rules selected a different executor";
    }
    rejected.push({ candidate, reason });
  }
  return rejected;
}

export { KNOWN_EXECUTORS };
