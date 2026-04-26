/**
 * UCA-077 P2-04: TaskContract — the structured "what does the user want"
 * object that the upgrade plan §1.4 called for.
 *
 * Why a separate type alongside TaskSpec?
 * --------------------------------------
 * TaskSpec grew organically and now holds policy decisions, execution
 * scaffolding, success rules, source pointers, and intent tags all in one
 * record. That made it hard to reason about which field is *intent* (what
 * the user wants), which is *policy* (what the system will / will not do),
 * and which is *plan* (the executor + steps). TaskContract isolates the
 * intent layer so future consumers (Phase 3 graph executor, Phase 4
 * specialists) can read a clean signal of "what" without re-deriving it
 * from a half-dozen TaskSpec fields.
 *
 * Phase 2 ships TaskContract as **read-only metadata** attached to the
 * TaskSpec — every existing consumer keeps reading TaskSpec untouched.
 * Phase 3 will start migrating callers; Phase 4 may rename TaskSpec to
 * TaskExecutionSpec once the contract is the canonical intent record.
 */

import { compileRaidLog } from "./risk-register.mjs";

/**
 * @typedef {"chat"|"qa"|"analyze"|"search"|"artifact"|"tool_action"
 *          |"desktop_action"|"translate"|"multimodal"|"workflow"} TaskMode
 */

/**
 * @typedef {"none"|"selection"|"uploaded_files"|"current_context"
 *          |"local_project"|"local_app"|"browser_page"|"external_world"} SourceScope
 */

/**
 * @typedef {"conversation"|"markdown"|"file"|"docx"|"pptx"|"xlsx"|"pdf"
 *          |"html"|"csv"|"dashboard"} OutputKind
 */

/**
 * @typedef {Object} OutputContract
 * @property {OutputKind} kind
 * @property {boolean}    artifact_required
 * @property {boolean}    user_visible_summary_required
 */

/**
 * @typedef {Object} ToolPolicyIntent
 * @property {"forbidden"|"optional"|"required"} web
 * @property {"forbidden"|"optional"|"required"} file
 * @property {"forbidden"|"optional"|"required"} desktop
 * @property {"forbidden"|"optional"|"required"} connector
 */

/**
 * @typedef {Object} TaskContract
 * @property {TaskMode}        mode
 * @property {string}          goal           // verbatim from TaskSpec.goal
 * @property {string}          goal_text      // user's original input
 * @property {SourceScope}     source_scope
 * @property {OutputContract}  output_contract
 * @property {ToolPolicyIntent} tool_policy_intent
 * @property {{ level: "low"|"medium"|"high", approval_required: boolean }} risk
 * @property {number}          confidence     // 0..1, heuristic
 * @property {import("../intent/signals/_signal-types.mjs").Evidence[]} evidence
 * @property {import("./risk-register.mjs").RaidLog} raid_log
 *           // P4-RR: full Risks/Assumptions/Issues/Dependencies snapshot.
 *           // Issues is empty at compile time; future work projects from audit log.
 */

const GOAL_TO_MODE = Object.freeze({
  qa: "qa",
  search_and_answer: "search",
  analyze_and_report: "analyze",
  generate_document: "artifact",
  open_or_reveal_file: "tool_action",
  transform_existing_file: "artifact",
  launch_and_act: "desktop_action",
  schedule_or_notify: "tool_action",
  translate: "translate",
  multimodal_analyze: "multimodal"
});

const ARTIFACT_KIND_TO_OUTPUT_KIND = Object.freeze({
  pptx: "pptx",
  docx: "docx",
  xlsx: "xlsx",
  pdf: "pdf",
  md: "markdown",
  html: "html",
  csv: "csv",
  txt: "markdown"
});

/**
 * Build a TaskContract from the inputs the orchestrator already has. Pure
 * function — no signals re-derivation, no LLM, no IO.
 *
 * @param {{ taskSpec: object, signals: object, contextPacket: object }} input
 * @returns {TaskContract}
 */
