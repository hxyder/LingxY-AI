/**
 * Provider adapter — the provider-agnostic chat layer used by the agentic
 * planner and (soon) by every executor that needs to call an LLM.
 *
 * The adapter wraps a `resolved` provider object (from
 * `resolveProviderForTask`) and exposes a single uniform method:
 *
 *     const { text, tool_calls, usage } = await adapter.generate({
 *       messages,          // OpenAI-style [{role, content}]
 *       tools,             // OpenAI/Anthropic-style tool schemas, optional
 *       maxTokens,         // optional, defaults to 2048
 *       signal,            // AbortSignal, optional
 *       fetchImpl          // optional fetch override for tests
 *     });
 *
 * Supported provider kinds:
 *   - `anthropic`   : POST /v1/messages, with native tool_use blocks
 *   - `openai`      : POST /chat/completions, with native function/tool_calls
 *                     (covers DeepSeek, Kimi API, vLLM, Azure compat, etc.)
 *   - `ollama`      : POST /api/chat (tool support depends on Ollama version)
 *   - `code_cli`    : delegates to the Kimi CLI subprocess runtime. This path
 *                     is *not* used by the planner's generate() yet — commit 2
 *                     will add a JSON planning-mode bridge on top of
 *                     `executeKimiTask`. For commit 1 the code_cli adapter
 *                     throws a clear error when generate() is called.
 *
 * This module intentionally does not decide how to loop, which tools to call,
 * or how to render the final output. Those belong to the planner (commit 2).
 */

import { describeResolvedProvider } from "../shared/provider-resolver.mjs";
import { runCodeCliChat } from "./code-cli-bridge.mjs";
import { applyReasoningSelectionToBody } from "../../../shared/provider-catalog.mjs";

function isAborted(signal) {
  return Boolean(signal?.aborted);
}

function requireOk(response, providerLabel, bodyText) {
  if (!response.ok) {
    const snippet = (bodyText ?? "").slice(0, 300);
    const error = new Error(`${providerLabel} error ${response.status}: ${snippet}`);
    error.status = response.status;
    error.providerLabel = providerLabel;
    throw error;
  }
}

async function readResponseBody(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function splitSystemAndUser(messages) {
  const systemParts = [];
  const rest = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === "system") {
      if (typeof msg.content === "string") systemParts.push(msg.content);
      continue;
    }
    rest.push(msg);
  }
  return { system: systemParts.join("\n\n"), rest };
}

/* ------------------------------------------------------------------------ */
/* Anthropic                                                                */
/* ------------------------------------------------------------------------ */

function buildAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.input_schema ?? tool.parameters ?? { type: "object", properties: {} }
  }));
}

function convertMessagesForAnthropic(messages) {
  const { system, rest } = splitSystemAndUser(messages);
  const converted = rest.map((msg) => {
    if (msg.role === "tool") {
      // OpenAI-style tool results -> Anthropic tool_result block
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? msg.tool_use_id ?? "",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
          }
        ]
      };
    }
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Carry prior assistant tool_calls into Anthropic's tool_use blocks
      const blocks = [];
      if (typeof msg.content === "string" && msg.content.length > 0) {
        blocks.push({ type: "text", text: msg.content });
      }
      for (const call of msg.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name ?? call.function?.name ?? "",
          input: call.arguments ?? (typeof call.function?.arguments === "string"
            ? safeJsonParse(call.function.arguments)
            : call.function?.arguments) ?? {}
        });
      }
      return { role: "assistant", content: blocks };
    }
    return { role: msg.role, content: msg.content ?? "" };
  });
  return { system, messages: converted };
}

function safeJsonParse(value) {
  if (value == null) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function parseAnthropicResponse(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  let text = "";
  const toolCalls = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      text += (text ? "\n" : "") + block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id ?? null,
        name: block.name ?? "",
        arguments: block.input ?? {}
      });
    }
  }
  return {
    text,
    tool_calls: toolCalls,
    usage: {
      input_tokens: data?.usage?.input_tokens ?? null,
      output_tokens: data?.usage?.output_tokens ?? null
    }
  };
}

