/**
 * UCA-077 P4-RR (plan §16.4 + §17.4.3): RAID log — Risks, Assumptions,
 * Issues, Dependencies — for the current task.
 *
 * Background. PMBOK / PIECE proposed making the system's risk awareness
 * EXPLICIT instead of leaving it scattered across try/catch blocks,
 * resolver evidence arrays, and policy reasons. §16.4 picked Risks; the
 * third-round CAR-v2 review (§17.4.3) extended that to all four RAID
 * buckets so we cover:
 *
 *   - Risks         — known-and-handled failure modes (this file's RR-01..)
 *   - Assumptions   — guesses the system is making that may or may not hold
 *                     (e.g. "user said '这个框架' meaning the local project")
 *   - Issues        — problems that already happened. NOT populated at
 *                     compile time; future work can project these from the
 *                     audit log so the UI can render the full RAID picture.
 *   - Dependencies  — resources the task needs that may be missing (e.g.
 *                     a code-analysis goal with no attached files).
 *
 * The log is LOG-ONLY at this stage. No state machine consumes it; it
 * exists so:
 *   1. DecisionTrace entries can tag themselves with triggered RAID ids
 *      (`triggered_raid_ids: ["RR-03", "A-02"]`) for explainable UI.
 *   2. CI / inspection tools can assert "every open high-severity Risk
 *      has an enforcement task pointing at it".
 *   3. Future Phase 4 SemanticRouter / Runbook engine can read the same
 *      structure to seed deterministic recovery (§17.4.1).
 *
 * What this file is NOT:
 *   - It is NOT a state machine driver. State changes still happen via
 *     task-runtime / executor logic.
 *   - It is NOT a runbook. Runbook engine (P4-RB, §17.4.1) is separate.
 *   - It does NOT block execution. The policy guard does that, and the
 *     register merely records *that the system saw the risk and applied
 *     its mitigation*.
 */

/**
 * @typedef {"open"|"partial"|"mitigated"|"accepted"|"transferred"} RiskStatus
 *           // P4-RR rev (§18.2.4): "partial" means a short-term mitigation
 *           // is in place but the long-term fix is still open. Used to
 *           // avoid the false confidence of marking a risk "mitigated"
 *           // when only its surface symptoms have been addressed.
 * @typedef {"low"|"medium"|"high"} RiskSeverity
 */

/**
 * @typedef {Object} RegisteredRisk
 * @property {string}       id          // RR-01 .. (stable across releases)
 * @property {string}       category    // "routing" | "execution" | "context" | …
 * @property {string}       risk        // human-readable description
 * @property {RiskSeverity} severity
 * @property {string}       mitigation  // what we do about it
 * @property {string}       enforcement // module/file that enforces the mitigation
 * @property {RiskStatus}   status      // open / partial / mitigated / accepted / transferred
 * @property {string}       [current_mitigation]
 *           // partial-only: what is in place TODAY (e.g. a workaround module)
 * @property {string}       [outstanding_work]
 *           // partial-only: what remains to fully close the risk
 */

/**
 * @typedef {Object} TaskAssumption
 * @property {string} id            // A-01 ..
 * @property {string} description
 * @property {number} confidence    // 0..1, heuristic
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} evidence
 * @property {"unverified"|"verified"|"violated"} status
 */

/**
 * @typedef {Object} TaskDependency
 * @property {string} id            // D-01 ..
 * @property {string} description
 * @property {"missing"|"available"} status
 * @property {string} consequence_if_missing
 */

/**
 * @typedef {Object} RaidLog
 * @property {RegisteredRisk[]}  task_triggered_risks
 *           // P4-RR rev (§18.2.5): risks whose mitigation actually fired
 *           // for THIS task (mitigated or partial entries that matched).
 *           // Open risks unrelated to this task are NOT included here so
 *           // the per-task UI doesn't drown in global noise. System-level
 *           // diagnostics call `listGlobalOpenRisks()` separately.
 * @property {TaskAssumption[]}  assumptions
 * @property {Array}             issues
 * @property {TaskDependency[]}  dependencies
 */

