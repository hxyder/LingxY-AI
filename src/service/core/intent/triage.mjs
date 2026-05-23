/**
 * Triage — the single entry point that sits at the top of task submission.
 *
 * Takes a user command + context and returns a TriageResult telling the
 * caller which lane to run in. Zero language-bound intent classification:
 * regex is limited to structural signals (URL shape, digit+unit time
 * phrase, count of clauses) — NOT keywords like "邮件" or "image". Semantic
 * interpretation happens in ONE LLM call (the SemanticRouter, which now
 * subsumes the legacy `understand.mjs` schedule/clarify/immediate verdict
 * via the `interpretation` field on its tool schema).
 *
 * TriageResult =
 *   | { lane: "schedule",    task, schedule, message }  // SR said defer
 *   | { lane: "clarify",     task, message }            // SR said ask
 *   | { lane: "single_turn", userCommand, contextPacket } // default; agent-loop. The
 *                                                        // packet carries
 *                                                        // semantic_router_decision/
 *                                                        // _rejection so downstream
 *                                                        // preflight is a no-op.
 *   | { lane: "dag_planner", userCommand, hint }        // Phase 2+
 */

import { applySemanticRouterPreflight } from "./router-preflight.mjs";
import { interpretationOf } from "./semantic-router.mjs";
import { hasTimePhrase } from "./trigger.mjs";
import {
  buildScheduleFromDecision,
  createClarifyTaskRecord,
  createScheduledTaskRecord,
  formatRunAtRelative
} from "./plan-executor.mjs";

/**
 * Rough structural complexity score. Cheap, deterministic, non-semantic.
 * Intended to flag commands that *structurally* look like they decompose
 * into multiple steps — not to classify what they mean. Anything > 0.7
 * suggests the DAG planner could help (Phase 2+). Below threshold the
 * single-turn agent handles it.
 */
export function scoreComplexity(userCommand = "") {
  const text = String(userCommand ?? "").trim();
  if (!text) return 0;

  let score = 0;

  // Length — very long commands are more likely to compose multiple steps.
  if (text.length > 120) score += 0.25;
  else if (text.length > 60) score += 0.1;

  // Multi-clause punctuation: Chinese comma / enumeration "、" / semicolon
  // / newline. Language-agnostic count.
  const clauseSeparators = (text.match(/[，,、；;\n]/g) ?? []).length;
  if (clauseSeparators >= 3) score += 0.4;
  else if (clauseSeparators >= 2) score += 0.2;

  // Enumeration quantifier — "all/every/each 的" + whitespace-and-noun
  // pattern. Not anchored to a specific noun word, so it works for any
  // language the user writes the noun in.
  // JavaScript \b only anchors ASCII word boundaries, so we drop it for the
  // Chinese literals (which are "\W" to the regex engine).
  if (/(所有|全部|每一?个|每张|\beach\b|\bevery\b|\ball of the\b)/i.test(text)) {
    score += 0.2;
  }

  // Multiple imperative-looking verbs. We don't know which language the
  // command is in; instead we check punctuation density and verb proxies.
  // "然后 / 接着 / 再 / 之后 / and then / , then" — these are
  // conjunctions/connectives, which are MORE language-specific but still
  // safer than keyword classification because a false negative just means
  // we route to single-turn, which can still handle compound intents.
  if (/(然后|接着|再然后|之后|and\s+then|,\s*then|; then)/i.test(text)) {
    score += 0.3;
  }

  return Math.min(1, score);
}

