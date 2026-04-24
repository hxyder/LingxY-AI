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

import { buildAgenticSystemPrompt, isAudioNoteSingleMarkdownTask } from "./prompt-builder.mjs";
import { createProviderAdapter } from "./provider-adapter.mjs";
import { resolveProviderForTask, describeResolvedProvider } from "../shared/provider-resolver.mjs";
import { getMcpActionTools } from "../../ai/mcp/client-bridge.mjs";

const DEFAULT_MAX_ITERATIONS = 8;

// Whitelist of tools whose argument streams are surfaced as
// `tool_input_delta` events for the live preview panel. Limiting the set
// keeps the SSE bus from carrying every partial JSON token (e.g. for
// arguments to search / lookup tools where a live preview is meaningless).
const FILE_GEN_TOOLS = new Set(["write_file", "generate_document", "edit_file"]);

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

function taskNeedsCurrentWebData(task) {
  return Boolean(task?.task_spec?.needs_current_web_data)
    || task?.task_spec?.success_contract?.required_tool_names?.includes?.("web_search_fetch");
}

function inferPreflightSearchRecency(command = "") {
  const text = String(command ?? "");
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "day";
  if (/(本周|一周|近\s*7\s*天|week|最新|最近|新闻|消息|动态|资讯|latest|recent|current|news)/i.test(text)) return "week";
  return "month";
}

/**
 * Execute a single tool call against the action tool registry.
 * Also checks `mcpToolById` for MCP-sourced tools that aren't in the registry.
 * The caller is expected to pass the runtime's registry + toolContext;
 * no risk-matrix gating happens here — that's the executor's job.
 */