/**
 * Canonical risk register. Single source of truth. Status fields evolve
 * as enforcement tasks land; do NOT branch this list per task — instead
 * filter via `listTaskTriggeredRisks` (per-task UI) or `listGlobalOpenRisks`
 * (system diagnostic) so consumers see one stable identifier set.
 *
 * Statuses tracked at this point in the project:
 *   RR-01  Phase 1 tool-policy-resolver landed → mitigated.
 *   RR-02  Phase 4 P4-04 policy guard landed → mitigated.
 *   RR-03  P4-00 (capability-based guard) landed in this commit → mitigated.
 *   RR-04  P4-00.5 (shared resource-context + trust split) landed → mitigated.
 *   RR-05  open — depends on P4-02 SemanticRouter.
 *   RR-06  partial — P4-00.5 shared module addresses surface symptoms
 *          (every executor sees the same ambient facts), but the deeper
 *          architectural fix (lift prompt composition to task-runtime,
 *          plan §15.3 Approach B) is still open. Mark partial so the
 *          register reflects "short-term in place, long-term still
 *          owed" rather than the falsely reassuring "mitigated".
 */
export const RR_REGISTRY = Object.freeze({
  "RR-01": Object.freeze({
    id: "RR-01",
    category: "routing",
    risk: "Weak semantic markers (\"最近\", \"latest\") trigger unintended external web search.",
    severity: "high",
    mitigation: "Three-state tool policy with priority: explicit_external > scope=local > explicit_search > weak signals.",
    enforcement: "src/service/core/policy/tool-policy-resolver.mjs",
    status: "mitigated"
  }),
  "RR-02": Object.freeze({
    id: "RR-02",
    category: "execution",
    risk: "LLM ignores prompt instructions and calls a tool the task forbids.",
    severity: "high",
    mitigation: "Registry-level forbidden enforcement before tool.execute runs; audit on block.",
    enforcement: "src/service/capabilities/registry/policy-guard.mjs",
    status: "mitigated"
  }),
  "RR-03": Object.freeze({
    id: "RR-03",
    category: "execution",
    risk: "Synonymous tools bypass per-toolId policy (e.g. web_search_fetch blocked but web_search succeeds).",
    severity: "high",
    mitigation: "Capability-based policy guard: forbidden decisions expand across every member of the policy group, and the guard checks group-membership as defense in depth.",
    enforcement: "src/service/core/policy/policy-groups.mjs + src/service/capabilities/registry/policy-guard.mjs",
    status: "mitigated"
  }),
  "RR-04": Object.freeze({
    id: "RR-04",
    category: "context",
    risk: "Fast executor lacks location / time / connected-account context, so location-sensitive chat misfires.",
    severity: "medium",
    mitigation: "Shared resource-context block injected into every executor's system prompt.",
    enforcement: "src/service/executors/shared/resource-context.mjs",
    status: "mitigated"
  }),
  "RR-05": Object.freeze({
    id: "RR-05",
    category: "routing",
    risk: "Connector-domain string matches misclassify external-research questions (e.g. \"outlook 版本\" routed as connector).",
    severity: "medium",
    mitigation: "Replace string-matching connector-domain heuristic with SemanticRouter intent classification.",
    enforcement: "P4-02 (planned)",
    status: "open"
  }),
  "RR-06": Object.freeze({
    id: "RR-06",
    category: "context",
    risk: "Each executor maintains its own prompt assembly, so a new ambient fact is easy to forget in one of them.",
    severity: "medium",
    mitigation: "Short term: shared resource-context module (P4-00.5). Long term: lift prompt composition to task-runtime (Phase 5 §15.3 Approach B).",
    enforcement: "src/service/executors/shared/resource-context.mjs (short term); Phase 5 prompt-composer (long term, open)",
    status: "partial",
    current_mitigation: "Shared resource-context module deduplicates ambient-fact injection across the three executors (P4-00.5).",
    outstanding_work: "Phase 5 §15.3 Approach B — promote prompt composition to task-runtime so executors only carry transport, not assembly. Until then a future fact still needs to be added to the shared module by hand."
  })
});

