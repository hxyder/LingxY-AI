/**
 * code-cli-bridge.mjs — JSON planning mode bridge for code_cli providers.
 *
 * Code CLI providers (Kimi CLI, Claude Code CLI, Codex CLI, Gemini CLI,
 * any user-installed `--print` capable LLM CLI) do not expose a native
 * function-calling endpoint. We bridge them into the agentic planner by:
 *
 *   1. Serialising the planner's `messages` array into a single text prompt
 *      that the CLI can read from stdin (`buildCodeCliChatPrompt`).
 *   2. Appending a clear "JSON tool-call protocol" section that tells the
 *      model how to express tool calls in plain text.
 *   3. Spawning the CLI as a subprocess (`spawnCodeCliChat`).
 *   4. Reading stdout, extracting the assistant text from any JSONL
 *      transcript (Kimi CLI's `--output-format stream-json`) or treating
 *      raw stdout as plain text for CLIs that don't emit JSONL.
 *   5. Parsing the assistant text for JSON `tool_call` blocks and returning
 *      `{ text, tool_calls }` in the same shape as the OpenAI/Anthropic
 *      adapters (`parseJsonToolCalls`).
 *
 * The result: the planner's loop in `planner.mjs` is *completely unchanged*
 * — code_cli providers participate in multi-step tool use exactly like
 * native function-calling providers do.
 */

import { spawnExternal } from "../../core/external-call.mjs";
import { buildCodeCliInvocationArgs } from "../shared/code-cli-invocation.mjs";

/* ------------------------------------------------------------------------ */
/* 1. Prompt building                                                        */
/* ------------------------------------------------------------------------ */

const TOOL_CALL_PROTOCOL = [
  "## Tool calling protocol",
  "",
  "If you need to call a tool, output **exactly one** JSON block at the very end of your reply, in this shape:",
  "",
  "```json",
  "{\"tool_call\": {\"name\": \"<tool_id>\", \"arguments\": { ... }}}",
  "```",
  "",
  "Rules:",
  "- The JSON block must be the LAST thing in your reply. Do not add any text after it.",
  "- The `name` field must be one of the tool ids listed in the system prompt above.",
  "- Use the exact JSON Schema shown in the system prompt's `<tool>` blocks for the `arguments`.",
  "- Do NOT wrap multiple tool calls in one block — call one tool at a time. The runtime will run the tool and call you again with the observation.",
  "- If you have your final answer for the user (no more tool calls needed), reply with the answer in plain text and DO NOT include any JSON tool_call block."
].join("\n");

function renderMessageForPrompt(msg) {
  if (!msg) return "";
  if (msg.role === "system") {
    return `# System\n${stringifyContent(msg.content)}`;
  }
  if (msg.role === "user") {
    return `# User\n${stringifyContent(msg.content)}`;
  }
  if (msg.role === "assistant") {
    const textBlock = stringifyContent(msg.content);
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Replay the assistant's previous tool call as JSON so the CLI sees a
      // consistent format on its second turn.
      const calls = msg.tool_calls.map((call) => ({
        tool_call: {
          name: call.name ?? call.function?.name ?? "",
          arguments: call.arguments ?? call.function?.arguments ?? {}
        }
      }));
      return `# Assistant\n${textBlock}\n\n${calls.map((c) => "```json\n" + JSON.stringify(c, null, 2) + "\n```").join("\n")}`;
    }
    return `# Assistant\n${textBlock}`;
  }
  if (msg.role === "tool") {
    const id = msg.tool_call_id ?? "(unknown)";
    return `# Tool result (${id})\n${stringifyContent(msg.content)}`;
  }
  return `# ${msg.role}\n${stringifyContent(msg.content)}`;
}