async function generateAnthropic(resolved, { messages, tools, tool_choice, maxTokens, signal, fetchImpl, onTextDelta, onToolInputDelta }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!fetchFn) throw new Error("No fetch implementation available for Anthropic adapter.");

  const baseUrl = resolved.baseUrl || "https://api.anthropic.com";
  const { system, messages: anthMessages } = convertMessagesForAnthropic(messages);

  const streaming = typeof onTextDelta === "function";
  const payload = {
    model: resolved.model,
    max_tokens: maxTokens ?? 2048,
    messages: anthMessages,
    ...(streaming ? { stream: true } : {})
  };
  if (system) payload.system = system;
  const anthTools = buildAnthropicTools(tools);
  if (anthTools) payload.tools = anthTools;
  // P4-03 follow-up: forward tool_choice when the caller forces a specific
  // tool. SemanticRouter relies on this to make the LLM call route_task
  // unconditionally rather than slipping into a free-form text reply.
  // Anthropic shape matches our call site verbatim:
  //   { type: "tool", name: "route_task" }   force a specific tool
  //   { type: "any"  }                       force ANY tool
  //   { type: "auto" }                       default (omit altogether)
  if (anthTools && tool_choice && typeof tool_choice === "object") {
    payload.tool_choice = tool_choice;
  }

  const response = await fetchFn(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": resolved.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!streaming) {
    const bodyText = await readResponseBody(response);
    requireOk(response, "Anthropic", bodyText);
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error(`Anthropic returned non-JSON response: ${bodyText.slice(0, 200)}`);
    }
    return parseAnthropicResponse(data);
  }

  // Streaming path — parse Anthropic SSE
  if (!response.ok) {
    const bodyText = await readResponseBody(response);
    requireOk(response, "Anthropic", bodyText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  const toolInputBuffers = {};
  const toolUseBlocks = {};
  const toolCalls = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        reader.cancel();
        throw Object.assign(new Error("Anthropic stream aborted."), { code: "ABORT_ERR" });
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(jsonStr); } catch { continue; }
        if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
          toolUseBlocks[ev.index] = { id: ev.content_block.id, name: ev.content_block.name };
          toolInputBuffers[ev.index] = "";
        }
        if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d?.type === "text_delta" && typeof d.text === "string" && d.text) {
            fullText += d.text;
            onTextDelta(d.text);
          } else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
            if (toolInputBuffers[ev.index] !== undefined) {
              toolInputBuffers[ev.index] += d.partial_json;
              if (typeof onToolInputDelta === "function") {
                const block = toolUseBlocks[ev.index];
                onToolInputDelta(block?.name ?? "", toolInputBuffers[ev.index]);
              }
            }
          }
        }
        if (ev.type === "content_block_stop" && toolUseBlocks[ev.index]) {
          const block = toolUseBlocks[ev.index];
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: safeJsonParse(toolInputBuffers[ev.index] ?? "")
          });
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  return { text: fullText, tool_calls: toolCalls, usage: {} };
}

/* ------------------------------------------------------------------------ */
/* OpenAI-compatible (OpenAI, DeepSeek, Kimi API, vLLM, Azure, etc.)        */
/* ------------------------------------------------------------------------ */

function buildOpenAITools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema ?? tool.parameters ?? { type: "object", properties: {} }
    }
  }));
}

function convertMessagesForOpenAI(messages) {
  const converted = [];
  for (const msg of messages) {
    if (!msg) continue;
    if (msg.role === "tool") {
      converted.push({
        role: "tool",
        tool_call_id: msg.tool_call_id ?? msg.tool_use_id ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      });
      continue;
    }
    if (msg.role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // UCA-182 Phase 22: forward reasoning_content when present —
      // DeepSeek v4 in thinking mode rejects the turn with a 400 if
      // the assistant's prior reasoning isn't included alongside the
      // replayed tool_calls.
      const assistantFrame = {
        role: "assistant",
        content: typeof msg.content === "string" ? msg.content : "",
        tool_calls: msg.tool_calls.map((call) => ({
          id: call.id ?? "",
          type: "function",
          function: {
            name: call.name ?? call.function?.name ?? "",
            arguments: typeof call.arguments === "string"
              ? call.arguments
              : JSON.stringify(call.arguments ?? call.function?.arguments ?? {})
          }
        }))
      };
      if (typeof msg.reasoning_content === "string" && msg.reasoning_content) {
        assistantFrame.reasoning_content = msg.reasoning_content;
      }
      converted.push(assistantFrame);
      continue;
    }
    // Also preserve reasoning_content on plain-text assistant turns.
    if (msg.role === "assistant" && typeof msg.reasoning_content === "string" && msg.reasoning_content) {
      converted.push({
        role: "assistant",
        content: msg.content ?? "",
        reasoning_content: msg.reasoning_content
      });
      continue;
    }
    converted.push({ role: msg.role, content: msg.content ?? "" });
  }
  return converted;
}

