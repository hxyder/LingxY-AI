/**
 * Agentic planner — provider-agnostic tool-use loop used by the `agentic`
 * executor (and, once commit 2 of UCA-049 lands end-to-end, by the
 * multi-intent decomposer in UCA-042).
 *
 * Shape of a single planner run:
 *
 *   1. Resolve provider + build adapter once. The adapter is cached for the
 *      whole run so a mid-run provider switch never applies to an in-flight
 *      task (UCA-049 §I).
 *   2. Render the system prompt from the action tool registry via
 *      `buildAgenticSystemPrompt` — the tool catalogue is dynamic.
 *   3. Loop up to `maxIterations` (default 8):
 *        a. Call `adapter.generate({ messages, tools })`.
 *        b. If the adapter returns `tool_calls`, run each one through
 *           `executeToolCall` and append the observation as a `tool` role
 *           message in the transcript.
 *        c. If the adapter returns pure text, record it as the final reply
 *           and break.
 *   4. Run the truthfulness guard: if the final reply claims "done / saved /
 *      launched / 已完成 / 已生成" but the transcript contains no tool call
 *      with `success: true`, downgrade the result to `partial_success` and
 *      prepend a warning note (UCA-049 §B, solves UCA-039 bug #5).
 *
 * The planner is deliberately decoupled from execution-mode policy: the
 * security broker / risk matrix still decides whether a tool call needs
 * confirmation. In commit 2 the agentic executor calls the planner in
 * "autonomous" mode with risk-matrix gating below; commit 3 wires
 * interactive confirmation into the same path.
 */

import { buildAgenticSystemPrompt } from "./prompt-builder.mjs";
import { createProviderAdapter } from "./provider-adapter.mjs";
import { resolveProviderForTask, describeResolvedProvider } from "../shared/provider-resolver.mjs";
import { getMcpActionTools } from "../../ai/mcp/client-bridge.mjs";

const DEFAULT_MAX_ITERATIONS = 8;

const COMPLETION_CLAIM_PATTERNS = [
  /\b(?:done|finished|completed|saved|written|created|generated|launched|opened|executed|ran|published|sent)\b/i,
  /(?:已完成|已保存|已生成|已写入|已创建|已启动|已打开|已运行|已执行|已发送|完成了|创建了|生成了|写好了)/
];

