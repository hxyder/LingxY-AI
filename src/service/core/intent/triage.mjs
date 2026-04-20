/**
 * Triage — the single entry point that sits at the top of task submission.
 *
 * Takes a user command + context and returns a TriageResult telling the
 * caller which lane to run in. Zero language-bound intent classification:
 * regex is limited to structural signals (URL shape, digit+unit time
 * phrase, count of clauses) — NOT keywords like "邮件" or "image". Semantic
 * interpretation happens in the LLM-backed lanes (schedule, single_turn,
 * dag_planner).
 *
 * TriageResult =
 *   | { lane: "fast_path",   tool, args, tier }         // 0-LLM, pure code
 *   | { lane: "schedule",    task, schedule, message }  // schedule LLM said defer
 *   | { lane: "clarify",     task, message }            // schedule LLM said ask
 *   | { lane: "single_turn", userCommand }              // default; agent-loop
 *   | { lane: "dag_planner", userCommand, hint }        // Phase 2+
 */

import { tryFastPath } from "../router/fast-path-router.mjs";
import { maybeHandleAsPlan } from "./plan-executor.mjs";

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
  // Dependency injections for tests.
  fastPath = tryFastPath,
  handleAsPlan = maybeHandleAsPlan
}) {
  const initialCommand = String(userCommand ?? "");

  // ── 1. Fast path: pure-code deterministic shortcuts ────────────────────
  //    open URL, launch named app, copy clipboard, translation_fast.
  try {
    const fast = fastPath(initialCommand, contextPacket ?? {});
    if (fast) {
      return { lane: "fast_path", ...fast };
    }
  } catch { /* fast_path is best-effort; fall through if it throws */ }

  // ── 2. Schedule intercept: trigger detects time phrase, LLM decides ───
  //    The LLM (understand.mjs) chooses schedule / immediate / clarify.
  //    - schedule → plan-executor builds the schedule and returns handled=true
  //    - clarify  → plan-executor returns handled=true with a question task
  //    - immediate → falls through unchanged OR returns rewrittenCommand
  let effectiveCommand = initialCommand;
  try {
    const planned = await handleAsPlan({ runtime, userCommand: initialCommand, contextPacket, executionMode });
    if (planned?.handled) {
      const lane = planned.task?.sub_status === "clarify" ? "clarify" : "schedule";
      return {
        lane,
        task: planned.task,
        schedule: planned.schedule ?? null,
        message: planned.message ?? null
      };
    }
    if (typeof planned?.rewrittenCommand === "string" && planned.rewrittenCommand.trim()) {
      effectiveCommand = planned.rewrittenCommand.trim();
    }
  } catch { /* plan layer is best-effort; fall through */ }

  // ── 3. Complexity score → single_turn (default) or dag_planner (future)
  //    Phase 1: we always land on single_turn. The dag_planner lane is
  //    declared so downstream code can branch on it once Phase 2 is live;
  //    until then we keep every request on the proven agent-loop.
  const complexity = scoreComplexity(effectiveCommand);
  const lane = complexity >= 0.7 ? "dag_planner" : "single_turn";

  // Feature flag: DAG planner is gated until Phase 2 ships. Even if the
  // score crosses the threshold, we stay on single_turn until the planner
  // is wired in. The lane label still surfaces in the triage result so
  // telemetry can measure how often we'd have escalated.
  const DAG_PLANNER_ENABLED = runtime?.featureFlags?.dagPlanner === true;
  if (lane === "dag_planner" && !DAG_PLANNER_ENABLED) {
    return { lane: "single_turn", userCommand: effectiveCommand, complexity, intendedLane: "dag_planner" };
  }

  return { lane, userCommand: effectiveCommand, complexity };
}
