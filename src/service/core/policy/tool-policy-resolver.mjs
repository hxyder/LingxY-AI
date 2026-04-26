/**
 * UCA-077 P1-03: Tool policy resolver — single source of truth for whether
 * web_search_fetch is forbidden / optional / required for the current task.
 *
 * Replaces the three independent decision points that previously voted
 * inconsistently:
 *   - task-spec.mjs:183-191  WEB_DATA_PATTERNS → needs_current_web_data flag
 *   - task-spec.mjs:425-430  applyHardenedRules pushed web_search_fetch step
 *   - tool_using/agent-loop.mjs:31-39 / 681-696 / 724-727  isSearchOrNewsRequest
 *
 * Inputs are signals (built by intent/signals/) plus the request context.
 * Output carries the decision plus full evidence for tracing.
 *
 * Decision priority (short-circuit in order):
 *   1. explicit_external (strong)             → required
 *   2. explicit_entity (strong) + scope=none  → required
 *   3. source_scope ∈ local set               → forbidden
 *   4. explicit_search (strong)               → optional
 *   5. weak_freshness (weak)                  → optional
 *   6. default                                → forbidden
 *
 * The resolver never returns "required" off a weak signal alone — that was
 * the root cause of the "最近这个框架很慢 → 误联网" symptom.
 */

const LOCAL_SCOPES = new Set(["uploaded_files", "current_context", "local_project", "selection"]);

/**
 * @typedef {Object} ToolPolicy
 * @property {Object} web_search_fetch
 * @property {"forbidden"|"optional"|"required"} web_search_fetch.mode
 * @property {string} web_search_fetch.reason
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} web_search_fetch.evidence
 */

/**
 * @param {{ signals: import("../intent/signals/_signal-types.mjs").SignalBundle["signals"], contextPacket?: object }} input
 * @returns {ToolPolicy}
 */
export function resolveToolPolicy({ signals, contextPacket: _contextPacket = {} } = {}) {
  if (!signals) {
    throw new Error("resolveToolPolicy: signals bundle is required");
  }

  const explicitExternal = signals.explicit_external;
  const explicitEntity = signals.explicit_entity;
  const sourceScope = signals.source_scope;
  const explicitSearch = signals.explicit_search;
  const weakFreshness = signals.weak_freshness;

  // 1. Explicit external opt-in — overrides everything, including local scope.
  if (explicitExternal?.matched && explicitExternal.strength === "strong") {
    return webSearchPolicy(
      "required",
      "User explicitly asked for an online/external lookup.",
      explicitExternal.evidence
    );
  }

  // 2. Strong external entity (weather, stock, flight…) AND scope is "none"
  //    or unknown — i.e. the user did not anchor the request to local data.
  const scopeValue = sourceScope?.hint?.value ?? "none";
  if (explicitEntity?.matched && explicitEntity.strength === "strong" && scopeValue === "none") {
    return webSearchPolicy(
      "required",
      `User named a high-freshness external entity ("${firstMatch(explicitEntity)}") with no local source attached.`,
      [...explicitEntity.evidence, { type: "context", source: "source_scope", reason: "scope=none" }]
    );
  }

  // 3. Local source — uploaded files, current context, local project, or
  //    a selection. The user is asking about something local; do not search.
  if (sourceScope?.matched && LOCAL_SCOPES.has(scopeValue)) {
    return webSearchPolicy(
      "forbidden",
      `Task is anchored to ${scopeValue}; external web data is not appropriate.`,
      sourceScope.evidence
    );
  }

  // 4. Neutral search verb — user explicitly invited a search but did not
  //    pin it to external data. Let downstream LLM judge whether to actually
  //    call web_search.
  if (explicitSearch?.matched && explicitSearch.strength === "strong") {
    return webSearchPolicy(
      "optional",
      "User used a neutral search verb; web_search is allowed but not required.",
      explicitSearch.evidence
    );
  }

  // 5. Default — including weak_freshness on its own. The original
  //    intuition was that "最近 / current" should let the LLM decide whether
  //    to search, but in practice that escalates plain chitchat ("最近怎么样")
  //    onto an executor that can call tools, with no useful entity to search
  //    for. We keep the weak_freshness signal in `evidence` (for tracing)
  //    but the policy stays forbidden until an explicit_search,
  //    explicit_entity, or explicit_external companion appears.
  const trailingEvidence = [];
  if (weakFreshness?.matched) trailingEvidence.push(...weakFreshness.evidence);
  trailingEvidence.push({ type: "default", source: "tool-policy-resolver", reason: "no companion signal" });
  return webSearchPolicy(
    "forbidden",
    weakFreshness?.matched
      ? "Weak freshness marker without a search verb / external entity / online phrase — treated as chitchat."
      : "No external-data signal detected.",
    trailingEvidence
  );
}

function webSearchPolicy(mode, reason, evidence) {
  return {
    web_search_fetch: { mode, reason, evidence: Array.isArray(evidence) ? evidence : [] }
  };
}

function firstMatch(signal) {
  return signal?.evidence?.[0]?.matched ?? "";
}