function claimsCompletion(text = "") {
  return COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

function anyToolSucceeded(transcript = []) {
  return transcript.some((entry) => entry.role === "tool" && entry.success === true);
}

function toolDescriptorForAdapter(tool) {
  return {
    name: tool.id,
    description: tool.description ?? tool.name ?? "",
    input_schema: tool.parameters ?? { type: "object", properties: {} }
  };
}

function buildUserMessage(task) {
  const parts = [];
  parts.push(task.user_command ?? "(no user command)");
  const contextText = task.context_packet?.text?.trim();
  if (contextText) {
    parts.push("");
    parts.push("Context:");
    parts.push(contextText.slice(0, 8000));
  }
  const filePaths = task.context_packet?.file_paths ?? [];
  if (filePaths.length > 0) {
    parts.push("");
    parts.push(`Attached files:\n${filePaths.join("\n")}`);
  }
  const url = task.context_packet?.url?.trim();
  if (url) {
    parts.push("");
    parts.push(`URL: ${url}`);
  }
  return parts.join("\n");
}

/**
 * Execute a single tool call against the action tool registry.
 * Also checks `mcpToolById` for MCP-sourced tools that aren't in the registry.
 * The caller is expected to pass the runtime's registry + toolContext;
 * no risk-matrix gating happens here — that's the executor's job.
 */
async function executeToolCall({ registry, mcpToolById, toolContext, call }) {
  const tool = registry?.get?.(call.name) ?? mcpToolById?.get?.(call.name);
  if (!tool) {
    return {
      success: false,
      observation: `Tool ${call.name} is not registered.`,
      metadata: { tool_id: call.name }
    };
  }
  try {
    const result = await tool.execute(call.arguments ?? {}, toolContext ?? {});
    // Normalise shape: action_tools/types createActionResult returns
    // `{ success, observation, metadata, artifact_paths, error }`.
    return {
      success: Boolean(result?.success),
      observation: result?.observation ?? "",
      metadata: result?.metadata ?? {},
      artifact_paths: result?.artifact_paths ?? [],
      error: result?.error ?? null
    };
  } catch (error) {
    return {
      success: false,
      observation: `Tool ${call.name} threw: ${error.message}`,
      metadata: { tool_id: call.name }
    };
  }
}

/**
 * Main entry point for the agentic planner.
 *
 * @param {object} opts
 * @param {object} opts.task                  — task record (with user_command, context_packet)
 * @param {object} opts.runtime               — runtime scaffold (for registry + outputDir)
 * @param {Array}  opts.tools                 — action tool definitions (default: runtime.actionToolRegistry.list())
 * @param {object} opts.requestedFormat       — output format hint from detectRequestedOutputFormat
 * @param {object} opts.provider              — resolved provider object (default: resolveProviderForTask)
 * @param {object} opts.adapterOverride       — optional pre-built adapter (tests use this)
 * @param {function} opts.onEvent             — callback for streaming events to the executor
 * @param {AbortSignal} opts.signal           — cancellation signal
 * @param {number} opts.maxIterations         — default 8
 * @param {function} opts.fetchImpl           — optional fetch override for tests
 * @returns {Promise<{ finalText, toolCalls, artifactPaths, success, provider_descriptor }>}
 */
export async function runAgenticPlanner({
  task,
  runtime,
  tools = null,
  requestedFormat = null,
  provider = null,
  adapterOverride = null,
  onEvent = null,
  signal = null,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  fetchImpl = null
} = {}) {
  const builtinTools = tools
    ?? runtime?.actionToolRegistry?.list?.()
    ?? [];

  // UCA-067: inject MCP tools from enabled stdio servers so ALL providers
  // (including native Anthropic/OpenAI) can call them as first-class tools.
  const mcpRegistry = runtime?.platform?.mcpServers;
  let mcpTools = [];
  try {
    mcpTools = await getMcpActionTools(mcpRegistry);
  } catch { /* MCP unavailable — continue without it */ }

  // Merge: built-in tools first so they take priority on id collision
  const mcpToolById = new Map(mcpTools.map((t) => [t.id, t]));
  const effectiveTools = [...builtinTools, ...mcpTools];

  const effectiveSkills = await runtime?.platform?.skillRegistries?.listSkills?.({
    runtime
  }) ?? [];

  const resolvedProvider = provider ?? resolveProviderForTask("chat");
  if (!resolvedProvider && !adapterOverride) {
    return {
      success: false,
      finalText: "No AI provider configured. Open Console → Settings to add one.",
      toolCalls: [],
      artifactPaths: [],
      provider_descriptor: null,
      iterations: 0,
      downgraded: false
    };
  }

  const adapter = adapterOverride
    ?? createProviderAdapter(resolvedProvider);
  const descriptor = adapter?.describe?.() ?? describeResolvedProvider(resolvedProvider);

  // UCA-049 commit 3: code_cli providers now drive the planner via the
  // JSON planning-mode bridge in code-cli-bridge.mjs. The planner loop
  // below is identical for native function-calling providers (anthropic /
  // openai / ollama) and for code_cli providers — only the adapter layer
  // differs.

  const systemPrompt = buildAgenticSystemPrompt({
    tools: effectiveTools,
    skills: effectiveSkills,
    task,
    requestedFormat
  });

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserMessage(task) }
  ];

  const toolSchemas = effectiveTools.map(toolDescriptorForAdapter);

  const transcript = [];
  const artifactPaths = [];
  let finalText = "";
  let iterations = 0;

  for (iterations = 0; iterations < maxIterations; iterations += 1) {
    if (signal?.aborted) {
      const err = new Error("Agentic planner aborted.");
      err.code = "ABORT_ERR";
      throw err;
    }

    let response;
    try {
      response = await adapter.generate({
        messages,
        tools: toolSchemas,
        signal,
        fetchImpl
      });
    } catch (error) {
      if (error?.code === "ABORT_ERR") throw error;
      onEvent?.({
        event_type: "log",
        payload: { message: `Adapter error: ${error.message}` }
      });
      finalText = `Provider call failed: ${error.message}`;
      break;
    }

    const text = response?.text ?? "";
    const toolCalls = Array.isArray(response?.tool_calls) ? response.tool_calls : [];

    if (toolCalls.length === 0) {
      finalText = text;
      break;
    }

    // Record the assistant turn so the transcript replay is correct on the
    // next adapter.generate() call.
    messages.push({
      role: "assistant",
      content: text,
      tool_calls: toolCalls
    });
    transcript.push({ role: "assistant", text, tool_calls: toolCalls });

    for (const call of toolCalls) {
      if (signal?.aborted) {
        const err = new Error("Agentic planner aborted mid-tool.");
        err.code = "ABORT_ERR";
        throw err;
      }

      onEvent?.({
        event_type: "tool_call_started",
        payload: { tool_id: call.name, arguments: call.arguments ?? {} }
      });

      const result = await executeToolCall({
        registry: runtime?.actionToolRegistry,
        mcpToolById,
        toolContext: {
          ...(runtime?.toolContext ?? {}),
          runtime,
          task,
          outputDir: task?.output_dir ?? runtime?.toolContext?.outputDir ?? null
        },
        call
      });

      onEvent?.({
        event_type: "tool_call_completed",
        payload: {
          tool_id: call.name,
          success: result.success,
          observation: (result.observation ?? "").slice(0, 500),
          metadata: result.metadata ?? {}
        }
      });

      transcript.push({
        role: "tool",
        tool_call_id: call.id ?? call.name,
        name: call.name,
        success: result.success,
        observation: result.observation ?? "",
        artifact_paths: result.artifact_paths ?? []
      });

      for (const artifactPath of result.artifact_paths ?? []) {
        if (artifactPath && !artifactPaths.includes(artifactPath)) {
          artifactPaths.push(artifactPath);
          onEvent?.({
            event_type: "artifact_created",
            payload: { path: artifactPath, mime: result.metadata?.mime_type ?? null }
          });
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id ?? call.name,
        content: result.observation ?? (result.success ? "Tool returned success." : "Tool returned failure without an observation.")
      });
    }
  }

  // Truthfulness guard (UCA-049 §B): if the final text claims completion
  // but no tool actually returned success, downgrade and warn the user.
  let downgraded = false;
  if (finalText && claimsCompletion(finalText) && !anyToolSucceeded(transcript)) {
    downgraded = true;
    finalText = `[UCA note] The model claimed the task was completed, but no tool in this run returned success:true. The claim has been downgraded to "partial". See the transcript for what actually happened.\n\n${finalText}`;
  }

  return {
    success: !downgraded && Boolean(finalText),
    finalText: finalText || "(no response from agentic planner)",
    toolCalls: transcript.filter((entry) => entry.role === "tool"),
    artifactPaths,
    provider_descriptor: descriptor,
    iterations: iterations + 1,
    downgraded
  };
}