/**
 * Risks whose mitigation actually fired for THIS task. Use this for the
 * per-task UI ("system identified RR-03 and applied capability-based
 * block") so the user sees only what's relevant to the request they made.
 *
 * Returns only `mitigated` entries that were triggered. `partial` entries
 * are *deliberately excluded* — partial means the system-level fix is
 * still owed, which is a project-level concern best surfaced on a system
 * diagnostic page (see `listGlobalOpenRisks`). Showing it on every task
 * would just be UI noise about the same project debt.
 *
 * Open risks the task didn't trigger are also excluded for the same
 * "per-task UI stays focused" reason.
 *
 * Pure function. Pass-through inputs only.
 *
 * @param {object} taskSpec
 * @returns {RegisteredRisk[]}
 */
export function listTaskTriggeredRisks(taskSpec) {
  const risks = [];
  for (const risk of Object.values(RR_REGISTRY)) {
    if (risk.status === "mitigated" && wasMitigationTriggered(risk, taskSpec)) {
      risks.push(risk);
    }
  }
  return risks;
}

/**
 * Project-level open risks — items the system has not fully closed,
 * irrespective of any individual task. Consume this from a system
 * diagnostic page / CI invariant ("every open high-severity risk must
 * have an enforcement task") rather than from per-task UI surfaces.
 *
 * @returns {RegisteredRisk[]}
 */
export function listGlobalOpenRisks() {
  const out = [];
  for (const risk of Object.values(RR_REGISTRY)) {
    if (risk.status === "open" || risk.status === "partial") {
      out.push(risk);
    }
  }
  return out;
}

/**
 * Whether the mitigation for a given risk actually fired for this task.
 * Used to mark "we saw RR-XX" on the contract so a downstream UI can
 * label the decision ("system identified pattern RR-03 and applied
 * capability-based block").
 */
function wasMitigationTriggered(risk, taskSpec) {
  const tp = taskSpec?.tool_policy ?? {};
  switch (risk.id) {
    case "RR-01":
      // Tool-policy-resolver always runs; it fired iff a web policy was set
      // (forbidden / optional / required all count — the resolver decided).
      return Boolean(tp.web_search_fetch?.mode);
    case "RR-02":
      // Forbidden enforcement is enabled iff at least one tool is forbidden.
      return Object.values(tp).some((entry) => entry?.mode === "forbidden")
        || (tp.policy_groups
          && Object.values(tp.policy_groups).some((entry) => entry?.mode === "forbidden"));
    case "RR-03":
      // Capability-based expansion ran iff the resolver emitted a
      // policy_groups entry. Any mode counts (the expansion happens for
      // forbidden / optional / required alike).
      return Boolean(tp.policy_groups && Object.keys(tp.policy_groups).length > 0);
    case "RR-04":
    case "RR-06":
      // Resource-context injection ran for every executor. Treat as
      // "always triggered" so the contract surfaces the mitigation.
      return true;
    default:
      return false;
  }
}

/**
 * Assumption catalogue. Entries materialise only when their predicate
 * holds for the current task — we don't surface "user said X" when the
 * task didn't say X. Each entry includes a confidence drawn from the
 * triggering signal so the UI can render uncertainty.
 *
 * @param {object} taskSpec
 * @param {object} signals
 * @returns {TaskAssumption[]}
 */
