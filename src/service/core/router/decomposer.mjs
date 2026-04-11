import { routeIntent } from "./intent-router.mjs";
import { runAgenticPlanner } from "../../executors/agentic/planner.mjs";

const DEFAULT_MAX_SUBTASKS = 6;
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

function normaliseSubtasks(raw, fallbackCommand) {
  const list = Array.isArray(raw) ? raw : raw?.subtasks ?? [];
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

async function runLlmDecomposition({ userCommand, runtime, contextPacket, maxSubtasks }) {
  const instruction = [
    "Decompose the user's request into independent subtasks.",
    "Return JSON only, no prose, using this schema:",
    "{ \"subtasks\": [ { \"command\": string, \"suggested_executor\": string, \"suggested_formats\": string[], \"dependency_idx\": number|null } ] }",
    "Rules:",
    "1) Use the user's language.",
    "2) Keep each command concise and self-contained.",
    "3) If the request is already single-intent, return one subtask.",
    "4) Do not call any tools."
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
  if (!candidate) return [];

  try {
    const parsed = JSON.parse(candidate);
    const normalized = normaliseSubtasks(parsed, userCommand);
    return normalized.slice(0, maxSubtasks);
  } catch {
    return [];
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

  if (mode !== "llm") {
    const ruleResult = buildRuleSubtasks(userCommand);
    if (ruleResult.shouldUseRules) {
      return { subtasks: ruleResult.subtasks.slice(0, maxSubtasks), usedLLM: false, reason: "rule_split" };
    }
    if (mode === "rules_only") {
      return { subtasks: fallback, usedLLM: false, reason: "rules_only_fallback" };
    }
  }

  if (!runtime) {
    return { subtasks: fallback, usedLLM: false, reason: "missing_runtime" };
  }

  const llmSubtasks = await runLlmDecomposition({
    userCommand,
    runtime,
    contextPacket,
    maxSubtasks
  });

  if (llmSubtasks.length > 0) {
    return { subtasks: llmSubtasks, usedLLM: true, reason: "llm_decompose" };
  }

  return { subtasks: fallback, usedLLM: false, reason: "llm_fallback" };
}