function stringifyContent(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text ?? part?.content ?? "")
      .filter(Boolean)
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/**
 * Serialise the planner's `messages` array into a single text prompt that
 * a code_cli provider can consume. The system prompt (rendered upstream by
 * `buildAgenticSystemPrompt`) is preserved verbatim and the JSON tool-call
 * protocol is appended at the end so the model knows the expected output
 * shape regardless of which CLI it is.
 */
export function buildCodeCliChatPrompt({ messages = [] } = {}) {
  const blocks = messages.map(renderMessageForPrompt).filter(Boolean);
  blocks.push(TOOL_CALL_PROTOCOL);
  blocks.push("# Assistant");
  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------------ */
/* 2. Subprocess spawn                                                       */
/* ------------------------------------------------------------------------ */

function pushFlagValue(args, flag, value) {
  if (!value || args.includes(flag)) {
    return;
  }
  args.push(flag, value);
}

function hasAnyFlag(args, ...flags) {
  return args.some((arg) => flags.includes(arg));
}

// Detect whether the provided command path looks like Codex CLI. Reasoning
// effort is Codex-specific, and Codex has its own `exec --json` invocation
// shape rather than Kimi/Claude-style `--print`.
function isCodexCommand(command = "") {
  return /codex(\.exe)?$/i.test(`${command ?? ""}`);
}

function isKimiCommand(command = "") {
  return /kimi(\.exe)?$/i.test(`${command ?? ""}`);
}

function isClaudeCommand(command = "") {
  return /claude(\.exe)?$/i.test(`${command ?? ""}`);
}

function normalizeCodexReasoningEffort(value = "") {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "extra_high" || normalized === "extra-high") return "xhigh";
  if (["low", "medium", "high", "xhigh"].includes(normalized)) return normalized;
  return "";
}

function hasCodexSubcommand(args) {
  const firstPositional = args.find((arg) => !String(arg).startsWith("-"));
  return ["exec", "resume", "review", "help"].includes(`${firstPositional ?? ""}`);
}

function pushCodexConfig(args, key, value) {
  if (!value) return;
  const prefix = `${key}=`;
  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === "-c" || args[index] === "--config") && `${args[index + 1] ?? ""}`.startsWith(prefix)) {
      return;
    }
  }
  args.push("-c", `${key}="${value}"`);
}

function pushPrintFlags(args) {
  if (!hasAnyFlag(args, "--print", "-p")) args.push("--print");
  if (!args.includes("--output-format")) args.push("--output-format", "stream-json");
  if (!args.includes("--input-format")) args.push("--input-format", "text");
}

function buildInvocationArgs({ baseArgs, transport, model, configFile = null, mcpConfigFiles = [], reasoningEffort = "", command = "", imagePaths = [] }) {
  return buildCodeCliInvocationArgs({
    command,
    args: baseArgs,
    transport,
    model,
    configFile,
    mcpConfigFiles,
    reasoningEffort,
    imagePaths
  });
}

/**
 * Spawn a code_cli provider as a subprocess, write the prompt to stdin,
 * and capture stdout/stderr. Returns the raw output for downstream parsing.
 */
function normalizeBridgeTimeoutDiagnostic(stderr, timeoutSeconds) {
  return `${stderr ?? ""}`.replace(
    /\[bridge\] killed after \d+(?:\.\d+)?ms timeout/g,
    `[bridge] killed after ${timeoutSeconds}s timeout`
  );
}