async function executeToolCall({ registry, mcpToolById, toolContext, call, runtime, task }) {
  const tool = registry?.get?.(call.name) ?? mcpToolById?.get?.(call.name);
  if (!tool) {
    return {
      success: false,
      observation: `Tool ${call.name} is not registered.`,
      metadata: { tool_id: call.name }
    };
  }

  // UCA-182 Phase 20: risk-matrix gate. Before this change the
  // agentic planner called tool.execute() unconditionally, which
  // meant account_send_email / delete / any tool flagged with
  // requires_confirmation=true ran silently even in interactive
  // mode. Now every call passes through evaluateToolRisk: if
  // confirmation is required we create a pending_approval, surface
  // it to the caller via the runtime's pendingApprovals service,
  // and return a tool-level failure so the agent stops the chain.
  // The UI popup-card (kind="approval") drives the actual approve
  // / reject; on approve the pendingApprovals service re-runs the
  // tool via executeApprovedAction (see task-runtime.mjs).
  try {
    const { evaluateToolRisk } = await import("../../action_tools/risk_matrix.mjs");
    const risk = evaluateToolRisk(tool, call.arguments ?? {}, toolContext ?? {});
    if (risk.requires_confirmation && runtime?.pendingApprovals?.create) {
      const approval = runtime.pendingApprovals.create({
        sourceType: "agent_tool_call",
        sourceId: task?.task_id ?? call.id ?? call.name,
        proposedAction: "action_tool",
        proposedTarget: tool.id,
        proposedParams: call.arguments ?? {},
        previewText: buildApprovalPreview(tool, call.arguments ?? {}),
        metadata: {
          tool_id: tool.id,
          risk_level: risk.risk_level ?? tool.risk_level ?? "high",
          reason: risk.reason ?? "requires_confirmation",
          tool_call_id: call.id ?? null,
          task_id: task?.task_id ?? null
        }
      });
      return {
        success: false,
        observation: `🔒 Tool ${tool.id} requires user approval before running. An approval card has been surfaced to the user (approval_id=${approval.approval_id}). Stop chaining further tools — the system will re-run ${tool.id} automatically once the user approves.`,
        metadata: {
          tool_id: tool.id,
          waiting_approval: true,
          approval_id: approval.approval_id,
          risk_level: risk.risk_level ?? tool.risk_level ?? "high"
        },
        artifact_paths: [],
        error: null
      };
    }
  } catch (gateError) {
    // If the risk matrix itself throws, don't silently bypass — fail
    // closed: surface as a tool error so the agent stops.
    return {
      success: false,
      observation: `Risk gate failed for ${tool.id}: ${gateError.message}`,
      metadata: { tool_id: tool.id, gate_error: true }
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

/** Short human-readable preview shown inside the approval popup card. */
function buildApprovalPreview(tool, args = {}) {
  if (tool.id === "account_send_email" || tool.id === "send_email_smtp") {
    const to = Array.isArray(args.to) ? args.to.join(", ") : String(args.to ?? "");
    const subject = String(args.subject ?? "").slice(0, 80);
    const bodyPreview = String(args.body ?? "").replace(/\s+/g, " ").slice(0, 160);
    return `发送邮件 → ${to || "(未指定收件人)"}\n主题: ${subject || "(无主题)"}\n${bodyPreview}`;
  }
  if (tool.id === "file_op" && args.operation === "delete") {
    return `删除文件: ${args.path ?? "(未指定)"}`;
  }
  if (tool.id === "launch_app") {
    return `启动应用: ${args.app ?? "(未指定)"}`;
  }
  const argsPreview = JSON.stringify(args).slice(0, 180);
  return `${tool.name ?? tool.id}\n${argsPreview}`;
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
  const rawBuiltinTools = tools
    ?? runtime?.actionToolRegistry?.list?.()
    ?? [];
  const noteSingleMarkdown = isAudioNoteSingleMarkdownTask(task);
  const builtinTools = noteSingleMarkdown
    ? rawBuiltinTools.filter((tool) => tool.id !== "generate_document")
    : rawBuiltinTools;

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

  const transcript = [];
  // UCA-179: seed with any files the user attached through the context
  // packet. "Send this file to alice@…" only works if the agent can see
  // the path on the tool-observation turn, not just in the original user
  // message (which gets lost once a few tools have run).
  const artifactPaths = [
    ...(task?.context_packet?.file_paths ?? []),
    ...(task?.context_packet?.image_paths ?? [])
  ].filter(Boolean);
  let preflightSearchText = "";
  if (taskNeedsCurrentWebData(task)) {
    const searchCall = {
      name: "web_search_fetch",
      arguments: {
        query: task.user_command ?? "",
        recency: inferPreflightSearchRecency(task.user_command),
        limit: 6
      }
    };
    onEvent?.({
      event_type: "tool_call_started",
      payload: { tool_id: searchCall.name, arguments: searchCall.arguments, preflight: true }
    });
    const searchResult = await executeToolCall({
      registry: runtime?.actionToolRegistry,
      mcpToolById,
      toolContext: {
        ...(runtime?.toolContext ?? {}),
        runtime,
        task,
        outputDir: task?.output_dir ?? runtime?.toolContext?.outputDir ?? null
      },
      call: searchCall,
      runtime,
      task
    });
    onEvent?.({
      event_type: "tool_call_completed",
      payload: {
        tool_id: searchCall.name,
        success: searchResult.success,
        observation: (searchResult.observation ?? "").slice(0, 500),
        metadata: searchResult.metadata ?? {},
        preflight: true
      }
    });
    transcript.push({
      role: "tool",
      tool_call_id: "preflight_web_search_fetch",
      name: searchCall.name,
      success: searchResult.success,
      observation: searchResult.observation ?? "",
      artifact_paths: searchResult.artifact_paths ?? []
    });
    preflightSearchText = [
      "Live web search preflight result:",
      searchResult.observation || "(web_search_fetch returned no observation)",
      "",
      "Use the live search result above for current/latest facts. If it failed or looks insufficient, call web_search_fetch again with a better query or call fetch_url_content on an authoritative URL. Do not answer current/latest facts from memory."
    ].join("\n");
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: [buildUserMessage(task), preflightSearchText].filter(Boolean).join("\n\n---\n\n") }
  ];

  const toolSchemas = effectiveTools.map(toolDescriptorForAdapter);

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
      // Pass onTextDelta only on the last-text iteration (no tool calls pending).
      // We can't know in advance, so we stream for all iterations — tool-call
      // responses typically have no text anyway. The overlay accumulates deltas
      // into a streaming bubble and finalises it on inline_result.
      const onTextDelta = (adapter.supportsStreaming && onEvent)
        ? (delta) => onEvent({ event_type: "text_delta", payload: { delta } })
        : undefined;
      const onToolInputDelta = (adapter.supportsStreaming && onEvent)
        ? (toolName, partialJson) => {
            if (!FILE_GEN_TOOLS.has(toolName)) return;
            onEvent({
              event_type: "tool_input_delta",
              payload: { tool_id: toolName, partial_json: partialJson }
            });
          }
        : undefined;
      response = await adapter.generate({
        messages,
        tools: toolSchemas,
        signal,
        fetchImpl,
        onTextDelta,
        onToolInputDelta
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

    // Record any assistant text that arrived alongside tool calls — it's
    // frequently the model's running commentary or a partial answer we'd
    // otherwise throw away. If the loop hits maxIterations without a final
    // turn, we reuse the latest non-empty intermediate text as the answer
    // instead of returning "(no response from agentic planner)".
    if (text && text.trim()) {
      finalText = text;
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
        call,
        runtime,
        task
      });
      // Phase 20: if the gate created an approval, emit a visible
      // event so the overlay popup-card can surface the approval
      // card. The agent sees the tool failure in its transcript and
      // is told to stop chaining further tools.
      if (result?.metadata?.waiting_approval) {
        onEvent?.({
          event_type: "pending_approval_created",
          payload: {
            approval_id: result.metadata.approval_id,
            tool_id: result.metadata.tool_id,
            risk_level: result.metadata.risk_level
          }
        });
      }

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

      // UCA-179: surface artifact_paths INSIDE the tool message so the model
      // sees them structurally on the next turn. Before this, the only hint
      // was whatever the tool hand-wrote into its observation string, so a
      // subsequent send_email / account_send_email call would drop the
      // attachment because the model couldn't recall the absolute path.
      const baseContent = result.observation ?? (result.success ? "Tool returned success." : "Tool returned failure without an observation.");
      const pathsForTurn = Array.isArray(result.artifact_paths) ? result.artifact_paths.filter(Boolean) : [];
      const toolContent = pathsForTurn.length > 0
        ? `${baseContent}\n\nartifact_paths (absolute local paths — pass verbatim to attachmentPaths / localPath / file arguments of the next tool if the user asked to send / upload / share):\n${pathsForTurn.map((p) => `- ${p}`).join("\n")}`
        : baseContent;
      messages.push({
        role: "tool",
        tool_call_id: call.id ?? call.name,
        content: toolContent
      });
    }

    // UCA-179: once the run has accumulated any artifacts, keep a short
    // running reminder in the conversation so the model doesn't forget
    // them after many turns. Injected as a system-style user note so it
    // refreshes every iteration; we only push when the set actually grew
    // to keep the conversation from ballooning.
    if (artifactPaths.length > 0) {
      const prev = messages.__lastArtifactPathsHash ?? "";
      const next = artifactPaths.join("|");
      if (next !== prev) {
        messages.push({
          role: "user",
          content: `(system note) Artifacts produced so far in this run — pass these as absolute paths if the user asks to attach / send / upload them:\n${artifactPaths.map((p) => `- ${p}`).join("\n")}`
        });
        messages.__lastArtifactPathsHash = next;
      }
    }
  }

  // If the loop hit maxIterations without the model ever producing a
  // tool-call-free turn, do one final synthesis call with tools disabled.
  // Otherwise the user sees "(no response from agentic planner)" even
  // though we've collected plenty of observations. Common for multi-step
  // searches (weather / research queries) where the model keeps refining
  // its search and runs out of iteration budget before synthesizing.
  if (!finalText && iterations >= maxIterations) {
    onEvent?.({
      event_type: "log",
      payload: { message: "max iterations hit — forcing final synthesis without tools" }
    });
    messages.push({
      role: "user",
      content: "You've used your tool-call budget. Synthesize a final answer for the original question using only the information already collected above. Do not request more tools."
    });
    try {
      const synthesis = await adapter.generate({
        messages,
        tools: [],
        signal,
        fetchImpl,
        onTextDelta: (adapter.supportsStreaming && onEvent)
          ? (delta) => onEvent({ event_type: "text_delta", payload: { delta } })
          : undefined
      });
      const text = synthesis?.text ?? "";
      if (text && text.trim()) finalText = text;
    } catch (error) {
      onEvent?.({
        event_type: "log",
        payload: { message: `Final synthesis failed: ${error.message}` }
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
