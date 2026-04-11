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

import { spawn } from "node:child_process";

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

function buildInvocationArgs({ baseArgs, transport, model, configFile = null, mcpConfigFiles = [] }) {
  const args = [...(Array.isArray(baseArgs) ? baseArgs : [])];

  // Kimi CLI / Claude Code CLI / Codex CLI / Gemini CLI all support `--print`
  // mode where they read prompt from stdin and emit a final response. The
  // exact flag set differs slightly per CLI; we apply Kimi CLI's known-good
  // shape when `transport === "stream_json_print"` and otherwise pass the
  // user-provided args verbatim (advanced users can encode their CLI's
  // flags directly in `provider.args`).
  if (transport === "stream_json_print") {
    if (!args.includes("--print")) args.push("--print");
    if (!args.includes("--output-format")) args.push("--output-format", "stream-json");
    if (!args.includes("--input-format")) args.push("--input-format", "text");
    pushFlagValue(args, "--model", model);
    pushFlagValue(args, "--config-file", configFile);
    for (const mcpConfigFile of mcpConfigFiles ?? []) {
      if (mcpConfigFile) {
        args.push("--mcp-config-file", mcpConfigFile);
      }
    }
  }

  return args;
}

/**
 * Spawn a code_cli provider as a subprocess, write the prompt to stdin,
 * and capture stdout/stderr. Returns the raw output for downstream parsing.
 */
export function spawnCodeCliChat({
  command,
  args = [],
  env = process.env,
  prompt = "",
  model = null,
  configFile = null,
  mcpConfigFiles = [],
  transport = "stream_json_print",
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
    mcpConfigFiles
  });

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, invocationArgs, {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: error.message,
        exitCode: null,
        timedOut: false,
        spawnError: true
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const cleanup = () => {
      try { abortSignal?.removeEventListener?.("abort", onAbort); } catch { /* noop */ }
      clearTimeout(killTimer);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* noop */ }
      finish({
        ok: false,
        stdout,
        stderr: stderr + `\n[bridge] killed after ${timeoutSeconds}s timeout`,
        exitCode: null,
        timedOut: true,
        spawnError: false
      });
    }, timeoutSeconds * 1000);

    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* noop */ }
      }, 250);
      finish({
        ok: false,
        stdout,
        stderr: stderr + "\n[bridge] aborted by signal",
        exitCode: null,
        timedOut: false,
        spawnError: false,
        aborted: true
      });
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (error) => {
      finish({
        ok: false,
        stdout,
        stderr: stderr + `\n${error.message}`,
        exitCode: null,
        timedOut: false,
        spawnError: true
      });
    });

    child.on("close", (code) => {
      finish({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
        timedOut: false,
        spawnError: false
      });
    });

    try {
      child.stdin?.write(prompt);
      child.stdin?.end();
    } catch (error) {
      finish({
        ok: false,
        stdout,
        stderr: stderr + `\n${error.message}`,
        exitCode: null,
        timedOut: false,
        spawnError: true
      });
    }
  });
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
    // Kimi CLI emits one JSON object per line, each containing a `role` and
    // `content` field. The final assistant message is the most recent line
    // with `role === "assistant"`.
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const transcript = [];
    for (const line of lines) {
      try {
        transcript.push(JSON.parse(line));
      } catch {
        // Lines that aren't JSON are kept as plain text — Kimi CLI sometimes
        // mixes log lines into stdout.
      }
    }
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const msg = transcript[i];
      if (msg?.role !== "assistant") continue;
      const parts = Array.isArray(msg.content) ? msg.content : [];
      const text = parts
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) return text;
      if (typeof msg.content === "string" && msg.content.trim()) return msg.content.trim();
    }
    // No assistant turn parsed → fall through to plain-text fallback
  }

  return stdout.trim();
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