export async function spawnCodeCliChat({
  command,
  args = [],
  env = process.env,
  prompt = "",
  model = null,
  configFile = null,
  mcpConfigFiles = [],
  imagePaths = [],
  transport = "stream_json_print",
  reasoningEffort = "",
  timeoutSeconds = 120,
  abortSignal = null
} = {}) {
  if (!command) {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: "code_cli provider missing `command`",
      exitCode: null,
      timedOut: false,
      spawnError: true
    });
  }

  const invocationArgs = buildInvocationArgs({
    baseArgs: args,
    transport,
    model,
    configFile,
    mcpConfigFiles,
    imagePaths,
    reasoningEffort,
    command
  });

  const result = await spawnExternal(command, invocationArgs, {
    env: {
      ...env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    },
    input: prompt,
    timeoutMs: timeoutSeconds * 1000,
    label: "bridge",
    signal: abortSignal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    timeoutKillSignal: "SIGKILL",
    abortKillSignal: "SIGTERM",
    forceKillAfterMs: 250
  });

  if (result.timedOut) {
    return {
      ...result,
      stderr: normalizeBridgeTimeoutDiagnostic(result.stderr, timeoutSeconds)
    };
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* 3. Stdout parsing                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Extract the final assistant text from a code_cli stdout. Tries each
 * known transport format and falls back to treating the entire stdout as
 * a plain-text reply for CLIs that don't emit a structured transcript.
 */
export function extractAssistantText(stdout, transport = "stream_json_print") {
  if (!stdout) return "";

  if (transport === "stream_json_print") {
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const transcript = [];
    const plainLines = [];
    for (const line of lines) {
      try {
        transcript.push(JSON.parse(line));
      } catch {
        plainLines.push(line);
      }
    }
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const text = extractCliAssistantText(transcript[i]).trim();
      if (text) return text;
    }
    if (plainLines.length > 0) return plainLines.join("\n").trim();
    // No assistant turn parsed → fall through to plain-text fallback
  }

  return stdout.trim();
}

function extractContentText(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(extractContentText).filter(Boolean).join("\n");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.output_text === "string") return content.output_text;
    if (typeof content.message === "string") return content.message;
    if (typeof content.content === "string") return content.content;
    if (content.type === "text" || content.type === "output_text") {
      return extractContentText(content.content ?? content.text ?? content.output_text);
    }
  }
  return "";
}

function extractCliAssistantText(event) {
  if (!event || typeof event !== "object") return "";
  if (event.role === "assistant") {
    return extractContentText(event.content ?? event.message ?? event.text);
  }
  if (event.item?.role === "assistant") {
    return extractContentText(event.item.content ?? event.item.message ?? event.item.text);
  }
  if (event.message?.role === "assistant") {
    return extractContentText(event.message.content ?? event.message.text);
  }
  if (event.type === "agent_message" || event.type === "assistant_message") {
    return extractContentText(event.message ?? event.text ?? event.content);
  }
  if (event.type === "content" || event.type === "message" || event.type === "result") {
    return extractContentText(event.content ?? event.text ?? event.message ?? event.result ?? event.response);
  }
  if (event.type === "item.completed" || event.type === "response.output_item.done") {
    return extractCliAssistantText(event.item ?? event.output ?? event.message);
  }
  return "";
}

/* JSON tool_call parser ---------------------------------------------------- */

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Find candidate JSON blocks inside the assistant text. Returns the parsed
 * objects in document order. Recognises:
 *   - ```json\n...\n``` fenced blocks
 *   - bare {"tool_call": ...} or {"tool_calls": [...]} top-level objects
 */
function findCandidateJsonBlocks(text) {
  const candidates = [];

  // 1. ```json ... ``` fenced blocks
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenced.exec(text))) {
    const parsed = safeJsonParse(match[1].trim());
    if (parsed && typeof parsed === "object") candidates.push({ parsed, raw: match[0], index: match.index });
  }

  // 2. Bare JSON objects on their own lines (greedy match for balanced braces)
  if (candidates.length === 0) {
    // Walk the text once, tracking brace depth, to extract balanced { ... } blocks
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          const slice = text.slice(start, i + 1);
          const parsed = safeJsonParse(slice);
          if (parsed && typeof parsed === "object" && (parsed.tool_call || parsed.tool_calls)) {
            candidates.push({ parsed, raw: slice, index: start });
          }
          start = -1;
        }
      }
    }
  }

  return candidates;
}

