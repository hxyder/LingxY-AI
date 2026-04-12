import { routeIntent } from "./intent-router.mjs";
import { runAgenticPlanner } from "../../executors/agentic/planner.mjs";
import { classifyGoal, NO_DECOMPOSE_GOALS } from "../task-spec.mjs";

const DEFAULT_MAX_SUBTASKS = 6;

// UCA-058: Patterns that indicate a sequential compound action —
// "open X, then do Y" = one intent with ordered steps, NOT two independent tasks.
// Must stay as a single task so llmPlanner can execute both steps in one loop.
const SEQUENTIAL_COMPOUND = /(?:打开|启动|open|launch|运行|run)\s*\S+\s*[，,]\s*(?:帮我|帮|写|发|查|搜|做|生成|起草|draft|write|compose|search|find|create)/i;

// UCA-058: Ambiguity indicators — missing referent means we should ask first,
// not decompose (decomposing an ambiguous request produces meaningless subtasks).
const AMBIGUITY_PATTERNS = /(?:那个|这个|它(?!们)|上次|之前|the\s+(?:file|document|one)|that\s+one)/i;

/**
 * UCA-058: Determine whether a user command should be decomposed.
 * Returns {decompose: false, reason} to skip decomposition entirely,
 * or {decompose: true} to allow it.
 *
 * Philosophy (from LangGraph/CrewAI): decomposition is an EXCEPTION, not the default.
 * Only split when there are 2+ genuinely independent goals.
 */
function shouldDecompose(userCommand) {
  const goal = classifyGoal(userCommand);

  // Rule 1: banned goal families — answer directly, never split
  if (NO_DECOMPOSE_GOALS.has(goal)) {
    return { decompose: false, reason: `goal_no_split:${goal}` };
  }

  // Rule 2: sequential compound — "open X, do Y" stays as one task
  if (SEQUENTIAL_COMPOUND.test(userCommand)) {
    return { decompose: false, reason: "sequential_compound" };
  }

  // Rule 3: ambiguous reference — needs clarification, not decomposition
  if (AMBIGUITY_PATTERNS.test(userCommand)) {
    return { decompose: false, reason: "needs_clarification" };
  }

  // Rule 4: very short commands (<= 10 chars) are almost always single-intent
  if (userCommand.trim().length <= 10) {
    return { decompose: false, reason: "too_short_to_split" };
  }

  return { decompose: true };
}
const HARD_SPLIT = /[。；;\n]+/g;
const SOFT_SPLIT = /(?:\s+(?:然后|接着|再|并且|同时|and then|then|and)\s+|\s*&&\s*)/gi;
const COMMA_SPLIT = /[，,]+/g;

function splitAndTrim(text, pattern) {
  return String(text ?? "")
    .split(pattern)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function normalizeSegments(text) {
  const firstPass = splitAndTrim(text, HARD_SPLIT);
  const secondPass = firstPass.flatMap((segment) => splitAndTrim(segment, SOFT_SPLIT));
  const thirdPass = secondPass.flatMap((segment) => splitAndTrim(segment, COMMA_SPLIT));
  return thirdPass.filter((segment) => segment.length >= 2);
}

function buildRuleSubtasks(userCommand) {
  const segments = normalizeSegments(userCommand);
  if (segments.length < 2) {
    return { shouldUseRules: false, subtasks: [] };
  }

  const routed = segments.map((segment) => ({
    command: segment,
    route: routeIntent(segment)
  }));

  const signatures = new Set(routed.map(({ route }) => JSON.stringify({
    intent: route.intent,
    tags: route.intent_tags ?? [],
    formats: route.suggested_formats ?? [],
    executor: route.executor
  })));

  if (signatures.size < 2) {
    return { shouldUseRules: false, subtasks: [] };
  }

  return {
    shouldUseRules: true,
    subtasks: routed.map(({ command, route }) => ({
      command,
      suggested_executor: route.suggested_executor ?? route.executor,
      suggested_formats: route.suggested_formats ?? [],
      dependency_idx: null
    }))
  };
}

function extractJsonCandidate(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const raw = String(text);
  const firstBrace = raw.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  for (let i = firstBrace; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      return raw.slice(firstBrace, i + 1).trim();
    }
  }
  return null;
}

