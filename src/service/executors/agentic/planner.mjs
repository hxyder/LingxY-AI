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
 *           `executeAgenticToolCall` and append the observation as a `tool` role
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

import { buildAgenticStableSystemPrompt, buildAgenticSystemPrompt, isAudioNoteSingleMarkdownTask } from "./prompt-builder.mjs";
import { createProviderAdapter } from "./provider-adapter.mjs";
import { finalizeAgenticPlannerRun } from "./finalization.mjs";
import { executeAgenticToolCall } from "./tool-execution.mjs";
import { isStreamableArtifactTool } from "../shared/previewable-artifact-tools.mjs";
import { buildAgenticUserMessage } from "./user-message.mjs";
import { renderEvidenceLedger } from "../shared/evidence-ledger.mjs";
import { resolveProviderForModelRole, describeResolvedProvider } from "../shared/provider-resolver.mjs";
import { loadStructuredHistoryFor } from "../shared/conversation-history-loader.mjs";
import {
  inferSearchRecencyFromText,
  resolveTaskMaxIterations,
  shouldCheckSaturation
} from "../shared/loop-policy.mjs";
import { getMcpActionTools } from "../../capabilities/mcp/client-bridge.mjs";
import { transcriptForValidator } from "./validator-transcript.mjs";
import { processAgenticToolResultForControls } from "./tool-result-controls.mjs";
import {
  filterToolsForAgenticTask,
  isScheduleRegistryTool,
  isScheduledFireTask,
  taskNeedsCurrentWebData,
  toolDescriptorForAdapter
} from "./tool-surface.mjs";
import { detectSearchSaturation } from "../../core/policy/evidence-normalizer.mjs";
import { normalizeSources } from "../../core/evidence/source-envelope.mjs";
import { appendAuditLog } from "../../security/audit-log.mjs";
import { emitLlmUsage } from "../../core/task-runtime/llm-usage.mjs";
import { cacheableSystemMessage } from "../shared/prompt-cache.mjs";
import { summarizeSkillContext } from "../shared/skill-context.mjs";
import {
  selectSuccessContractValidationSpec,
  validateStepGate
} from "../../core/policy/success-contract-validator.mjs";
// J1: per-iteration parity. Pre-J1 agentic ran for the full
// maxIterations even when the same tool failed repeatedly OR when the
// success contract was already known to be unreachable. tool_using
// charges an error budget after each tool result (max 2 tool failures /
// 1 empty external_web_read) and runs validateStepGate to catch
// same-tool failure streaks; agentic now does the same.
import { createErrorBudget } from "../../core/runtime/error-budget.mjs";
import {
  actionObligationsWithStatus,
  buildActionObligationGuidance,
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import { artifactEventFieldsForToolResult } from "../../core/artifact-action-contract.mjs";
import { spreadsheetOutlineFromText } from "../../core/spreadsheet-outline.mjs";

const DEFAULT_MAX_ITERATIONS = 8;

function artifactContractViolation(stepGate) {
  return (stepGate?.violations ?? []).find((entry) =>
    entry?.kind === "artifact_required_not_created"
    || entry?.kind === "artifact_required_kind_mismatch"
  ) ?? null;
}

function hasOnlyArtifactContractViolations(stepGate) {
  const violations = stepGate?.violations ?? [];
  if (violations.length === 0) return false;
  return violations.every((entry) =>
    entry?.kind === "artifact_required_not_created"
    || entry?.kind === "artifact_required_kind_mismatch"
  );
}

function artifactKindFromTaskSpec(taskSpec = {}) {
  return taskSpec?.artifact?.kind
    ?? taskSpec?.contract?.output_contract?.kind
    ?? "docx";
}

function buildAgenticArtifactContractGuidance({ taskSpec, violation } = {}) {
  const kind = artifactKindFromTaskSpec(taskSpec);
  return [
    "The task contract is not satisfied yet. Do not finalize with prose only.",
    `A real file artifact is required (${kind}). Call an artifact-producing tool now, such as generate_document with kind="${kind}" and a structured outline, or another visible artifact tool if it better fits the request.`,
    violation?.message ? `Current violation: ${violation.message}` : null
  ].filter(Boolean).join("\n");
}

function deterministicArtifactArgsFromFinalText({ task, taskSpec, finalText } = {}) {
  const rawKind = String(artifactKindFromTaskSpec(taskSpec) ?? "").trim().toLowerCase();
  const kindAliases = { word: "docx", excel: "xlsx", ppt: "pptx", powerpoint: "pptx" };
  const kind = kindAliases[rawKind] ?? rawKind ?? "docx";
  const supported = new Set(["docx", "pdf", "xlsx", "pptx", "html"]);
  if (!supported.has(kind)) return null;
  const title = String(task?.title ?? task?.user_command ?? "Generated Document").trim().slice(0, 80) || "Generated Document";
  const body = String(finalText ?? "").trim();
  if (!body) return null;
  if (kind === "xlsx") {
    const outline = spreadsheetOutlineFromText(body, { title });
    if (!outline) return null;
    return {
      kind,
      outline
    };
  }
  if (kind === "pptx") {
    return {
      kind,
      outline: {
        title,
        slides: [
          { heading: title, body }
        ]
      }
    };
  }
  return {
    kind,
    outline: {
      title,
      sections: [
        { heading: title, body }
      ]
    }
  };
}

async function runDeterministicAgenticArtifactObligation({
  runtime,
  task,
  taskSpec,
  transcript,
  finalText,
  iteration,
  onEvent,
  signal
} = {}) {
  if (signal?.aborted) {
    throw Object.assign(new Error("Agentic artifact obligation aborted before execution."), { code: "ABORT_ERR" });
  }
  const registry = runtime?.actionToolRegistry;
  if (!registry?.get?.("generate_document")) return { ok: false, reason: "no_generate_document" };
  const args = deterministicArtifactArgsFromFinalText({ task, taskSpec, finalText });
  if (!args) return { ok: false, reason: "unsupported_or_empty_artifact" };
  const call = {
    id: `deterministic_generate_document_${iteration}`,
    name: "generate_document",
    arguments: args
  };
  const proposedPayload = {
    tool_id: "generate_document",
    args,
    risk: { level: "low", requires_confirmation: false },
    source: "agentic_deterministic_artifact_obligation",
    iteration
  };
  onEvent?.({ event_type: "tool_call_proposed", payload: proposedPayload });
  if (runtime?.store?.appendAuditLog) {
    appendAuditLog(runtime, "tool.call", proposedPayload, task?.task_id ?? null);
  }
  onEvent?.({
    event_type: "tool_call_started",
    payload: {
      tool_id: "generate_document",
      arguments: args,
      source: "agentic_deterministic_artifact_obligation"
    }
  });
  transcript.push({
    role: "assistant",
    text: "",
    tool_calls: [call],
    deterministic_artifact_obligation: true
  });
  const result = await executeAgenticToolCall({
    registry,
    mcpToolById: null,
    toolContext: {
      ...(runtime?.toolContext ?? {}),
      runtime,
      task,
      outputDir: task?.output_dir ?? runtime?.toolContext?.outputDir ?? null
    },
    call,
    runtime,
    task,
    transcript,
    signal
  });
  const transcriptEntry = {
    role: "tool",
    tool_call_id: call.id,
    name: "generate_document",
    success: result.success,
    observation: result.observation ?? "",
    metadata: result.metadata ?? {},
    artifact_paths: result.artifact_paths ?? [],
    recovery: "agentic_deterministic_artifact_obligation"
  };
  transcript.push(transcriptEntry);
  onEvent?.({
    event_type: "tool_call_completed",
    payload: {
      tool_id: "generate_document",
      success: result.success,
      observation: (result.observation ?? "").slice(0, 500),
      metadata: result.metadata ?? {},
      sources: normalizeSources(transcriptEntry),
      ...artifactEventFieldsForToolResult("generate_document", result)
    }
  });
  if (!result.success) {
    return { ok: false, reason: result.error ?? result.observation ?? "generate_document_failed" };
  }
  const artifactFields = artifactEventFieldsForToolResult("generate_document", {
    ...result,
    artifact_paths: Array.isArray(result.artifact_paths) ? result.artifact_paths.filter(Boolean) : []
  });
  for (const artifactPath of result.artifact_paths ?? []) {
    if (!artifactPath) continue;
    onEvent?.({
      event_type: "artifact_created",
      payload: {
        path: artifactPath,
        mime: result.metadata?.mime_type ?? null,
        ...(artifactFields.artifact_action ? { artifact_action: artifactFields.artifact_action } : {}),
        ...(artifactFields.artifact_source ? { artifact_source: artifactFields.artifact_source } : {})
      }
    });
  }
  return {
    ok: true,
    result,
    artifactPaths: Array.isArray(result.artifact_paths) ? result.artifact_paths.filter(Boolean) : []
  };
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
  // UCA-181 parity with tool_using: drop schedule-registry tools when
  // the task is the firing of an already-scheduled run, so the LLM
  // doesn't re-interpret the fired userCommand as another schedule
  // request and call create_scheduled_task again.
  const insideScheduledFire = isScheduledFireTask(task);
  const builtinTools = (noteSingleMarkdown
    ? rawBuiltinTools.filter((tool) => tool.id !== "generate_document")
    : rawBuiltinTools)
    .filter((tool) => !insideScheduledFire || !isScheduleRegistryTool(tool));

  // UCA-067: inject MCP tools from enabled stdio servers so ALL providers
  // (including native Anthropic/OpenAI) can call them as first-class tools.
  const mcpRegistry = runtime?.platform?.mcpServers;
  let mcpTools = [];
  try {
    mcpTools = await getMcpActionTools(mcpRegistry, {
      secretStore: runtime?.secretStore ?? null,
      processEnv: process.env
    });
  } catch { /* MCP unavailable — continue without it */ }
  if (insideScheduledFire) {
    mcpTools = mcpTools.filter((tool) => !isScheduleRegistryTool(tool));
  }

  // Merge: built-in tools first so they take priority on id collision
  const mcpToolById = new Map(mcpTools.map((t) => [t.id, t]));
  const effectiveTools = filterToolsForAgenticTask([...builtinTools, ...mcpTools], task);

  const effectiveSkills = await runtime?.platform?.skillRegistries?.listSkills?.({
    runtime
  }) ?? [];
  const effectiveSkillContext = summarizeSkillContext(effectiveSkills, { task, limit: 20 });
  if (effectiveSkillContext.active_count > 0 || effectiveSkillContext.workflow_hints.length > 0) {
    onEvent?.({
      event_type: "skill_context_loaded",
      payload: {
        executor: "agentic",
        ...effectiveSkillContext
      }
    });
  }

  const resolvedProvider = provider ?? resolveProviderForModelRole("planner", "chat", process.env, {
    task,
    store: runtime?.store
  });
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

  const buildSystemPrompt = (validatorTranscript = []) => buildAgenticSystemPrompt({
    tools: effectiveTools,
    skills: effectiveSkills,
    task,
    requestedFormat,
    evidenceLedger: renderEvidenceLedger(validatorTranscript)
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

  // J2: initialise the error budget BEFORE the preflight (was J1-time
  // post-preflight) so the preflight web_search_fetch call participates
  // in the same per-tool budget+gate controls as the main loop. Reads
  // execution_constraints.error_budget from TaskSpec — parity with
  // tool_using/agent-loop:961-963 — so SemanticRouter / runtime
  // overrides for deep-research / lenient-mode tasks affect both
  // executors uniformly. earlyExitState may be set by the preflight
  // helper call below; if so the main loop is skipped entirely.
  let errorBudget = createErrorBudget(
    task?.task_spec?.execution_constraints?.error_budget
  );
  let earlyExitState = null;
  let contractActionGuidanceCount = 0;
  let localFileReadGuidanceCount = 0;
  const MAX_CONTRACT_ACTION_GUIDANCE = 2;
  let forcedNextToolChoice = null;
  // Soft saturation nudge for multi_source / deep_research tasks. Same
  // shape as tool_using's hint — fires once per task as a system note in
  // the next message so the model can decide whether to switch angles or
  // synthesize. See evidence-normalizer.detectSearchSaturation.
  let saturationHintFired = false;
  maxIterations = resolveTaskMaxIterations(task, maxIterations);

  let preflightSearchText = "";
  if (taskNeedsCurrentWebData(task)) {
    // P4-00.7 design note (§18.6.1.A clarification): we deliberately use
    // `web_search_fetch` here as the *preferred preflight* — it returns
    // parsed snippets the LLM can cite directly, which is strictly more
    // useful than `web_search` (browser-only) or `fetch_url_content`
    // (needs a known URL). The post-result instruction below tells the
    // model it can fall back to any sibling in `external_web_read` if
    // this preflight returns nothing — that's what makes the path
    // group-aware end-to-end. If a future SemanticRouter forbids
    // web_search_fetch specifically, the policy guard wraps this call
    // with a blocked_by_policy result, the post-instruction directs the
    // model to pick a sibling, and the success contract (any-of group)
    // is still satisfiable.
    const searchCall = {
      name: "web_search_fetch",
      arguments: {
        query: task.user_command ?? "",
        recency: inferSearchRecencyFromText(task.user_command, { recentBucket: "week", fallback: "month" }),
        limit: 6
      }
    };
    onEvent?.({
      event_type: "tool_call_started",
      payload: { tool_id: searchCall.name, arguments: searchCall.arguments, preflight: true }
    });
    const searchResult = await executeAgenticToolCall({
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
      task,
      transcript,
      signal
    });
    const searchTranscriptEntry = {
      type: "tool_result",
      tool: searchCall.name,
      success: searchResult.success,
      observation: searchResult.observation ?? "",
      metadata: searchResult.metadata ?? {},
      artifact_paths: searchResult.artifact_paths ?? []
    };
    onEvent?.({
      event_type: "tool_call_completed",
      payload: {
        tool_id: searchCall.name,
        success: searchResult.success,
        observation: (searchResult.observation ?? "").slice(0, 500),
        metadata: searchResult.metadata ?? {},
        sources: normalizeSources(searchTranscriptEntry),
        preflight: true,
        ...artifactEventFieldsForToolResult(searchCall.name, searchResult)
      }
    });
    transcript.push({
      role: "tool",
      tool_call_id: "preflight_web_search_fetch",
      name: searchCall.name,
      success: searchResult.success,
      observation: searchResult.observation ?? "",
      // H1: preserve metadata so extractEvidence can pull
      // `metadata.results[].url` for web_search_fetch and
      // `metadata.url` for fetch_url_content. Pre-H1 the agentic
      // transcript dropped metadata, so evidence extraction always
      // reported 0 sources.
      metadata: searchResult.metadata ?? {},
      artifact_paths: searchResult.artifact_paths ?? []
    });

    // J2: run the per-tool controls on the preflight result. Pre-J2
    // this entry was outside both the budget and the step gate, so an
    // empty preflight wasted half the budget invisibly and a failed
    // preflight didn't count toward tool_failure at all. iteration=0
    // — the preflight runs before any LLM turn.
    {
      const ctrl = processAgenticToolResultForControls({
        call: searchCall,
        result: searchResult,
        transcript,
        errorBudget,
        iteration: 0,
        maxIterations,
        taskSpec: selectSuccessContractValidationSpec(task),
        onEvent,
        preflight: true
      });
      errorBudget = ctrl.errorBudget;
      if (ctrl.earlyExit) earlyExitState = ctrl.earlyExit;
    }

    preflightSearchText = [
      "Live web search preflight result:",
      searchResult.observation || "(web_search_fetch returned no observation)",
      "",
      "Use the live search result above for current/latest facts. If it failed or looks insufficient, try a better query or call fetch_url_content on a known authoritative URL / public data endpoint, with a larger max_chars when the page contains detailed fields. Do not answer current/latest facts from memory."
    ].join("\n");
  }

  const userContent = [buildAgenticUserMessage(task), preflightSearchText].filter(Boolean).join("\n\n---\n\n");
  const modelContextWindow = provider?.model?.context_window
    ?? provider?.model?.context_length
    ?? provider?.context_window
    ?? 200000;
  const historyResult = runtime
    ? loadStructuredHistoryFor({ runtime, task, executor: "agentic", modelContextWindow })
    : { mode: "legacy_fallback", historyMessages: [], currentMessageRendered: null };

  const stableSystemPrompt = buildAgenticStableSystemPrompt();
  const messages = [
    cacheableSystemMessage(stableSystemPrompt),
    { role: "system", content: buildSystemPrompt(transcriptForValidator(transcript)) }
  ];
  let promptHistoryMessages = [];
  let promptCurrentContent = userContent;
  let promptActionObligationsContent = "";
  if (historyResult.mode === "structured" && historyResult.currentMessageRendered) {
    promptHistoryMessages = historyResult.historyMessages;
    promptCurrentContent = userContent;
    for (const m of historyResult.historyMessages) messages.push(m);
    messages.push({ role: historyResult.currentMessageRendered.role, content: userContent });
  } else {
    messages.push({ role: "user", content: userContent });
  }

  const initialPendingActionObligations = actionObligationsWithStatus(
    evaluateActionObligations(task?.task_spec, transcript),
    ["pending"]
  );
  if (initialPendingActionObligations.length > 0) {
    promptActionObligationsContent = `[Action obligations]\n${buildActionObligationGuidance(initialPendingActionObligations)}`;
    messages.push({
      role: "user",
      content: promptActionObligationsContent
    });
  }

  const toolSchemas = effectiveTools.map(toolDescriptorForAdapter);

  let finalText = "";
  let iterations = 0;

  // J2: skip the main loop entirely if the preflight already triggered
  // an early exit (budget exhaustion or phase-gate abort/escalate).
  // The post-loop validator block reads earlyExitState to surface
  // phase_gate / error_budget on the planner result.
  for (iterations = 0; iterations < maxIterations && !earlyExitState; iterations += 1) {
    if (signal?.aborted) {
      const err = new Error("Agentic planner aborted.");
      err.code = "ABORT_ERR";
      throw err;
    }

    let response;
    try {
      messages[1].content = buildSystemPrompt(transcriptForValidator(transcript));
      // Stream planner text live so the user sees output flow in real time.
      // Pre-fix this was disabled to stop providers from leaking control JSON
      // (`{iteration,next_action,…}`) into the bubble; that also killed
      // streaming on the final answer. Two-line defense instead: the system
      // prompt rule forbids raw control JSON, and the renderer suppresses any
      // chunk that still matches that shape.
      const onTextDelta = (adapter.supportsStreaming && onEvent)
        ? (delta) => onEvent({ event_type: "text_delta", payload: { delta } })
        : undefined;
      const onToolInputDelta = (adapter.supportsStreaming && onEvent)
        ? (toolName, partialJson) => {
            if (!isStreamableArtifactTool(toolName)) return;
            onEvent({
              event_type: "tool_input_delta",
              payload: { tool_id: toolName, partial_json: partialJson }
            });
          }
        : undefined;
      response = await adapter.generate({
        messages,
        tools: toolSchemas,
        ...(forcedNextToolChoice ? { tool_choice: forcedNextToolChoice } : {}),
        signal,
        fetchImpl,
        onTextDelta,
        onReasoningDelta: (adapter.supportsStreaming && onEvent)
          ? (delta) => {
              if (!delta) return;
              onEvent({ event_type: "reasoning_delta", payload: { delta } });
            }
          : undefined,
        onToolInputDelta
      });
      emitLlmUsage({
        runtime,
        onEvent,
        task,
        callSite: "agentic.planner",
        iteration: iterations,
        usage: response?.usage,
        provider: adapter,
        stream: adapter.supportsStreaming === true,
        promptSegments: [
          { name: "cacheable_system", content: stableSystemPrompt },
          { name: "dynamic_system", content: messages[1]?.content ?? "" },
          { name: "history", content: promptHistoryMessages },
          { name: "current", content: promptCurrentContent },
          { name: "action_obligations", content: promptActionObligationsContent },
          { name: "tool_transcript", content: messages.slice(2 + promptHistoryMessages.length + 1 + (promptActionObligationsContent ? 1 : 0)) },
          { name: "tool_schemas", content: toolSchemas }
        ]
      });
      forcedNextToolChoice = null;
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
    // UCA-182 Phase 22: capture DeepSeek v4's thinking-mode
    // reasoning_content so we can echo it back on the next turn.
    // Providers that don't return this field yield null; null is
    // dropped when the message is pushed so only DeepSeek ends up
    // sending it across the wire.
    const reasoningContent = typeof response?.reasoning_content === "string"
      ? response.reasoning_content
      : null;

    if (toolCalls.length === 0) {
      const validatorTx = transcriptForValidator(transcript);
      const obligations = evaluateActionObligations(task?.task_spec, validatorTx, {
        finalText: text,
        availableToolIds: effectiveTools.map((tool) => tool.id)
      });
      const waitingAction = findWaitingActionApproval(obligations)
        ?? findWaitingActionApprovalInTranscript(validatorTx);
      if (waitingAction) {
        earlyExitState = {
          kind: "waiting_external_decision",
          obligation: waitingAction
        };
        finalText = formatWaitingActionFinal({ task, obligation: waitingAction });
        break;
      }
      const pendingActionObligations = actionObligationsWithStatus(obligations, ["pending"]);
      if (pendingActionObligations.length > 0
          && contractActionGuidanceCount < MAX_CONTRACT_ACTION_GUIDANCE
          && iterations < maxIterations - 1) {
        contractActionGuidanceCount += 1;
        if (text && text.trim()) {
          messages.push({ role: "assistant", content: text });
          transcript.push({ role: "assistant", text });
        }
        messages.push({
          role: "user",
          content: `[Required action handoff]\n${buildActionObligationGuidance(pendingActionObligations)}`
        });
        onEvent?.({
          event_type: "contract_action_handoff",
          payload: {
            iteration: iterations,
            required_policy_groups: pendingActionObligations.map((obligation) => obligation.group),
            source: "final_gate"
          }
        });
        continue;
      }
      const terminalActionObligations = actionObligationsWithStatus(obligations, [
        "blocked_missing_input",
        "abandoned_with_reason"
      ]);
      if (terminalActionObligations.length > 0) {
        earlyExitState = {
          kind: "action_obligation_terminal",
          obligations: terminalActionObligations
        };
      }
      const validationSpec = selectSuccessContractValidationSpec(task);
      const finalStepGate = validateStepGate(validationSpec, validatorTx, {
        iteration: iterations,
        maxIterations
      });
      const artifactViolation = artifactContractViolation(finalStepGate);
      if (
        artifactViolation
        && hasOnlyArtifactContractViolations(finalStepGate)
        && text
        && text.trim()
        && effectiveTools.some((tool) => tool?.id === "generate_document")
      ) {
        const forcedArtifact = await runDeterministicAgenticArtifactObligation({
          runtime,
          task,
          taskSpec: validationSpec,
          transcript,
          finalText: text,
          iteration: iterations,
          onEvent,
          signal
        });
        if (forcedArtifact.ok) {
          for (const artifactPath of forcedArtifact.artifactPaths) {
            if (artifactPath && !artifactPaths.includes(artifactPath)) {
              artifactPaths.push(artifactPath);
            }
          }
          finalText = forcedArtifact.artifactPaths.length > 0
            ? `已生成请求的 ${artifactKindFromTaskSpec(validationSpec)} 文件，已添加到本次任务的文件结果中。`
            : text;
          break;
        }
      }
      if (artifactViolation && iterations < maxIterations - 1) {
        if (text && text.trim()) {
          messages.push({ role: "assistant", content: text });
          transcript.push({ role: "assistant", text });
        }
        const artifactKind = artifactKindFromTaskSpec(validationSpec);
        const guidance = buildAgenticArtifactContractGuidance({
          taskSpec: validationSpec,
          violation: artifactViolation
        });
        const guidancePayload = {
          iteration: iterations,
          required_policy_groups: ["artifact_generation"],
          artifact_kind: artifactKind,
          action_only: false,
          source: "final_gate"
        };
        messages.push({
          role: "user",
          content: `[Artifact contract]\n${guidance}`
        });
        if (effectiveTools.some((tool) => tool?.id === "generate_document")) {
          forcedNextToolChoice = { type: "tool", name: "generate_document" };
        }
        onEvent?.({
          event_type: "phase_gate_signal",
          payload: {
            iteration: iterations,
            next_action: finalStepGate.next_action,
            satisfied: false,
            violation_kinds: (finalStepGate.violations ?? []).map((v) => v.kind)
          }
        });
        onEvent?.({
          event_type: "contract_guidance",
          payload: guidancePayload
        });
        if (runtime?.store?.appendAuditLog) {
          appendAuditLog(runtime, "tool_loop.contract_guidance", guidancePayload, task?.task_id ?? null);
        }
        continue;
      }
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
    const assistantMessage = {
      role: "assistant",
      content: text,
      tool_calls: toolCalls
    };
    if (reasoningContent) assistantMessage.reasoning_content = reasoningContent;
    messages.push(assistantMessage);
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

      const result = await executeAgenticToolCall({
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
        task,
        transcript,
        signal
      });
      const transcriptEntry = {
        type: "tool_result",
        tool: call.name,
        success: result.success,
        observation: result.observation ?? "",
        metadata: result.metadata ?? {},
        artifact_paths: result.artifact_paths ?? []
      };
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
          metadata: result.metadata ?? {},
          sources: normalizeSources(transcriptEntry),
          ...artifactEventFieldsForToolResult(call.name, result)
        }
      });

      transcript.push({
        role: "tool",
        tool_call_id: call.id ?? call.name,
        name: call.name,
        success: result.success,
        observation: result.observation ?? "",
        // H1: preserve metadata for extractEvidence (see preflight site above).
        metadata: result.metadata ?? {},
        artifact_paths: result.artifact_paths ?? []
      });

      {
        const validatorTx = transcriptForValidator(transcript);
        const waitingAction = findWaitingActionApproval(
          evaluateActionObligations(task?.task_spec, validatorTx)
        ) ?? findWaitingActionApprovalInTranscript(validatorTx);
        if (waitingAction) {
          earlyExitState = {
            kind: "waiting_external_decision",
            obligation: waitingAction
          };
          finalText = formatWaitingActionFinal({ task, obligation: waitingAction });
          break;
        }
      }

      // J2: per-tool controls via the shared helper. Same checks as
      // tool_using/agent-loop:1224-1331; previously inlined here, now
      // factored so the preflight site can run the same predicate.
      const ctrl = processAgenticToolResultForControls({
        call,
        result,
        transcript,
        errorBudget,
        iteration: iterations,
        maxIterations,
        taskSpec: selectSuccessContractValidationSpec(task),
        onEvent,
        preflight: false,
        localFileReadGuidanceCount
      });
      errorBudget = ctrl.errorBudget;
      if (ctrl.earlyExit) {
        earlyExitState = ctrl.earlyExit;
        break;
      }
      if (ctrl.localFileReadGuidance) {
        localFileReadGuidanceCount += 1;
        const guidancePayload = {
          ...ctrl.localFileReadGuidance.eventPayload,
          guidance_count: localFileReadGuidanceCount
        };
        messages.push({
          role: "user",
          content: `[Fresh local file read required]\n${ctrl.localFileReadGuidance.instruction}`
        });
        onEvent?.({
          event_type: "local_file_read_guidance",
          payload: guidancePayload
        });
        if (runtime?.store?.appendAuditLog) {
          appendAuditLog(runtime, "tool_loop.local_file_read_guidance", guidancePayload, task?.task_id ?? null);
        }
        break;
      }

      const artifactFields = artifactEventFieldsForToolResult(call.name, {
        ...result,
        artifact_paths: Array.isArray(result.artifact_paths) ? result.artifact_paths.filter(Boolean) : []
      });
      for (const artifactPath of result.artifact_paths ?? []) {
        if (artifactPath && !artifactPaths.includes(artifactPath)) {
          artifactPaths.push(artifactPath);
          onEvent?.({
            event_type: "artifact_created",
            payload: {
              path: artifactPath,
              mime: result.metadata?.mime_type ?? null,
              ...(artifactFields.artifact_action ? { artifact_action: artifactFields.artifact_action } : {}),
              ...(artifactFields.artifact_source ? { artifact_source: artifactFields.artifact_source } : {})
            }
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

      if (!saturationHintFired && shouldCheckSaturation(task)) {
        const sat = detectSearchSaturation(transcriptForValidator(transcript), 3);
        if (sat.saturated) {
          saturationHintFired = true;
          const repeated = sat.repeated_domains.length > 0
            ? sat.repeated_domains.slice(0, 4).join(", ")
            : "the same publishers";
          messages.push({
            role: "user",
            content: `(system note) The last ${sat.window_size} web fetches added no new independent publishers/domains beyond ${repeated}. Decide based on what you already have: if the evidence covers the question, synthesize the answer now; if not, try a meaningfully different angle (different keywords, different language, an alternate authoritative URL) — do not repeat near-duplicate searches against the same publishers.`
          });
          onEvent?.({
            event_type: "saturation_hint",
            payload: {
              iteration: iterations,
              window_size: sat.window_size,
              repeated_domains: sat.repeated_domains,
              baseline_domain_count: sat.baseline_domain_count
            }
          });
        }
      }
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

    // J1: propagate early exit out of the outer loop. When the budget
    // exhausts or the phase gate aborts/escalates, we already broke the
    // inner tool-call loop above; this break terminates the outer
    // turn loop too so we go straight to the post-loop validator block
    // with the diagnostic state populated.
    if (earlyExitState) break;
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
      content: "You've used your tool-call budget. Synthesize a final answer for the original question using only the information already collected above. Do not request more tools. Do not output raw internal control/event JSON; omit fields like iteration, next_action, violation_kinds, and satisfied."
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
      emitLlmUsage({
        runtime,
        onEvent,
        task,
        callSite: "agentic.synthesis",
        iteration: iterations,
        usage: synthesis?.usage,
        provider: adapter,
        stream: adapter.supportsStreaming === true,
        promptSegments: [
          { name: "cacheable_system", content: stableSystemPrompt },
          { name: "dynamic_system", content: messages[1]?.content ?? "" },
          { name: "history", content: promptHistoryMessages },
          { name: "current", content: promptCurrentContent },
          { name: "action_obligations", content: promptActionObligationsContent },
          { name: "tool_transcript", content: messages.slice(2 + promptHistoryMessages.length + 1 + (promptActionObligationsContent ? 1 : 0), -1) },
          { name: "synthesis_instruction", content: messages[messages.length - 1]?.content ?? "" }
        ]
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

  return finalizeAgenticPlannerRun({
    task,
    finalText,
    transcript,
    earlyExitState,
    artifactPaths,
    descriptor,
    iterations
  });
}