function normaliseToolCall(parsed) {
  // Accept either { tool_call: { name, arguments } } or
  // { tool_calls: [ { name, arguments }, ... ] }
  const calls = [];
  if (parsed?.tool_call) {
    calls.push({
      id: parsed.tool_call.id ?? null,
      name: parsed.tool_call.name ?? "",
      arguments: parsed.tool_call.arguments ?? {}
    });
  }
  if (Array.isArray(parsed?.tool_calls)) {
    for (const call of parsed.tool_calls) {
      calls.push({
        id: call.id ?? null,
        name: call.name ?? call.function?.name ?? "",
        arguments: call.arguments ?? call.function?.arguments ?? {}
      });
    }
  }
  return calls.filter((call) => call.name);
}

/**
 * Parse the assistant text for tool_call JSON blocks. Returns an OpenAI-
 * style `{ text, tool_calls }` shape compatible with the planner. When tool
 * calls are found, the JSON block is stripped from the text so the user
 * doesn't see raw JSON in the final reply if the model decides to ignore
 * the protocol and answer directly later.
 */
export function parseJsonToolCalls(assistantText = "") {
  const candidates = findCandidateJsonBlocks(assistantText);
  if (candidates.length === 0) {
    return { text: assistantText.trim(), tool_calls: [] };
  }

  const allCalls = [];
  let trimmedText = assistantText;
  for (const candidate of candidates) {
    const calls = normaliseToolCall(candidate.parsed);
    if (calls.length > 0) {
      allCalls.push(...calls);
      trimmedText = trimmedText.replace(candidate.raw, "").trim();
    }
  }

  return {
    text: trimmedText,
    tool_calls: allCalls
  };
}

/* ------------------------------------------------------------------------ */
/* 4. Top-level entry point used by the provider adapter                    */
/* ------------------------------------------------------------------------ */

/**
 * Run one round of the agentic planner against a code_cli provider.
 * Returns the same shape as the OpenAI / Anthropic adapters' generate():
 *   { text, tool_calls, usage }
 */
export async function runCodeCliChat({ resolved, messages, signal, timeoutSeconds = 120 }) {
  const prompt = buildCodeCliChatPrompt({ messages });
  const result = await spawnCodeCliChat({
    command: resolved.command,
    args: resolved.args ?? [],
    env: resolved.env ?? process.env,
    transport: resolved.transport ?? "stream_json_print",
    model: resolved.model ?? null,
    configFile: resolved.configFile ?? null,
    mcpConfigFiles: resolved.mcpConfigFiles ?? [],
    imagePaths: resolved.imagePaths ?? resolved.image_paths ?? [],
    reasoningEffort: resolved.reasoningEffort ?? "",
    prompt,
    timeoutSeconds,
    abortSignal: signal
  });

  if (result.aborted) {
    const err = new Error("code_cli adapter generate aborted by signal.");
    err.code = "ABORT_ERR";
    throw err;
  }
  if (result.timedOut) {
    throw new Error(`code_cli adapter timed out after ${timeoutSeconds}s. stderr: ${result.stderr.slice(0, 300)}`);
  }
  if (result.spawnError) {
    throw new Error(`code_cli spawn failed: ${result.stderr.slice(0, 300)}`);
  }
  if (!result.ok) {
    throw new Error(`code_cli exited with code ${result.exitCode}. stderr: ${result.stderr.slice(0, 300)}`);
  }

  const assistantText = extractAssistantText(result.stdout, resolved.transport);
  const { text, tool_calls } = parseJsonToolCalls(assistantText);

  return {
    text,
    tool_calls,
    usage: { input_tokens: null, output_tokens: null }
  };
}

// Exported for verify-provider-routing.mjs so tests can assert the
// reasoning-effort flag is injected / suppressed correctly per CLI family.
// Not intended for production consumers — call spawnCodeCliChat instead.
export const __testBuildInvocationArgs = buildInvocationArgs;