/**
 * UCA-056: Validate decomposer output schema before normalizing.
 * Returns {valid, error} — invalid output is explicitly surfaced, not silently dropped.
 */
function validateDecomposerOutput(raw) {
  if (!raw || typeof raw !== "object") {
    return { valid: false, error: "decomposer output must be an object" };
  }
  const list = Array.isArray(raw) ? raw : raw.subtasks;
  if (!Array.isArray(list)) {
    return { valid: false, error: `subtasks must be an array, got ${typeof list}` };
  }
  for (const entry of list) {
    const command = String(entry?.command ?? entry?.task ?? entry?.prompt ?? "").trim();
    if (!command) {
      return { valid: false, error: `each subtask must have a non-empty 'command' field` };
    }
  }
  return { valid: true, error: null };
}

function normaliseSubtasks(raw, fallbackCommand) {
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.subtasks) ? raw.subtasks : []);
  const normalized = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i] ?? {};
    const command = String(entry.command ?? entry.task ?? entry.prompt ?? "").trim();
    if (!command) continue;
    const route = routeIntent(command);
    normalized.push({
      command,
      suggested_executor: entry.suggested_executor ?? entry.executor ?? route.suggested_executor ?? route.executor,
      suggested_formats: Array.isArray(entry.suggested_formats)
        ? entry.suggested_formats
        : (entry.format ? [entry.format] : route.suggested_formats ?? []),
      dependency_idx: Number.isInteger(entry.dependency_idx)
        ? entry.dependency_idx
        : (Number.isInteger(entry.depends_on) ? entry.depends_on : null)
    });
  }

  if (normalized.length > 0) {
    return normalized;
  }

  if (fallbackCommand) {
    const route = routeIntent(fallbackCommand);
    return [{
      command: fallbackCommand,
      suggested_executor: route.suggested_executor ?? route.executor,
      suggested_formats: route.suggested_formats ?? [],
      dependency_idx: null
    }];
  }

  return [];
}

/**
 * UCA-056: runLlmDecomposition now returns a structured result object so callers
 * can distinguish "LLM returned a valid single-task" from "decomposer failed silently".
 *
 * Returns: { subtasks, error?, fallback? }
 *   - subtasks: normalized array (may be single-task fallback)
 *   - error: "decomposer_invalid_output" | "decomposer_parse_error" | null
 *   - fallback: "single_task" | null (set when we fell back due to error)
 */