function parseOpenAIResponse(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message ?? {};
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawToolCalls.map((call) => ({
    id: call.id ?? null,
    name: call.function?.name ?? call.name ?? "",
    arguments: typeof call.function?.arguments === "string"
      ? safeJsonParse(call.function.arguments)
      : (call.function?.arguments ?? call.arguments ?? {})
  }));
  // UCA-182 Phase 22: DeepSeek v4 in thinking mode returns a
  // `reasoning_content` field alongside `content`. The API then
  // REQUIRES that reasoning_content be echoed back on the next turn
  // when we replay the assistant message (400:
  // "The reasoning_content in the thinking mode must be passed back
  // to the API."). We capture it here and the planner attaches it
  // to the assistant message it pushes onto the transcript; the
  // outgoing-message converter downstream forwards it verbatim.
  return {
    text: message.content ?? "",
    reasoning_content: typeof message.reasoning_content === "string"
      ? message.reasoning_content
      : null,
    tool_calls: toolCalls,
    usage: {
      input_tokens: data?.usage?.prompt_tokens ?? null,
      output_tokens: data?.usage?.completion_tokens ?? null
    }
  };
}

async function generateOpenAI(resolved, { messages, tools, tool_choice, maxTokens, signal, fetchImpl, onTextDelta, onToolInputDelta, onReasoningDelta }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!fetchFn) throw new Error("No fetch implementation available for OpenAI-compatible adapter.");

  const baseUrl = resolved.baseUrl || "https://api.openai.com/v1";
  const streaming = typeof onTextDelta === "function";
  const body = {
    model: resolved.model,
    messages: convertMessagesForOpenAI(messages),
    max_tokens: maxTokens ?? 2048,
    ...(streaming ? { stream: true } : {})
  };
  const oaTools = buildOpenAITools(tools);
  if (oaTools) body.tools = oaTools;
  // P4-03 follow-up: forward tool_choice. OpenAI uses a slightly
  // different shape than Anthropic — translate. Caller passes the
  // Anthropic-style { type:"tool", name:"X" }; here we map to
  // { type:"function", function:{ name:"X" } } for OpenAI-compat.
  if (oaTools && tool_choice && typeof tool_choice === "object") {
    if (tool_choice.type === "tool" && tool_choice.name) {
      body.tool_choice = { type: "function", function: { name: tool_choice.name } };
    } else if (tool_choice.type === "any") {
      body.tool_choice = "required";
    } else {
      // Pass through whatever shape the caller used (string "auto" / "none" / etc.)
      body.tool_choice = tool_choice;
    }
  }

  applyReasoningSelectionToBody(body, resolved, resolved.model, resolved.reasoningEffort);

  const response = await fetchFn(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${resolved.apiKey ?? ""}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!streaming) {
    const bodyText = await readResponseBody(response);
    requireOk(response, `OpenAI-compat (${resolved.providerName ?? resolved.baseUrl})`, bodyText);
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error(`OpenAI-compat returned non-JSON response: ${bodyText.slice(0, 200)}`);
    }
    return parseOpenAIResponse(data);
  }

  // Streaming path — parse OpenAI SSE
  if (!response.ok) {
    const bodyText = await readResponseBody(response);
    requireOk(response, `OpenAI-compat (${resolved.providerName ?? resolved.baseUrl})`, bodyText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";
  // UCA-182 Phase 22: accumulate reasoning_content deltas alongside
  // content deltas so DeepSeek v4 thinking mode streams work end-to-
  // end. The assembled blob is returned and then echoed back on the
  // next turn's assistant message (see parseOpenAIResponse comment).
  let fullReasoning = "";
  const toolCallBuilders = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        reader.cancel();
        throw Object.assign(new Error("OpenAI stream aborted."), { code: "ABORT_ERR" });
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        let chunk;
        try { chunk = JSON.parse(jsonStr); } catch { continue; }
        const delta = chunk?.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          fullText += delta.content;
          onTextDelta(delta.content);
        }
        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          fullReasoning += delta.reasoning_content;
          // 83.4 — fire per-chunk so overlay/console can render thinking
          // progressively rather than waiting for the full reasoning blob.
          onReasoningDelta?.(delta.reasoning_content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallBuilders[idx]) {
              toolCallBuilders[idx] = { id: "", name: "", arguments: "" };
            }
            if (tc.id) toolCallBuilders[idx].id += tc.id;
            if (tc.function?.name) toolCallBuilders[idx].name += tc.function.name;
            if (tc.function?.arguments) {
              toolCallBuilders[idx].arguments += tc.function.arguments;
              if (typeof onToolInputDelta === "function") {
                onToolInputDelta(toolCallBuilders[idx].name, toolCallBuilders[idx].arguments);
              }
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  const toolCalls = Object.values(toolCallBuilders).map((tc) => ({
    id: tc.id || null,
    name: tc.name,
    arguments: safeJsonParse(tc.arguments)
  }));

  return {
    text: fullText,
    reasoning_content: fullReasoning || null,
    tool_calls: toolCalls,
    usage: {}
  };
}

/* ------------------------------------------------------------------------ */
/* Ollama                                                                    */
/* ------------------------------------------------------------------------ */

function parseOllamaResponse(data) {
  const message = data?.message ?? {};
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawToolCalls.map((call) => ({
    id: call.id ?? null,
    name: call.function?.name ?? call.name ?? "",
    arguments: typeof call.function?.arguments === "string"
      ? safeJsonParse(call.function.arguments)
      : (call.function?.arguments ?? call.arguments ?? {})
  }));
  return {
    text: message.content ?? "",
    tool_calls: toolCalls,
    usage: {
      input_tokens: data?.prompt_eval_count ?? null,
      output_tokens: data?.eval_count ?? null
    }
  };
}

async function generateOllama(resolved, { messages, tools, signal, fetchImpl }) {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (!fetchFn) throw new Error("No fetch implementation available for Ollama adapter.");

  const baseUrl = resolved.baseUrl || "http://127.0.0.1:11434";
  const body = {
    model: resolved.model,
    messages: convertMessagesForOpenAI(messages),
    stream: false
  };
  const oaTools = buildOpenAITools(tools);
  if (oaTools) body.tools = oaTools;

  const response = await fetchFn(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  const bodyText = await readResponseBody(response);
  requireOk(response, "Ollama", bodyText);
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Ollama returned non-JSON response: ${bodyText.slice(0, 200)}`);
  }
  return parseOllamaResponse(data);
}

/* ------------------------------------------------------------------------ */
/* code_cli (Kimi CLI and other subprocess-based CLIs)                      */
/*                                                                           */
/* code_cli providers don't expose a native tool-calling endpoint, so we    */
/* bridge them via JSON planning mode in `code-cli-bridge.mjs`:              */
/*   1. messages → single text prompt + JSON tool-call protocol             */
/*   2. spawn the CLI subprocess (Kimi CLI / Claude Code CLI / Codex / ...) */
/*   3. parse the assistant text for ```json {tool_call: ...}``` blocks     */
/* The result has the same { text, tool_calls, usage } shape as every       */
/* other adapter, so the agentic planner loop is unchanged.                  */
/* ------------------------------------------------------------------------ */

async function generateCodeCli(resolved, { messages, signal }) {
  return runCodeCliChat({
    resolved,
    messages,
    signal,
    timeoutSeconds: resolved.maxRuntimeSeconds ?? 120
  });
}

/* ------------------------------------------------------------------------ */
/* Factory                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Build a provider adapter from a resolved provider object.
 *
 * The returned adapter is immutable — callers that care about config hot-reload
 * should re-resolve the provider and build a fresh adapter per task. The
 * planner (commit 2) will do this as its first step so that mid-run provider
 * switches never apply to an in-flight task.
 */
export function createProviderAdapter(resolved) {
  if (!resolved) {
    throw new Error("createProviderAdapter requires a non-null resolved provider.");
  }
  const kind = resolved.kind || resolved.id;
  const descriptor = describeResolvedProvider(resolved);

  let generate;
  switch (kind) {
    case "anthropic":
      generate = (opts) => generateAnthropic(resolved, opts);
      break;
    case "openai":
      generate = (opts) => generateOpenAI(resolved, opts);
      break;
    case "ollama":
      generate = (opts) => generateOllama(resolved, opts);
      break;
    case "code_cli":
      generate = (opts) => generateCodeCli(resolved, opts);
      break;
    default:
      throw new Error(`createProviderAdapter: unsupported provider kind "${kind}".`);
  }

  return {
    kind,
    model: resolved.model,
    transport: kind === "code_cli" ? "subprocess" : "https",
    descriptor,
    describe() { return descriptor; },
    async generate(options = {}) {
      if (isAborted(options.signal)) {
        const abortError = new Error("Adapter.generate aborted before call.");
        abortError.code = "ABORT_ERR";
        throw abortError;
      }
      return generate(options);
    },
    supportsStreaming: kind === "anthropic" || kind === "openai"
  };
}

/**
 * Convenience: build an adapter directly from a task type, using the current
 * config. Returns null when no provider is configured.
 */
export async function createProviderAdapterForTask(taskType) {
  const { resolveProviderForTask } = await import("../shared/provider-resolver.mjs");
  const resolved = resolveProviderForTask(taskType);
  if (!resolved) return null;
  return createProviderAdapter(resolved);
}