export async function triage({
  runtime,
  userCommand,
  contextPacket = null,
  executionMode,
  // Background submissions (overlay/console chat) want task_created emitted
  // ASAP and defer SR to execute(). Triage must respect that: when the
  // command has no time phrase, schedule lane is impossible and we can skip
  // the SR call entirely. When it DOES have a time phrase, schedule
  // detection is worth the latency hit (the alternative is mis-routing the
  // task to single_turn and acting on it now). Foreground submissions
  // always run SR upfront.
  background = false,
  // Dependency injection for tests.
  preflight = applySemanticRouterPreflight
}) {
  const initialCommand = String(userCommand ?? "");
  const inputContextPacket = contextPacket ?? {};

  // ── 1. Front classifier: ONE LLM call (SemanticRouter with the merged
  //    interpretation field). Returns the enriched packet with
  //    semantic_router_decision/_rejection stamped. Fail-safe: on any
  //    error it returns the original packet untouched, and we treat that
  //    as `interpretation = "immediate"`.
  //
  //    Latency exit: in background mode, only run SR when there's a time
  //    phrase to disambiguate (schedule vs immediate). Without a time
  //    phrase, schedule/clarify lanes can't fire usefully — schedule is
  //    impossible, and clarify can defer to the executor's own clarify
  //    handling. This keeps task_created snappy for the dominant chat
  //    path.
  let enrichedContextPacket = inputContextPacket;
  if (!hasTimePhrase(initialCommand)) {
    return {
      lane: scoreComplexity(initialCommand) >= 0.7
        && runtime?.featureFlags?.dagPlanner === true
        ? "dag_planner"
        : "single_turn",
      userCommand: initialCommand,
      contextPacket: inputContextPacket,
      complexity: scoreComplexity(initialCommand)
    };
  }
  try {
    enrichedContextPacket = await preflight({
      userCommand: initialCommand,
      contextPacket: inputContextPacket
    }) ?? inputContextPacket;
  } catch { /* preflight is best-effort; fall through with the original packet */ }

  const decision = enrichedContextPacket?.semantic_router_decision ?? null;
  const interpretation = interpretationOf(decision);

  // ── 2. Schedule lane: SR said defer this whole task to a future moment.
  if (interpretation === "schedule"
      && decision?.schedule_at
      && decision?.residual_command) {
    const schedule = buildScheduleFromDecision({
      runtime,
      userCommand: initialCommand,
      contextPacket: enrichedContextPacket,
      executionMode,
      runAtIso: decision.schedule_at,
      residualCommand: decision.residual_command,
      decision
    });
    if (schedule) {
      const replyText = `已安排 ${formatRunAtRelative(schedule.next_run_at)} 执行：${decision.residual_command}`;
      const task = createScheduledTaskRecord({
        runtime,
        userCommand: initialCommand,
        contextPacket: enrichedContextPacket,
        executionMode,
        replyText,
        schedule
      });
      return { lane: "schedule", task, schedule, message: replyText };
    }
    // Scheduler unavailable — fall through to single_turn so the user
    // still gets *something* rather than a silent drop.
  }

  // ── 3. Clarify lane: SR said it cannot proceed without one more answer.
  if (interpretation === "needs_clarification"
      && typeof decision?.clarification_question === "string"
      && decision.clarification_question.trim()) {
    const task = createClarifyTaskRecord({
      runtime,
      userCommand: initialCommand,
      contextPacket: enrichedContextPacket,
      executionMode,
      clarificationQuestion: decision.clarification_question
    });
    return { lane: "clarify", task, message: decision.clarification_question };
  }

  // ── 4. Default: single_turn (or dag_planner once Phase 2 ships).
  //    Carry the enriched packet so context-submission's preflight is a
  //    no-op cache (decision is already stamped).
  const complexity = scoreComplexity(initialCommand);
  const lane = complexity >= 0.7 ? "dag_planner" : "single_turn";

  const DAG_PLANNER_ENABLED = runtime?.featureFlags?.dagPlanner === true;
  if (lane === "dag_planner" && !DAG_PLANNER_ENABLED) {
    return {
      lane: "single_turn",
      userCommand: initialCommand,
      contextPacket: enrichedContextPacket,
      complexity,
      intendedLane: "dag_planner"
    };
  }

  return { lane, userCommand: initialCommand, contextPacket: enrichedContextPacket, complexity };
}