async function runLlmDecomposition({ userCommand, runtime, contextPacket, maxSubtasks }) {
  if (typeof runtime?.intentDecomposer === "function") {
    const injected = await runtime.intentDecomposer({
      userCommand,
      contextPacket,
      maxSubtasks
    });
    const validation = validateDecomposerOutput(injected);
    if (!validation.valid) {
      return {
        subtasks: normaliseSubtasks({}, userCommand),
        error: "decomposer_invalid_output",
        fallback: "single_task",
        reason: validation.error
      };
    }
    return { subtasks: normaliseSubtasks(injected, userCommand).slice(0, maxSubtasks), error: null };
  }

  const instruction = [
    "Decompose the user's request into independent subtasks.",
    "Return JSON only, no prose, using this schema:",
    "{ \"subtasks\": [ { \"command\": string, \"suggested_executor\": string, \"suggested_formats\": string[], \"dependency_idx\": number|null } ] }",
    "STRICT RULES (violation = wrong answer):",
    "1) Use the user's language.",
    "2) Keep each command concise and self-contained.",
    "3) SINGLE-INTENT: If the request is a question, list, summary, translation, reminder, or explanation → return EXACTLY ONE subtask.",
    "4) SEQUENTIAL COMPOUND: 'Open app X and do Y inside it' = ONE subtask (ordered steps, not independent goals).",
    "5) Only split when there are 2+ GENUINELY INDEPENDENT goals that could run in parallel (different apps, different targets, no shared state).",
    "6) If the command is ambiguous (refers to 'it', 'that file', 'the previous one') → return ONE subtask with the original command unchanged.",
    "7) Do not call any tools."
  ].join("\n");

  const decomposerTask = {
    user_command: userCommand,
    context_packet: {
      schema_version: "1.0",
      context_id: contextPacket?.context_id ?? `ctx_decompose_${Date.now()}`,
      trace_id: contextPacket?.trace_id ?? `trace_decompose_${Date.now()}`,
      source_type: "decomposer",
      source_app: "uca.runtime",
      capture_mode: "system",
      security_level: "internal",
      redaction_applied: false,
      text: instruction,
      captured_at: new Date().toISOString()
    }
  };

  const result = await runAgenticPlanner({
    task: decomposerTask,
    runtime,
    tools: [],
    maxIterations: 1
  });

  const candidate = extractJsonCandidate(result?.finalText ?? "");
  if (!candidate) {
    return {
      subtasks: normaliseSubtasks({}, userCommand),
      error: "decomposer_no_json",
      fallback: "single_task",
      reason: "LLM returned no JSON candidate"
    };
  }

  try {
    const parsed = JSON.parse(candidate);
    // UCA-056: Validate schema before normalizing (no more silent [] return)
    const validation = validateDecomposerOutput(parsed);
    if (!validation.valid) {
      return {
        subtasks: normaliseSubtasks({}, userCommand),
        error: "decomposer_invalid_output",
        fallback: "single_task",
        reason: validation.error
      };
    }
    const normalized = normaliseSubtasks(parsed, userCommand);
    return { subtasks: normalized.slice(0, maxSubtasks), error: null };
  } catch (parseError) {
    return {
      subtasks: normaliseSubtasks({}, userCommand),
      error: "decomposer_parse_error",
      fallback: "single_task",
      reason: parseError.message
    };
  }
}

export async function decomposeUserCommand({
  userCommand,
  runtime,
  contextPacket = null,
  mode = "auto",
  maxSubtasks = DEFAULT_MAX_SUBTASKS
} = {}) {
  const fallback = normaliseSubtasks({ subtasks: [] }, userCommand);
  if (!userCommand) {
    return { subtasks: fallback, usedLLM: false, reason: "empty_command" };
  }

  // UCA-058: Guard — only applies in "auto" mode (the normal production path).
  // "rules_only" is an explicit test/override mode that bypasses this guard.
  // "force" is a signal to always split regardless.
  if (mode === "auto") {
    const guard = shouldDecompose(userCommand);
    if (!guard.decompose) {
      return { subtasks: fallback, usedLLM: false, reason: guard.reason };
    }
  }

  if (mode === "rules_only") {
    const ruleResult = buildRuleSubtasks(userCommand);
    if (ruleResult.shouldUseRules) {
      return { subtasks: ruleResult.subtasks.slice(0, maxSubtasks), usedLLM: false, reason: "rule_split" };
    }
    return { subtasks: fallback, usedLLM: false, reason: "rules_only_fallback" };
  }

  if (!runtime) {
    return { subtasks: fallback, usedLLM: false, reason: "missing_runtime" };
  }

  let llmResult = { subtasks: fallback, error: null };
  try {
    llmResult = await runLlmDecomposition({
      userCommand,
      runtime,
      contextPacket,
      maxSubtasks
    });
  } catch (error) {
    llmResult = {
      subtasks: fallback,
      error: "decomposer_exception",
      fallback: "single_task",
      reason: error.message
    };
  }

  if (llmResult.error) {
    // UCA-056: surface the error so callers can log/monitor — but still continue with fallback
    return {
      subtasks: llmResult.subtasks,
      usedLLM: false,
      reason: llmResult.error,
      decomposerError: llmResult.error,
      decomposerErrorReason: llmResult.reason
    };
  }

  if (llmResult.subtasks.length > 0) {
    return { subtasks: llmResult.subtasks, usedLLM: true, reason: "llm_decompose" };
  }

  return { subtasks: fallback, usedLLM: false, reason: "llm_fallback" };
}