export function compileTaskContract({ taskSpec, signals, contextPacket }) {
  if (!taskSpec) throw new Error("compileTaskContract: taskSpec is required");
  if (!signals)  throw new Error("compileTaskContract: signals are required");

  const mode = GOAL_TO_MODE[taskSpec.goal] ?? "qa";
  const sourceScope = signals.source_scope?.matched
    ? (signals.source_scope.hint?.value ?? "selection")
    : "none";

  const artifactRequired = Boolean(taskSpec.artifact?.required);
  const outputKind = artifactRequired
    ? (ARTIFACT_KIND_TO_OUTPUT_KIND[taskSpec.artifact?.kind] ?? "file")
    : "conversation";

  const evidence = collectEvidence(signals, taskSpec);

  return {
    mode,
    goal: taskSpec.goal,
    goal_text: taskSpec.user_goal_text ?? "",
    source_scope: /** @type {import("./task-contract.mjs").SourceScope} */ (sourceScope),
    output_contract: {
      kind: /** @type {import("./task-contract.mjs").OutputKind} */ (outputKind),
      artifact_required: artifactRequired,
      // Even when an artifact is the deliverable, the assistant should still
      // give the user a one-line / one-paragraph summary of what it produced
      // — this is the rule §6 in agentic prompt-builder. Pure conversation
      // mode of course always wants the visible reply.
      user_visible_summary_required: true
    },
    tool_policy_intent: {
      web: taskSpec.tool_policy?.web_search_fetch?.mode ?? "forbidden",
      // Phase 2 only models the web axis end-to-end. The other three axes
      // are recorded as "optional" placeholders so downstream consumers
      // can read them without crashing; Phase 3 wires real resolvers.
      file: artifactRequired ? "required" : "optional",
      desktop: taskSpec.goal === "launch_and_act" ? "required" : "optional",
      connector: signals?.source_scope?.hint?.value === "uploaded_files" ? "optional" : "optional"
    },
    risk: deriveRisk(taskSpec, contextPacket),
    confidence: deriveConfidence(signals, taskSpec),
    evidence,
    raid_log: compileRaidLog({ taskSpec, signals, contextPacket })
  };
}

function collectEvidence(signals, taskSpec) {
  const evidence = [];
  for (const name of ["explicit_external", "explicit_entity", "source_scope", "explicit_search", "weak_freshness"]) {
    const signal = signals?.[name];
    if (signal?.matched) evidence.push(...signal.evidence);
  }
  if (taskSpec.tool_policy?.web_search_fetch?.evidence) {
    for (const item of taskSpec.tool_policy.web_search_fetch.evidence) {
      // De-dup by source so we don't double-list the same regex hit.
      if (!evidence.some((e) => e.source === item.source && e.matched === item.matched)) {
        evidence.push(item);
      }
    }
  }
  return evidence;
}

function deriveRisk(taskSpec, contextPacket) {
  // Phase 2 risk model is intentionally narrow — only the cases the system
  // already treated as approval-gated (action goals, connector writes).
  const goal = taskSpec.goal;
  if (goal === "launch_and_act") {
    return { level: "medium", approval_required: false };
  }
  if (goal === "transform_existing_file") {
    return { level: "medium", approval_required: false };
  }
  // Connector writes are flagged "high" by intent-router today; mirror that.
  const intentTags = Array.isArray(taskSpec.intent_tags) ? taskSpec.intent_tags : [];
  if (intentTags.includes("connector") && /(发送|发邮件|send\s+email|create\s+event)/i.test(taskSpec.user_goal_text ?? "")) {
    return { level: "high", approval_required: true };
  }
  if (contextPacket?.security_level === "confidential") {
    return { level: "high", approval_required: true };
  }
  return { level: "low", approval_required: false };
}

function deriveConfidence(signals, taskSpec) {
  // Heuristic floor of 0.5 (we always have *some* classification). Each
  // strong signal raises confidence; an empty signal bundle keeps us at
  // the floor.
  let score = 0.5;
  if (signals?.explicit_external?.matched) score += 0.2;
  if (signals?.explicit_entity?.matched) score += 0.15;
  if (signals?.source_scope?.matched && signals.source_scope.strength === "strong") score += 0.15;
  if (signals?.explicit_search?.matched) score += 0.05;
  if (taskSpec?.tool_policy?.web_search_fetch?.mode === "required") score += 0.05;
  return Math.min(1, Number(score.toFixed(2)));
}
