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
 * Decision table (short-circuit in order):
 *   1. goal=translate                                                → translate
 *   2. goal=multimodal_analyze OR contextPacket has image_paths      → multi_modal
 *   3. tool_policy.web_search_fetch=required AND no artifact         → tool_using
 *   4. artifact.required=true                                        → agentic
 *   5. routing_degraded AND web=optional                             → tool_using
 *   6. connector_domain=true                                         → tool_using
 *   7. goal=qa AND tool_policy.web_search_fetch=forbidden            → fast
 *   8. default                                                       → tool_using
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

  // Rule 1 — translate is its own dedicated executor.
  if (goal === "translate") {
    return decision("translate", "Goal is translate.", [
      { type: "context", source: "task-spec.goal", matched: "translate" }
    ], rejectAllExcept("translate", routeSuggestion));
  }

  // Rule 2 — multimodal goals or attached images need vision-first executor.
  if (goal === "multimodal_analyze" || hasImage) {
    return decision("multi_modal",
      hasImage ? "Image attachments require multi_modal first hop." : "Goal is multimodal_analyze.",
      [
        { type: "context", source: hasImage ? "context.image_paths" : "task-spec.goal",
          matched: hasImage ? `${contextPacket.image_paths.length} image(s)` : "multimodal_analyze" }
      ],
      rejectAllExcept("multi_modal", routeSuggestion)
    );
  }

  // Rule 3 — required web data without an artifact: stay in tool_using's
  // tighter loop. agentic adds prompt overhead we do not need for a
  // single-search-then-answer flow.
  if (webMode === "required" && !artifactRequired) {
    return decision("tool_using",
      "web_search_fetch is required and no artifact is needed; stay in tool_using's short loop.",
      [
        { type: "context", source: "tool-policy.web_search_fetch", matched: "required" },
        { type: "context", source: "task-spec.artifact", matched: "not required" }
      ],
      rejectAllExcept("tool_using", routeSuggestion)
    );
  }

  // Rule 4 — producing a file (docx/pptx/xlsx/pdf/md) needs the agentic
  // multi-step planner.
  if (artifactRequired) {
    return decision("agentic",
      `Artifact required (${taskSpec.artifact?.kind ?? "unspecified kind"}); use agentic planner.`,
      [{ type: "context", source: "task-spec.artifact.required", matched: "true" }],
      rejectAllExcept("agentic", routeSuggestion)
    );
  }

  // Rule 5 — SR degraded but policy is optional: keep the task on a
  // tool-capable executor. An operational SemanticRouter failure is not
  // proof that the user forbade tools; tool_using can answer directly or
  // call allowed tools under the registry guard.
  if (taskSpec.routing_degraded === true && webMode === "optional") {
    return decision("tool_using",
      "SemanticRouter degraded and external_web_read is optional; route to tool_using so the model can decide under guardrails instead of fast refusing.",
      [
        { type: "context", source: "task-spec.routing_degraded", matched: "true" },
        { type: "context", source: "tool-policy.web_search_fetch", matched: "optional" }
      ],
      rejectAllExcept("tool_using", routeSuggestion)
    );
  }

  // Rule 6 — connector-domain work reads/writes connected account state
  // through connector tools, not external_web_read. A connector task can
  // legitimately have web=forbidden and goal=qa (for example when the SR
  // classified an email/calendar action but the legacy goal taxonomy has no
  // dedicated family). Keep it on the tool-capable executor.
  if (taskSpec?.connector_domain === true) {
    return decision("tool_using",
      "Connector-domain task; external_web_read may be forbidden but connector tools can satisfy the request.",
      [
        { type: "context", source: "task-spec.connector_domain", matched: "true" },
        { type: "context", source: "tool-policy.web_search_fetch", matched: webMode }
      ],
      rejectAllExcept("tool_using", routeSuggestion)
    );
  }

  // Rule 7 — Q&A or research-blocked with web_search FORBIDDEN:
  // cheapest path. fast executor produces a quick honest reply
  // rather than spinning the tool_using planner with a tool belt
  // the policy forbids.
  //
  // We deliberately do NOT short-circuit on web=optional here. "查一下文档"
  // ends up with goal=qa + web=optional, and the user genuinely wants the
  // search to happen; routing it to fast (which has no tools) would waste
  // the explicit signal.
  //
  // P4-RQ G5a covers TWO cases:
  //   (a) goal=qa + web=forbidden                     → fast (legacy)
  //   (b) goal=search_and_answer + web=forbidden + !connector_domain → fast
  //         (NEW: handles "不要联网，告诉我今天 AI 新闻"-type cases
  //          where SR drives goal=search_and_answer but
  //          explicit_no_search wins at resolver step 0a. The
  //          !connector_domain boundary keeps "不要联网，查一下我
  //          最近的邮件" on tool_using because connector tools
  //          satisfy that request without external web.)
  const isQaForbidden = goal === "qa" && webMode === "forbidden";
  const isResearchExplicitlyBlocked =
    goal === "search_and_answer"
    && webMode === "forbidden"
    && !taskSpec?.connector_domain;
  if (isQaForbidden || isResearchExplicitlyBlocked) {
    const reason = isResearchExplicitlyBlocked
      ? "Research-class goal with web_search forbidden (explicit_no_search wins) and not a connector-domain task; route to fast for an honest 'cannot search' reply."
      : "Pure Q&A with web_search forbidden; route to fast executor.";
    return decision("fast",
      reason,
      [
        { type: "context", source: "task-spec.goal", matched: goal },
        { type: "context", source: "tool-policy.web_search_fetch", matched: "forbidden" }
      ],
      rejectAllExcept("fast", routeSuggestion)
    );
  }

  // Rule 8 — default. tool_using carries the full tool belt; the LLM can
  // choose a tool or return {final:"..."} when no tool is needed.
  return decision("tool_using",
    `Default — goal=${goal} with tool_policy.web_search_fetch=${webMode} routes to tool_using.`,
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