export function listAssumptionsForTask(taskSpec, signals) {
  const out = [];
  const sourceScope = signals?.source_scope;
  if (sourceScope?.matched && sourceScope?.hint?.value === "current_context") {
    out.push({
      id: "A-01",
      description: "User's referent (\"这个\", \"这段\", \"the framework\") points at the local project / current context, not external software.",
      confidence: sourceScope.strength === "strong" ? 0.85 : 0.65,
      evidence: sourceScope.evidence ?? [],
      status: "unverified"
    });
  }
  const topicHint = signals?.topic_hint;
  if (topicHint?.matched && topicHint.strength === "strong"
      && (sourceScope?.hint?.value ?? "none") === "none") {
    out.push({
      id: "A-02",
      description: "User named a high-freshness external entity (weather / stock / flight / etc.) and did NOT anchor it to local data, so they want a fresh external lookup.",
      confidence: 0.8,
      evidence: topicHint.evidence ?? [],
      status: "unverified"
    });
  }
  if ((taskSpec?.intent_tags ?? []).includes("connector")) {
    out.push({
      id: "A-03",
      description: "User-message keyword matched a connector-domain pattern (mail / calendar / drive), so the request is about the connector account rather than external research about the same product.",
      confidence: 0.6,
      evidence: [{ type: "intent", source: "isConnectorDomainRequest", reason: "connector intent tag set" }],
      status: "unverified"
    });
  }
  return out;
}

/**
 * Dependency catalogue — resources the task expects to have. A missing
 * dependency does NOT prevent execution; it surfaces in the contract so
 * the executor / LLM can ask the user instead of silently guessing.
 *
 * @param {object} taskSpec
 * @param {object} contextPacket
 * @returns {TaskDependency[]}
 */
export function listDependenciesForTask(taskSpec, contextPacket) {
  const out = [];
  const goal = taskSpec?.goal ?? "";
  const userText = String(taskSpec?.user_goal_text ?? "");
  const hasFiles = Array.isArray(contextPacket?.file_paths) && contextPacket.file_paths.length > 0;
  const hasImages = Array.isArray(contextPacket?.image_paths) && contextPacket.image_paths.length > 0;
  const hasSelectionText = typeof contextPacket?.text === "string" && contextPacket.text.trim().length > 0;
  const codeIntent = /(代码|code|脚本|script|程序|project|框架|framework|repo|module|class|function)/i.test(userText);

  if (codeIntent && goal === "qa" && !hasFiles && !hasSelectionText) {
    out.push({
      id: "D-01",
      description: "Code-related question without an attached file or selection.",
      status: "missing",
      consequence_if_missing: "Answer will be generic or speculative; ask user to attach the file/snippet."
    });
  }
  if (goal === "multimodal_analyze" && !hasImages) {
    out.push({
      id: "D-02",
      description: "Multimodal-analysis goal requires at least one attached image.",
      status: "missing",
      consequence_if_missing: "Cannot run vision pipeline; ask user to attach the image."
    });
  }
  if (taskSpec?.tool_policy?.web_search_fetch?.mode === "required") {
    out.push({
      id: "D-03",
      description: "External web reading is required by policy and depends on network reachability.",
      status: "available",
      consequence_if_missing: "If the network is offline the task degrades to partial_success with a no-results explanation."
    });
  }
  return out;
}

/**
 * Compile the per-task RAID log. The `task_triggered_risks` bucket lists
 * ONLY risks whose mitigation actually fired for this task; project-level
 * open work surfaces via `listGlobalOpenRisks()` from a separate code path
 * (system diagnostic page, CI invariant) so the per-task UI stays focused.
 * Issues bucket starts empty; future work projects realised problems from
 * the audit log into it.
 *
 * @param {{ taskSpec: object, signals: object, contextPacket: object }} input
 * @returns {RaidLog}
 */
export function compileRaidLog({ taskSpec, signals, contextPacket }) {
  return {
    task_triggered_risks: listTaskTriggeredRisks(taskSpec),
    assumptions: listAssumptionsForTask(taskSpec, signals),
    issues: [],
    dependencies: listDependenciesForTask(taskSpec, contextPacket)
  };
}
