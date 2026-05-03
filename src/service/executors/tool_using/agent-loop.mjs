import crypto from "node:crypto";
import { createActionToolRegistry } from "../../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../action_tools/tools/index.mjs";
import { validateToolCall } from "./tool-call-validator.mjs";
import { emitTaskEvent as _emitTaskEventFn } from "../../core/task-runtime.mjs";
import {
  extractWorkflowInput,
  inferConnectorLimit,
  inferConnectorProvider,
  isConnectorAccountIdentityRequest,
  isConnectorDomainRequest,
  matchWorkflowByTrigger
} from "../../connectors/core/connector-intent.mjs";
import { createProviderAdapter } from "../agentic/provider-adapter.mjs";
import { resolveProviderForTask } from "../shared/provider-resolver.mjs";
import { loadStructuredHistoryFor } from "../shared/conversation-history-loader.mjs";
import { buildSynthesisGuidance } from "../shared/synthesis-prompt.mjs";
import { validateAnswerSynthesis } from "../../core/policy/success-contract-validator.mjs";
import {
  formatResourceContext,
  formatUntrustedSourceMaterial,
  extractAbsoluteLocalPathsFromText
} from "../shared/resource-context.mjs";
import { renderBackgroundContextsBlock } from "../../core/intent/background-contexts.mjs";
import { renderToolPolicyForPrompt } from "../../core/policy/policy-groups.mjs";
import { renderResearchPrinciples, renderResearchBudget } from "../shared/research-principles.mjs";
import { extractEvidence, detectSearchSaturation } from "../../core/policy/evidence-normalizer.mjs";
import { validateSuccessContract } from "../../core/policy/success-contract-validator.mjs";
import {
  actionObligationsWithStatus,
  buildActionObligationGuidance,
  buildActionObligationPrompt,
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";
import {
  renderSideEffectContractPrompt
} from "../../core/policy/side-effect-contracts.mjs";
import { createErrorBudget } from "../../core/runtime/error-budget.mjs";
// UCA-077 P3-01: deterministic / connector planners + their helpers moved
// into a `planners/` directory so this file owns the loop and provider
// glue, not regex tables. defaultPlanner still lives here because it is
// the fallback planner bound to this executor.
import { planDeterministicToolCall } from "./planners/deterministic.mjs";
import { planConnectorToolCall } from "./planners/connector.mjs";
import { extractLaunchAppName } from "./planners/launch-helpers.mjs";
import { buildLaunchSequenceGuidance } from "./launch-sequence.mjs";
import {
  finalFallbackText,
  hasActionAttempts,
  hasUnresolvedActionFailure,
  localFallbackFinal,
  needsFinalComposer
} from "./finalization.mjs";
import { composeFinalAnswer } from "./final-composer.mjs";
import {
  buildHistoryString,
  formatWorkflowsForPlanner,
  formatToolForPlanner,
  plannerToolDescriptorForAdapter
} from "./planner-formatting.mjs";
import {
  filterToolsForTask,
  isScheduledFireTask,
  shouldRenderWorkflowHint
} from "./tool-surface.mjs";
import {
  actionOnlyToolIds,
  filterToolsForActionOnlyGuidance
} from "./action-guidance.mjs";
import {
  buildLeanChatSystemPrompt,
  renderRequiredContractForPlanner,
  shouldRetryProseTrap,
  shouldUseLeanChatMode
} from "./planner-mode.mjs";
import { buildConversationMessages } from "./conversation-messages.mjs";
import { repairToolArgs } from "./tool-arg-repair.mjs";
import {
  buildHallucinatedClaimBanner,
  detectUnbackedConnectorClaim
} from "./truthfulness-guard.mjs";
import {
  inferSearchRecencyFromText,
  resolveTaskMaxIterations,
  shouldCheckSaturation
} from "./loop-policy.mjs";
import {
  createPendingToolApproval,
  resolveInteractiveConfirmation,
  shouldBlockHighRiskUnattended
} from "./confirmation-gate.mjs";
import {
  buildPhaseGateStop,
  DEFAULT_PHASE_GATE_GUIDANCE_LIMITS,
  evaluatePhaseGate,
  phaseGateAuditPayload,
  phaseGateSignalPayload,
  planContractActionHandoff,
  planRunbookGuidance
} from "./phase-gate.mjs";
import {
  chargeToolLoopErrorBudget,
  errorBudgetChargeAuditPayload,
  errorBudgetResultPayload,
  errorBudgetSignalPayload
} from "./error-budget-gate.mjs";
import {
  applySideEffectContractToDecisionArgs,
  planRedundantSideEffectGuard
} from "./side-effect-gate.mjs";
import { planScheduledFireRegistryGuard } from "./scheduled-fire-gate.mjs";

export { shouldInjectRequiredActionGuidance } from "./action-guidance.mjs";

function nowIso() {
  return new Date().toISOString();
}

function defaultPlanner({ task, runtime: plannerRuntime = null }) {
  const text = task.user_command.toLowerCase();
  const catalog = plannerRuntime?.connectorCatalog ?? task.__runtime?.connectorCatalog ?? null;
  const deterministic = planDeterministicToolCall(task.user_command, catalog);
  if (deterministic) return deterministic;

  const connector = planConnectorToolCall(task.user_command, catalog);
  if (connector) return connector;

  // UCA-077 P1-06: web_search_fetch is decided by tool-policy-resolver.
  // Defer to that field rather than running a parallel regex gate here.
  if (task.task_spec?.tool_policy?.web_search_fetch?.mode === "required") {
    return {
      type: "tool_call",
      tool: "web_search_fetch",
      args: {
        query: task.user_command,
        recency: inferSearchRecencyFromText(task.user_command)
      }
    };
  }

  const launchApp = extractLaunchAppName(task.user_command);
  if (launchApp) {
    return {
      type: "tool_call",
      tool: "launch_app",
      args: {
        app: launchApp
      }
    };
  }

  if (text.includes("通知") || text.includes("notify")) {
    return {
      type: "tool_call",
      tool: "notify",
      args: {
        title: "UCA",
        body: "Action completed."
      }
    };
  }

  return {
    type: "final",
    text: "No tool was required."
  };
}

// UCA-077 P3-01: planDeterministicToolCall, planConnectorToolCall, and the
// connector capability helpers moved to ./planners/. The launch-app helpers
// moved to ./planners/launch-helpers.mjs.

/**
 * Summarise the resources the LLM can actually reach right now — attachments,
 * selection text, connected accounts, current wall-clock time. The LLM is a
 * single brain that decides how to act; without this block it has to guess
 * what's available. This is the pattern mainstream agent frameworks
 * (LangGraph / CrewAI / AutoGPT) use: give the model the raw context and
 * the tool belt, and let it plan.
 */
// P4-00.5: formatResourceContext + extractAbsoluteLocalPathsFromText were
// moved to ../shared/resource-context.mjs so fast / tool_using / agentic
// share a single source of truth for ambient facts the LLM needs (time,
// location, attachments, connected accounts). See plan §14.3 / §15.3 — the
// missing-location bug only surfaced after Phase 1-3 routing started
// sending conversational location questions to fast (which had no
// injection at all).

// UCA-077 P1-06: isSearchOrNewsRequest was the parallel regex gate that
// short-circuited web_search_fetch before the LLM planner ran. Its concerns
// have been split:
//   - The "search verb" half lives in core/intent/signals/explicit-search.mjs
//   - The "weak time marker" half lives in core/intent/signals/weak-freshness.mjs
//   - The actual decision (forbidden/optional/required) is owned by
//     core/policy/tool-policy-resolver.mjs and surfaces as
//     task.task_spec.tool_policy.web_search_fetch.mode.
// Callers in this file now read the resolved policy instead of re-deriving.

// UCA-077 P3-01: launch-app helpers moved to ./planners/launch-helpers.mjs.

// UCA-077 P3-01: extractUrl moved to ./planners/launch-helpers.mjs.
// Planner prompt formatting now lives in ./planner-formatting.mjs.

async function llmPlanner({ task, transcript, tools, iteration, runtime }) {
  const provider = resolveProviderForTask("chat");
  if (!provider || provider.kind === "code_cli") {
    return defaultPlanner({ task, runtime: task.__runtime ?? null });
  }

  const leanChatMode = shouldUseLeanChatMode(task);
  const plannerTools = leanChatMode ? [] : filterToolsForTask(tools, task);
  const toolList = plannerTools.map(formatToolForPlanner).join("\n");
  const workflowHint = !leanChatMode && shouldRenderWorkflowHint(task)
    ? formatWorkflowsForPlanner(task.__runtime?.connectorCatalog)
    : "";
  const resourceHint = formatResourceContext(task);
  const maxIter = resolveTaskMaxIterations(task, 8);

  // UCA-067: Append enabled MCP server capabilities to the tool list so the AI
  // is aware of them. Actual MCP tool invocation is handled separately; this is
  // informational so the AI can suggest using them when relevant.
  let mcpCapabilitiesNote = "";
  try {
    const mcpServers = task.__runtime?.platform?.mcpServers;
    if (mcpServers) {
      const statuses = await mcpServers.listStatus();
      const enabledServers = statuses.filter((s) => s.enabled && s.available);
      if (enabledServers.length > 0) {
        mcpCapabilitiesNote = `\n\nRegistered MCP capabilities (not directly callable via tool JSON — mention them to the user if relevant):\n${enabledServers.map((s) => `- ${s.id}: ${s.displayName}`).join("\n")}`;
      }
    }
  } catch { /* non-fatal */ }

  // UCA-077 P1-06: render the tool policy as evidence-bearing prose instead
  // of a "MUST DO X" hard rule. The LLM sees the decision (required /
  // optional / forbidden) and the reason; the resolver is the single
  // source of truth.
  // P4-00.7 (revised §18.6.1.A + this round's tool_using fix): use the
  // shared helper so this prompt and the agentic prompt-builder render
  // tool_policy identically — group entries first with `(any of: ...)`
  // so the LLM understands the requirement is satisfied by any sibling
  // tool, not narrowed to web_search_fetch.
  const policyLines = renderToolPolicyForPrompt(task.task_spec?.tool_policy);
  const needsCurrentDataInstruction = policyLines.length > 0
    ? `\n\nTool policy:\n${policyLines.map((line) => line.startsWith("  ") ? line : `- ${line}`).join("\n")}`
    : "";
  const requiredContractBlock = renderRequiredContractForPlanner(task);
  const actionObligationBlock = !leanChatMode
    ? buildActionObligationPrompt(task.task_spec, transcript)
    : "";
  const sideEffectContractBlock = renderSideEffectContractPrompt(task);

  // P4-RQ C1: research/multi-source coaching for search/research class
  // tasks. Gated on `external_web_read != forbidden` AND no local
  // anchor (real_selection / file_text); see research-principles.mjs.
  const researchPrinciples = renderResearchPrinciples(
    task.task_spec?.tool_policy,
    task.context_packet?.context_sources
  );
  const researchPrinciplesBlock = researchPrinciples ? `\n\n${researchPrinciples}` : "";
  // P4-RQ K2: numerical budget block — render the validator's
  // thresholds verbatim so the model sees the exact bar.
  const researchBudget = renderResearchBudget(
    task.task_spec?.tool_policy,
    task.context_packet?.context_sources,
    task.task_spec?.research_quality
  );
  const researchBudgetBlock = researchBudget ? `\n\n${researchBudget}` : "";
  const synthesisBlock = (() => {
    const block = buildSynthesisGuidance(task.task_spec);
    return block ? `\n\n${block}` : "";
  })();

  // UCA-063: Override instruction when refusal retry is active.
  const forceToolInstruction = task.__forceToolUse
    ? "\n\nCRITICAL OVERRIDE: You MUST call a tool. Saying 'I cannot operate your computer' or any similar refusal is STRICTLY FORBIDDEN. You have tools available — use them. The user is on a desktop computer and you have launch_app, open_url, and other action tools."
    : "";

  // UCA-096: Scheduled tasks re-enter the agent loop at trigger time carrying
  // their original natural-language command (e.g. "提醒我喝水"). Without this
  // guard, the LLM re-interprets the phrase as a NEW scheduling request and
  // calls create_scheduled_task again, self-replicating forever. The
  // scheduler marks its own submissions with scheduled_task_fire=true;
  // detect that and tell the LLM to execute the action directly. Manual
  // "Run Now" uses source_app="uca.console.desktop", so the metadata flag
  // is the source of truth.
  const scheduledFireInstruction = isScheduledFireTask(task)
    ? "\n\nSCHEDULED-FIRE CONTEXT: This request is the actual firing of an already-scheduled task — the delay has ALREADY elapsed. Execute the action NOW. Do NOT call create_scheduled_task under any circumstances. For a reminder, call notify directly. For an email, call the send workflow directly. The scheduling was done earlier; your job here is to perform the action."
    : "";

  const systemPrompt = leanChatMode
    ? buildLeanChatSystemPrompt({ task, synthesisBlock })
    : `You are LingxY, a capable desktop AI assistant running ON the user's machine. You have real local-execution tools: launch_app actually starts native applications, open_url actually navigates the user's browser, generate_document actually writes files to disk. You are NOT a "web assistant", "shortcut helper", or "chat-only" persona — refusing to call launch_app on the grounds that you "cannot operate a desktop computer" is wrong; the tools below are exactly that operation. Read the user's request carefully, consider what you have available (tools, workflows, attached resources, connected accounts), and decide how to accomplish their goal. Ask a short clarifying question only when you genuinely cannot proceed faithfully.
${resourceHint}
Available execution tools:
${toolList}${workflowHint}${requiredContractBlock}${actionObligationBlock}${sideEffectContractBlock}

Use the native call_tool interface when a tool is needed: choose exactly one tool id from the list and pass its arguments as an object. Tool metadata is part of the execution contract: policy groups say which contract applies, risk indicates approval sensitivity, and capabilities say what the tool can actually touch.

Guidance (not a rigid checklist — apply judgment):
- **Execute with what you have.** If the request is concrete and you have the tool + data, just call it. Don't ask for permission the user already implicitly gave.
- **Ask only when necessary.** If a required field (recipient email, file path, specific item) is truly missing AND you can't infer it from the resources listed above, return {"final": "<one short clarifying question in the user's language>"} and stop. Do NOT ask when the user gave enough to act.
- **Use known absolute paths directly.** If the resources / history already include absolute local file paths, pass them verbatim to attachmentPaths / localPath / file tool arguments. Do NOT call list_files / glob_files / find_recent_files just to rediscover a path you already have.
- **Edit existing artifacts in place.** If the user asks to revise/refine a previously generated file, first locate the target path from attachments/resources/history (or get_latest_artifact if needed), then call edit_file with the SAME path. Do not create a fresh sibling file unless the user explicitly asks for a new copy.
- **Future-time requests schedule, not execute now.** If the user says "in N minutes/hours" or "tomorrow at X" or "tonight at Y" about WHEN to run the action (as opposed to event start time being an argument), call create_scheduled_task with action.type="task" and params.userCommand carrying the full instruction. The scheduler will wake you up at trigger time to execute.
- **Fan out enumerations.** When the user says "all / every / each <something>", start with an enumeration tool (list_files / glob_files / account_list_emails / account_list_files), read the result, then call the per-item action for each result in subsequent iterations. Do not guess counts or filenames.
- **Connector workflows over raw tools.** Gmail/Outlook/Calendar/Drive operations should use connector_workflow_run when a matching workflow exists (see the workflow list above). The workflow shows the user a draft with 确认/拒绝 buttons; you do NOT need to ask in chat.
- **Truthfulness.** Only claim an email was sent / event created / file uploaded when the transcript shows the corresponding tool returned success=true. If you prepared a draft and it's waiting on the user's approval, say so explicitly.
- **Use search by judgment, not reflex.** Read \`tool_policy.external_web_read\` first. When the mode is \`required\`, call a member of the \`external_web_read\` group before giving a factual current-data answer. When the mode is \`optional\`, decide from the user's goal: ask for missing essentials first, answer from stable knowledge when enough, or search when freshness is genuinely needed. When the mode is \`forbidden\`, do NOT search; ask for permission if live/external data is necessary.
- **Recover from weak search.** If \`web_search_fetch\` is empty, unavailable, or any source blocks scraping, do not stop at an apology. Try a better query, then switch to another \`external_web_read\` sibling such as \`fetch_url_content\` with a concrete authoritative URL. Prefer direct source pages or public data endpoints you can name from the task context, such as official, regulator, exchange, encyclopedic, finance quote, chart, RSS, weather, or documentation pages. For detailed pages, pass a larger \`max_chars\` to \`fetch_url_content\` when needed. Only say live data is unreachable after reasonable alternate queries/URLs all fail.
- **Operational failure ≠ policy denial.** Tool calls that return errors at the network / scraping layer (timeouts, HTTP 5xx, bot-detection pages) are TRANSIENT failures, not permission blocks. **Never tell the user that the system "forbids" or "denies" external network access just because a tool returned an error.** Policy denial applies only when this turn's \`tool_policy\` for the relevant group is literally \`forbidden\` — check that field before claiming the user lacks permission. Conflating "tool failed" with "policy forbidden" is a serious truthfulness violation.
- **No internal JSON in user replies.** Never output raw control objects or event payloads such as \`{"iteration":...,"next_action":...,"violation_kinds":...}\`. Final replies must be user-facing prose, lists, tables, or markdown in the user's language.
- **Local context first.** For location-dependent requests, use a real location only when it is present in Resources, the user's message, or conversation history. If Resources says UNKNOWN_LOCATION and the user did not name a place, ask for the city or location permission before searching or acting. Never infer a city from timezone, locale, IP, search defaults, or sample source names.
- **Phantom attachments.** If the user refers to an image / file / screenshot / 图片 / 这张 / 这张照片 / 这个文件 / 上传的 but Resources shows BOTH \`Attached files: (none)\` AND \`Attached images: (none)\`, ASK them to attach or paste it. Never describe, summarize, or analyze a fictional attachment. If the conversation history mentions a concrete path, pass that path to a tool argument; do not pretend to "see" it as an inline attachment.
- **Vision questions go through \`vision_analyze\`.** When the user asks what is in an attached image, to read text / OCR / 提取文字 from a screenshot, to compare images, or to summarise visual content, call \`vision_analyze\` with the absolute paths from \`Attached images\` (and a short prompt). Do NOT call \`vision_analyze\` for sending / forwarding / uploading / opening / revealing the image — those are connector or file-tool jobs (compose_email, account_send_email, account_upload_file, open_file, reveal_in_explorer). If this turn already includes the image as an inline block (your provider supports vision and the runtime attached it), just answer directly without calling \`vision_analyze\`.
- **Contracts are boundaries, not dead ends.** If a policy, risk gate, or missing approval blocks the action you think is necessary, do not give up and do not pretend success. Ask the user for the smallest permission or missing detail needed, then stop.
- **Memory recall.** If the user refers to earlier work with a pronoun ("上个问题" / "刚才" / "之前那份" / "last one" / "that report") or asks you to continue / revise something done before, call list_recent_tasks first (or recall_memory with a topic query if the reference is thematic) and then get_task_detail on the matching task_id. Never reply "I don't remember prior work" while these tools exist.
- **No placeholder content.** If drafting an email, write an actual greeting / body in the user's language based on what they said — never emit literal "邮件主题" or "lorem ipsum" strings.
- **Compound requests = chain tool calls.** When the user asks for multiple actions in one message ("打开 AppA 和 AppB"，"open A then B"，"启动这三个 app"), call ONE tool per turn but KEEP CALLING tools across turns until every requested action is done. Do NOT return a final answer after the first launch_app — the second / third are still pending. Only return final after every requested action shows success in the transcript.
- **Don't repeat failed tool+args pairs.** You have at most ${maxIter} tool calls; end early once the goal is met.
- **Policy may refine mid-task.** Your task starts with a deterministic policy snapshot. A semantic-routing update may arrive in a later iteration and tighten or relax fields like \`tool_policy.external_web_read\` or \`expected_output\`. Always read the LATEST tool_policy from this prompt; never violate explicit user constraints (e.g. "不要联网") regardless of policy updates.
${needsCurrentDataInstruction}${researchPrinciplesBlock}${researchBudgetBlock}${synthesisBlock}${forceToolInstruction}${scheduledFireInstruction}${mcpCapabilitiesNote}
Use call_tool when a tool is needed. Call at most ONE tool per turn. If no tool is needed, or you need a clarification, reply with plain text only in the user's language.`;

  try {
    let resultText = "";
    // P4-00.5 trust split: ctx.text was previously surfaced only via the
    // system-side resourceHint (`User-selected text:` line). That path
    // elevated third-party page content to system trust and made any
    // embedded prompt-injection ("ignore previous instructions…") look
    // like a system directive. Now ctx.text + ctx.url ride in the user
    // turn, fenced as <untrusted_source> with a guard sentence.
    const untrusted = formatUntrustedSourceMaterial(task);
    const runtimeForLoader = task.__runtime ?? null;
    const modelContextWindow = provider?.model?.context_window
      ?? provider?.model?.context_length
      ?? provider?.context_window
      ?? 200000;
    const historyResult = runtimeForLoader
      ? loadStructuredHistoryFor({
          runtime: runtimeForLoader,
          task,
          executor: "tool_using",
          modelContextWindow
        })
      : { mode: "legacy_fallback", historyMessages: [], currentMessageRendered: null };

    // Phase 1.11 — pull background_contexts each iteration so post-task
    // memory / recent-artifact patches land on iter ≥ 1 prompts. Rendered
    // as a clearly-labelled block AFTER the current user turn so the LLM
    // can never confuse it with the active request.
    const backgroundBlock = renderBackgroundContextsBlock(task.context_packet);
    const trailingContext = [untrusted, backgroundBlock].filter(Boolean).join("\n\n");

    let prefixMessages;
    if (historyResult.mode === "structured" && historyResult.currentMessageRendered) {
      const triggerContent = historyResult.currentMessageRendered.content ?? task.user_command;
      const currentContent = trailingContext ? `${triggerContent}\n\n${trailingContext}` : triggerContent;
      prefixMessages = [
        ...historyResult.historyMessages,
        { role: historyResult.currentMessageRendered.role, content: currentContent }
      ];
    } else {
      const initialUserContent = trailingContext
        ? `${task.user_command}\n\n${trailingContext}`
        : task.user_command;
      prefixMessages = [{ role: "user", content: initialUserContent }];
    }

    const conversationMessages = buildConversationMessages(
      prefixMessages,
      transcript,
      [
        ...(task.context_packet?.file_paths ?? []),
        ...(task.context_packet?.image_paths ?? []),
        ...extractAbsoluteLocalPathsFromText(task.context_packet?.text ?? "")
      ]
    );

    const toolSchemas = leanChatMode ? [] : [plannerToolDescriptorForAdapter()];
    runtime?.emitTaskEvent?.("planner_request_started", {
      iteration,
      planner_mode: leanChatMode ? "lean_chat" : "tool_planner"
    });
    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationMessages
    ];
    const adapter = createProviderAdapter(provider);
    const response = await adapter.generate({
      messages,
      tools: toolSchemas,
      maxTokens: 1024,
      // Stream planner text live so the user sees output flow in real time.
      // The previous "buffer until final" version eliminated control-JSON
      // leaks but also killed streaming on the final answer (planner returns
      // text-only when the LLM is done). Two-line defense instead: the system
      // prompt rule forbids raw control JSON, and the renderer suppresses any
      // `{iteration,next_action,violation_kinds,satisfied}`-shaped chunk that
      // does slip through.
      onTextDelta: adapter.supportsStreaming === true
        ? (delta) => {
            if (!delta) return;
            runtime?.emitTaskEvent?.("text_delta", { delta });
          }
        : undefined,
      onToolInputDelta: (toolName, partialJson) => {
        if (!["write_file", "generate_document", "edit_file"].includes(toolName)) return;
        runtime?.emitTaskEvent?.("tool_input_delta", {
          tool_id: toolName,
          partial_json: partialJson
        });
      },
      onReasoningDelta: (delta) => {
        if (!delta) return;
        runtime?.emitTaskEvent?.("reasoning_delta", { delta });
      }
    });
    resultText = response?.text ?? "";

    if (Array.isArray(response?.tool_calls) && response.tool_calls.length > 0) {
      const call = response.tool_calls[0];
      if (call.name === "call_tool") {
        return {
          type: "tool_call",
          tool: call.arguments?.tool,
          args: call.arguments?.args ?? {}
        };
      }
      return {
        type: "tool_call",
        tool: call.name,
        args: call.arguments ?? {}
      };
    }

    // Fallback compatibility path: some providers / bridges may still reply
    // in the older JSON-text protocol instead of native tool calls.
    let cleaned = resultText.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
    // try to extract JSON object if there's prose around it
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.tool) {
          // Some LLMs nest the call_tool envelope inside the prose
          // JSON: `{"tool": "call_tool", "args": {"tool": "X", "args": ...}}`.
          // Unwrap so the registry sees the real tool id rather than
          // refusing with "Unknown tool requested: call_tool".
          if (parsed.tool === "call_tool" && parsed.args && typeof parsed.args === "object") {
            const inner = parsed.args;
            if (inner.tool) {
              return {
                type: "tool_call",
                tool: inner.tool,
                args: inner.args ?? {}
              };
            }
          }
          return { type: "tool_call", tool: parsed.tool, args: parsed.args ?? {} };
        }
        if (parsed.final) {
          return { type: "final", text: parsed.final };
        }
      } catch {
        // Fall through to prose handling.
      }
    }

    // LLM wrote plain prose instead of JSON — most commonly when it wanted
    // to ask the user a clarifying question. Treat the whole response as a
    // final message so the user sees the question instead of "Unexpected
    // token" errors. (task_e2c4e734 regressed here before this change.)
    const prose = resultText.trim();
    if (prose) {
      return { type: "final", text: prose };
    }
    return { type: "final", text: "(no response from planner)" };
  } catch (error) {
    // LLM transport / network failure — surface a neutral message without
    // the internal parser trace.
    return { type: "final", text: `抱歉，暂时无法处理这个请求（${error.message}）。请重试或换一种表达。` };
  }
}

export function createToolUsingExecutorScaffold() {
  return {
    id: "tool_using",
    model: "llm_planner",
    supportsStreaming: true,
    maxIterations: 10,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Tool executor cancelled."), { code: "ABORT_ERR" });
      }

      yield { event_type: "step_started", payload: { step: "tool_planner", progress: 0.2 } };

      // Use module-level runtime stash set by submission layer
      const runtime = task.__runtime;
      if (!runtime) {
        yield { event_type: "failed", payload: { text: "执行器缺少运行上下文，无法继续这个任务。" } };
        return;
      }

      // Background submission returns task_created immediately, then
      // context-submission waits for SemanticRouter before this executor
      // starts. Memory recall / recent-artifact recall still patch in
      // asynchronously and are visible to later iterations.

      // Ensure emitTaskEvent is available on the runtime so tool_call_proposed /
      // tool_call_completed events are forwarded to the SSE stream (and rendered
      // in the overlay conversation view). action-tool-submission already sets
      // this; context-submission does not, so we patch it here.
      const runtimeWithEmit = runtime.emitTaskEvent ? runtime : {
        ...runtime,
        emitTaskEvent: (eventType, payload) =>
          _emitTaskEventFn({ runtime, taskId: task.task_id, eventType, payload })
      };

      try {
        const result = await runToolAgentLoop({
          task,
          runtime: runtimeWithEmit,
          planner: llmPlanner
        });

        // UCA-077 P1-08: shared SuccessContract validator. Replaces the old
        // inline "did web_search_fetch fire?" check with a centralised module
        // so agentic and tool_using both downgrade to partial_success on
        // identical conditions. Today the validator only inspects the web-
        // search policy; Phase 2 expands it to artifact/output policies.
        if (result.status === "success") {
          // Phase 1.12 — validator scope split. validateSuccessContract
          // is the HARD gate ("did you call the required tools?"). It
          // reads `task_spec_initial` so SR can't retroactively make a
          // task fail by tightening required_tool_names after the loop
          // already finished. The other two validators (step_gate,
          // answer_synthesis) read the LATEST spec because they're
          // forward / quality concerns, not retroactive correctness.
          const validationSpec = task.task_spec_initial ?? task.task_spec;
          const { satisfied, violations } = validateSuccessContract(validationSpec, result.transcript ?? []);
          if (!satisfied) {
            const reasons = violations.map((v) => v.message).join(" ");
            const warningNote = `\n\n注意：这次执行没有完全满足任务要求：${reasons}`;
            yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
            yield { event_type: "inline_result", payload: { text: (result.final_text || "任务没有生成最终答复。") + warningNote } };
            yield { event_type: "partial_success", payload: { text: (result.final_text || "任务没有生成最终答复。") + warningNote, violations } };
            return;
          }
        }

        // Truthfulness guard (UCA-181): if the final text claims a connector
        // write action was performed (email sent, event created, file
        // uploaded) but no corresponding tool actually returned success in
        // the transcript, downgrade to partial_success and prepend a
        // banner. Patterns live in success-contract-validator so agentic /
        // tool_using behave identically; the banner is at the TOP because
        // users were missing the suffix-style warning at the end of long
        // generated emails.
        const connectorClaimGuard = detectUnbackedConnectorClaim(result);
        if (result.status === "success" && connectorClaimGuard) {
          const banner = buildHallucinatedClaimBanner(connectorClaimGuard);
          const body = result.final_text || "任务没有生成最终答复。";
          const text = `${banner}\n\n---\n\n${body}`;
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text } };
          yield { event_type: "partial_success", payload: { text, violations: [connectorClaimGuard] } };
          return;
        }

        if (result.status === "success") {
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: result.final_text || "任务已完成，但没有生成可显示的答复。" } };
          yield { event_type: "success", payload: { text: result.final_text || "任务已完成，但没有生成可显示的答复。" } };
        } else if (result.status === "waiting_external_decision") {
          const text = result.final_text || "已创建待确认操作，等待你的确认。";
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text } };
          yield {
            event_type: "partial_success",
            payload: {
              text,
              sub_status: "waiting_external_decision",
              pendingApproval: result.approval ?? null,
              obligations: result.obligations ?? null
            }
          };
        } else if (result.status === "partial_success") {
          const text = result.final_text || result.error || "任务已停止，但没有完全满足成功条件。";
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text } };
          yield {
            event_type: "partial_success",
            payload: {
              text,
              phase_gate: result.phase_gate ?? null,
              error_budget: result.error_budget ?? null
            }
          };
        } else {
          const text = result.final_text || result.error || "这次执行没有生成可用结果。";
          yield { event_type: "inline_result", payload: { text } };
          yield { event_type: "failed", payload: { text } };
        }
      } catch (error) {
        yield { event_type: "failed", payload: { text: `执行器出错：${error.message}` } };
      }
    }
  };
}

function appendAuditLog(runtime, task, subtype, payload) {
  runtime.store.appendAuditLog({
    audit_id: `audit_${crypto.randomUUID()}`,
    ts: nowIso(),
    task_id: task.task_id,
    event_subtype: subtype,
    payload
  });
}

/**
 * P4-RQ C3 wrapper: runs the agent loop, then stamps an
 * `evidence_summary` (URL/domain coverage from web tool results) onto
 * the result for observability. Audit-only — never gates completion.
 * Existing return shape preserved; new field added alongside.
 */
export async function runToolAgentLoop(opts = {}) {
  const result = await _runToolAgentLoopCore(opts);
  return finaliseWithEvidence(result, opts);
}

function finaliseWithEvidence(result, { runtime, task } = {}) {
  if (!result || typeof result !== "object") return result;
  if (!Array.isArray(result.transcript)) return result;
  const evidence = extractEvidence(result.transcript);
  // Skip the audit/event noise when the loop did no web tool calls —
  // the typical "launch_app" flow has zero coverage to report.
  if (evidence.source_count === 0 && evidence.distinct_domain_count === 0) {
    return { ...result, evidence_summary: evidence };
  }
  try {
    appendAuditLog(runtime, task, "tool_loop.evidence_summary", evidence);
  } catch { /* audit failures must not break the loop return */ }
  try {
    runtime?.emitTaskEvent?.("evidence_summary", evidence);
  } catch { /* ditto */ }
  return { ...result, evidence_summary: evidence };
}

async function _runToolAgentLoopCore({
  task,
  runtime,
  maxIterations = 8,
  planner = null  // resolved below
}) {
  // UCA-077 P4-04.5: every executor must use the runtime singleton registry
  // so per-task rate-limit counters and any runtime-level tool registrations
  // (MCP, plugins) are visible. ensureRuntimeServices guarantees this is
  // populated; if a caller skipped it we surface the bug loudly rather than
  // silently constructing a divergent instance.
  if (!runtime.actionToolRegistry) {
    throw new Error("runtime.actionToolRegistry is missing — caller must invoke ensureRuntimeServices() first");
  }
  const registry = runtime.actionToolRegistry;
  const transcript = [];
  const seenCalls = new Set(); // dedupe identical tool+args to prevent infinite loops
  maxIterations = resolveTaskMaxIterations(task, maxIterations);

  // Phase 1.8 — `hasCompoundIntent` regex gate is gone. The planner
  // selection precedence is straightforward:
  //   1. explicit `planner` argument (createToolUsingExecutorScaffold
  //      passes llmPlanner explicitly for the production path)
  //   2. `runtime.toolPlanner` test override
  //   3. `defaultPlanner` (deterministic, single-tool — only used by
  //      callers that explicitly want it; the production
  //      tool_using path passes llmPlanner)
  const resolvedPlanner = planner
    ?? runtime.toolPlanner
    ?? defaultPlanner;

  // NOTE: workflow dispatch is owned by the LLM planner via the
  // connector_workflow_run tool — no regex short-circuit here. The LLM sees
  // available workflows in its system prompt (formatWorkflowsForPlanner) and
  // composes them with other tools (e.g. web_search_fetch → workflow) when
  // the user's request needs multi-step reasoning. See llmPlanner below.

  // 83.1 — Track prose-trap retries separately from the tool-call iteration
  // budget. Hard cap at 1: if the model returns prose again after the retry
  // hint, we accept that as genuinely final.
  let proseTrapAttemptsUsed = 0;
  const PROSE_TRAP_MAX_ATTEMPTS = 1;
  let synthesisRetriesUsed = 0;
  const MAX_SYNTHESIS_RETRIES = 2;

  // P4-EB wire-up: aggregate error budget for this task. Catches the
  // "tried 4 different tools, every one returned empty" pattern that
  // validateStepGate's same-tool-streak detector misses (it only counts
  // consecutive failures of the SAME tool from the tail). Overrides come
  // from task_spec.execution_constraints.error_budget when SemanticRouter
  // decides a task warrants more leniency; absent → safe defaults
  // (1 / 2 / 2 / 1) per error-budget.mjs §17.4.2.
  let errorBudget = createErrorBudget(
    task?.task_spec?.execution_constraints?.error_budget
  );
  const firedRunbooks = new Set();
  let contractActionGuidanceCount = 0;
  let terminalContractActionGuidanceCount = 0;
  const MAX_CONTRACT_ACTION_GUIDANCE = DEFAULT_PHASE_GATE_GUIDANCE_LIMITS.maxContractActionGuidance;
  const MAX_TERMINAL_CONTRACT_ACTION_GUIDANCE = DEFAULT_PHASE_GATE_GUIDANCE_LIMITS.maxTerminalContractActionGuidance;
  // Soft saturation nudge for multi_source / deep_research tasks. Fires
  // once per task — if the model heeds the hint and changes angle, no
  // further nudges; if it ignores, the existing research-quality
  // validator (D3) catches the coverage shortfall at finalize.
  let saturationHintFired = false;

  // UCA-077 P3-02: each loop iteration emits a `tool_planner_decision`
  // event so SSE consumers can render the planner timeline (which planner
  // ran, what it returned, why we accepted or skipped it). The event is
  // ephemeral — it never persists to the SQLite event log — and the
  // payload is intentionally compact (no full args / observations) to
  // keep the wire small.
  const plannerLabel = resolvedPlanner === defaultPlanner ? "default"
    : resolvedPlanner === llmPlanner ? "llm"
    : (resolvedPlanner.name || "custom");

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    // Filter tools at the loop level so EVERY planner (LLM, custom,
    // test) sees the same surface — including the scheduler-fire
    // recursion guard that hides create_scheduled_task /
    // delete_scheduled_task / pause_scheduled_task.
    const visibleTools = filterToolsForActionOnlyGuidance(
      filterToolsForTask(registry.list(), task),
      transcript
    );
    const visibleToolIds = new Set(visibleTools.map((tool) => tool.id));
    const decision = await resolvedPlanner({
      task,
      transcript,
      tools: visibleTools,
      iteration,
      runtime
    });
    runtime.emitTaskEvent?.("tool_planner_decision", {
      iteration,
      planner: plannerLabel,
      decision_type: decision?.type ?? "none",
      tool: decision?.type === "tool_call" ? decision.tool : null,
      reason: decision?.type === "tool_call"
        ? `planner=${plannerLabel} chose ${decision.tool}`
        : decision?.type === "final"
          ? `planner=${plannerLabel} returned final text`
          : `planner=${plannerLabel} returned no decision`
    });

    if (!decision || decision.type === "final") {
      // 83.1 — Prose-trap retry. The LLM replied with text but no tool_call.
      // If the user's command looked action-shaped and we haven't used our
      // retry budget, inject a synthetic turn that points out the missing
      // tool call and go around once more. On the next pass either the LLM
      // emits a real tool_calls array (original bug fixed) or it reaffirms
      // a prose final (the original reply was legitimately a question).
      const proseText = (decision?.text ?? "").trim();
      if (
        proseText &&
        proseTrapAttemptsUsed < PROSE_TRAP_MAX_ATTEMPTS &&
        shouldRetryProseTrap({ task, prose: proseText, transcript })
      ) {
        proseTrapAttemptsUsed += 1;
        transcript.push({
          type: "prose_trap_retry",
          assistantProse: proseText
        });
        runtime?.emitTaskEvent?.("prose_trap_retry", {
          reason: "prose_without_tool_call",
          attempt: proseTrapAttemptsUsed
        });
        continue;
      }
      const launchSequenceGuidance = buildLaunchSequenceGuidance(task, transcript);
      if (launchSequenceGuidance && iteration < maxIterations - 1) {
        transcript.push({
          type: "contract_guidance",
          groups: ["launch_app"],
          instruction: launchSequenceGuidance
        });
        runtime.emitTaskEvent?.("contract_action_handoff", {
          iteration,
          required_policy_groups: ["launch_app"],
          source: "launch_sequence"
        });
        appendAuditLog(runtime, task, "tool_loop.contract_action_handoff", {
          iteration,
          required_policy_groups: ["launch_app"],
          source: "launch_sequence"
        });
        continue;
      }
      let candidateFinal = decision?.text
        ?? finalFallbackText(transcript, task.user_command, task.task_spec)
        ?? "";
      if (hasActionAttempts(transcript)) {
        candidateFinal = finalFallbackText(transcript, task.user_command, task.task_spec, candidateFinal)
          ?? candidateFinal;
      }
      if (needsFinalComposer(task, transcript)) {
        candidateFinal = await composeFinalAnswer({
          task,
          transcript,
          runtime,
          reason: decision?.type === "final" ? "planner_final_after_tools" : "no_planner_decision"
        });
      }
      if (!candidateFinal) {
        candidateFinal = localFallbackFinal({ task, transcript, reason: "empty_final" });
      }
      const actionObligationSpec = task.task_spec ?? task.task_spec_initial;
      const actionObligations = evaluateActionObligations(actionObligationSpec, transcript, {
        finalText: candidateFinal,
        availableToolIds: registry.list().map((tool) => tool.id)
      });
      const waitingAction = findWaitingActionApproval(actionObligations)
        ?? findWaitingActionApprovalInTranscript(transcript);
      if (waitingAction) {
        return {
          status: "waiting_external_decision",
          final_text: formatWaitingActionFinal({ task, obligation: waitingAction }),
          approval: waitingAction.approval ?? null,
          obligations: actionObligations,
          transcript
        };
      }
      const pendingActionObligations = actionObligationsWithStatus(actionObligations, ["pending"]);
      if (pendingActionObligations.length > 0) {
        if (contractActionGuidanceCount < MAX_CONTRACT_ACTION_GUIDANCE && iteration < maxIterations - 1) {
          contractActionGuidanceCount += 1;
          const instruction = buildActionObligationGuidance(pendingActionObligations);
          transcript.push({
            type: "contract_guidance",
            groups: pendingActionObligations.map((obligation) => obligation.group),
            instruction
          });
          runtime.emitTaskEvent?.("contract_action_handoff", {
            iteration,
            required_policy_groups: pendingActionObligations.map((obligation) => obligation.group),
            source: "final_gate"
          });
          appendAuditLog(runtime, task, "tool_loop.contract_action_handoff", {
            iteration,
            required_policy_groups: pendingActionObligations.map((obligation) => obligation.group),
            source: "final_gate"
          });
          continue;
        }
        return {
          status: "partial_success",
          final_text: localFallbackFinal({
            task,
            transcript,
            reason: `required action obligations still pending: ${pendingActionObligations.map((obligation) => obligation.group).join(", ")}`
          }),
          transcript,
          obligations: actionObligations
        };
      }
      const terminalActionObligations = actionObligationsWithStatus(actionObligations, [
        "blocked_missing_input",
        "abandoned_with_reason"
      ]);
      if (terminalActionObligations.length > 0) {
        return {
          status: "partial_success",
          final_text: candidateFinal || localFallbackFinal({
            task,
            transcript,
            reason: terminalActionObligations.map((obligation) => `${obligation.group}: ${obligation.reason}`).join("; ")
          }),
          transcript,
          obligations: actionObligations
        };
      }
      if (hasUnresolvedActionFailure(transcript)) {
        return {
          status: "partial_success",
          final_text: candidateFinal,
          transcript,
          action_attempts: {
            unresolved_failure: true
          }
        };
      }
      // Phase 1.12 — synthesis bar uses the LATEST spec. SR's enrichment
      // for `expected_output` (summary / comparison / recommendation /
      // analysis / action_items) directly governs how the final answer
      // is shaped. Forward-only quality refinement: if SR landed in
      // time, the validator enforces the better target; if not, the
      // deterministic spec applies.
      const synthesisValidationSpec = task.task_spec ?? task.task_spec_initial;
      const synthesisViolations = validateAnswerSynthesis(synthesisValidationSpec, transcript, candidateFinal);
      if (synthesisViolations.length > 0
          && synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
        synthesisRetriesUsed += 1;
        transcript.push({
          type: "synthesis_retry",
          assistantDraft: candidateFinal,
          violations: synthesisViolations
        });
        runtime?.emitTaskEvent?.("synthesis_retry", {
          attempt: synthesisRetriesUsed,
          reason: synthesisViolations[0]?.kind
        });
        continue;
      }
      if (synthesisViolations.length > 0) {
        return {
          status: "partial_success",
          final_text: candidateFinal,
          transcript,
          synthesis_violations: synthesisViolations
        };
      }
      return {
        status: "success",
        final_text: candidateFinal,
        transcript
      };
    }

    if (decision?.type === "tool_call") {
      if (typeof decision.tool !== "string" || decision.tool.trim().length === 0) {
        if (synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
          synthesisRetriesUsed += 1;
          transcript.push({
            type: "synthesis_retry",
            violations: [{
              kind: "invalid_tool_call",
              message: "Planner emitted a tool call without a tool id; either call a valid tool or answer/ask for clarification in plain text."
            }]
          });
          runtime?.emitTaskEvent?.("synthesis_retry", {
            attempt: synthesisRetriesUsed,
            reason: "invalid_tool_call"
          });
          continue;
        }
        return {
          status: "partial_success",
          final_text: "我没能生成有效的工具调用。请换一种更明确的说法，或指出要操作的对象。",
          transcript
        };
      }
    }

    const scheduledFireGuard = decision?.type === "tool_call"
      ? planScheduledFireRegistryGuard({
          task,
          toolOrId: decision.tool,
          synthesisRetriesUsed,
          maxSynthesisRetries: MAX_SYNTHESIS_RETRIES
        })
      : null;
    if (scheduledFireGuard) {
      runtime.emitTaskEvent?.("tool_call_denied", scheduledFireGuard.deniedEventPayload);
      transcript.push(scheduledFireGuard.deniedTranscriptEntry);
      if (scheduledFireGuard.action === "retry") {
        synthesisRetriesUsed += 1;
        transcript.push(scheduledFireGuard.retryTranscriptEntry);
        continue;
      }
      return {
        status: "partial_success",
        final_text: scheduledFireGuard.finalText,
        transcript
      };
    }

    if (decision?.type === "tool_call" && !visibleToolIds.has(decision.tool)) {
      const sample = [...visibleToolIds].slice(0, 12).join(", ");
      const more = visibleToolIds.size > 12 ? `, … +${visibleToolIds.size - 12} more` : "";
      const hint = `Tool "${decision.tool}" is not available for this task. Pick one of the visible tools: ${sample}${more}.`;
      runtime.emitTaskEvent?.("tool_call_denied", {
        tool_id: decision.tool,
        reason: "tool_not_available_for_task"
      });
      transcript.push({
        type: "tool_denied",
        tool: decision.tool,
        reason: "tool_not_available_for_task"
      });
      if (synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
        synthesisRetriesUsed += 1;
        transcript.push({
          type: "synthesis_retry",
          violations: [{ kind: "tool_not_available_for_task", message: hint }]
        });
        runtime?.emitTaskEvent?.("synthesis_retry", {
          attempt: synthesisRetriesUsed,
          reason: "tool_not_available_for_task",
          tool_id: decision.tool
        });
        continue;
      }
      return {
        status: "partial_success",
        final_text: localFallbackFinal({ task, transcript, reason: hint }),
        transcript
      };
    }

    const actionOnlyAllowedTools = actionOnlyToolIds(transcript);
    if (actionOnlyAllowedTools.size > 0 && !actionOnlyAllowedTools.has(decision.tool)) {
      const allowed = [...actionOnlyAllowedTools];
      const sample = allowed.slice(0, 8).join(", ");
      const hint = `Action-only handoff is active; ${decision.tool} cannot satisfy the pending action obligation. Call one of: ${sample}.`;
      runtime.emitTaskEvent?.("tool_call_denied", {
        tool_id: decision.tool ?? null,
        reason: "action_only_obligation_handoff",
        allowed_tools: allowed
      });
      transcript.push({
        type: "tool_denied",
        tool: decision.tool ?? null,
        reason: "action_only_obligation_handoff"
      });
      if (synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
        synthesisRetriesUsed += 1;
        transcript.push({
          type: "synthesis_retry",
          violations: [{ kind: "action_only_obligation_handoff", message: hint }]
        });
        runtime?.emitTaskEvent?.("synthesis_retry", {
          attempt: synthesisRetriesUsed,
          reason: "action_only_obligation_handoff",
          tool_id: decision.tool ?? null
        });
        continue;
      }
      return {
        status: "partial_success",
        final_text: localFallbackFinal({ task, transcript, reason: hint }),
        transcript
      };
    }

    const tool = registry.get(decision.tool);
    if (!tool) {
      // Don't slam the task into the unclassified-internal-error path
      // ("发生未分类内部错误，错误详情：Unknown tool requested: call_tool").
      // Give the LLM one or two synthesis retries so it can re-emit
      // a real tool id; only then do we partial_success out with a
      // user-readable message.
      const availableIds = registry.list().map((t) => t.id);
      const sample = availableIds.slice(0, 12).join(", ");
      const more = availableIds.length > 12 ? `, … +${availableIds.length - 12} more` : "";
      const hint = `Tool "${decision.tool}" is not registered. Pick one of: ${sample}${more}. If you meant to wrap a real tool with the call_tool envelope, set arguments to {"tool":"<real id>","args":{...}}.`;
      runtime.emitTaskEvent?.("tool_call_denied", {
        tool_id: decision.tool ?? null,
        reason: "unknown_tool"
      });
      transcript.push({
        type: "tool_denied",
        tool: decision.tool ?? null,
        reason: "unknown_tool"
      });
      if (synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
        synthesisRetriesUsed += 1;
        transcript.push({
          type: "synthesis_retry",
          violations: [{ kind: "unknown_tool", message: hint }]
        });
        runtime?.emitTaskEvent?.("synthesis_retry", {
          attempt: synthesisRetriesUsed,
          reason: "unknown_tool",
          tool_id: decision.tool ?? null
        });
        continue;
      }
      return {
        status: "partial_success",
        final_text: `调用了未知工具 "${decision.tool}"。请重新发起，或换一种更明确的说法。`,
        transcript
      };
    }

    if (decision?.type === "tool_call") {
      decision.args = repairToolArgs(decision, task, transcript, tool);
      decision.args = applySideEffectContractToDecisionArgs({ decision, tool, task, runtime });
    }

    // Dedupe: if the planner repeats the same tool+args, ask it to
    // synthesize from what's already been observed instead of dumping
    // raw observations as the final answer.
    const callKey = `${decision.tool}::${JSON.stringify(decision.args ?? {})}`;
    if (seenCalls.has(callKey)) {
      if (synthesisRetriesUsed < MAX_SYNTHESIS_RETRIES) {
        synthesisRetriesUsed += 1;
        transcript.push({
          type: "synthesis_retry",
          violations: [{
            kind: "repeated_tool_call",
            message: `Planner repeated the same ${decision.tool} call; synthesize from prior observations instead.`
          }]
        });
        runtime?.emitTaskEvent?.("synthesis_retry", {
          attempt: synthesisRetriesUsed,
          reason: "repeated_tool_call"
        });
        continue;
      }
      return {
        status: "partial_success",
        final_text: await composeFinalAnswer({
          task,
          transcript,
          runtime,
          reason: "repeated_tool_call"
        }),
        transcript
      };
    }
    seenCalls.add(callKey);

    // UCA-181 follow-up: after a side-effect tool already succeeded in
    // this loop, refuse further calls to the SAME tool. Agents that
    // varied a single field (description ordering, attendee list) were
    // bypassing the args-based dedupe and double-firing real-world
    // side effects (4 duplicate calendar events in one task observed
    // in the wild). The action-obligation engine already says the
    // group is "satisfied" — push a synthesis hint and ask the
    // planner to finalize instead.
    const redundantSideEffect = planRedundantSideEffectGuard({
      tool,
      registry,
      transcript,
      synthesisRetriesUsed,
      maxSynthesisRetries: MAX_SYNTHESIS_RETRIES
    });
    if (redundantSideEffect) {
      if (redundantSideEffect.action === "retry") {
        synthesisRetriesUsed += 1;
        transcript.push(redundantSideEffect.transcriptEntry);
        runtime?.emitTaskEvent?.("synthesis_retry", redundantSideEffect.eventPayload);
        continue;
      }
      return {
        status: "partial_success",
        final_text: await composeFinalAnswer({
          task,
          transcript,
          runtime,
          reason: redundantSideEffect.reason
        }),
        transcript
      };
    }

    const validation = validateToolCall(tool, decision.args, runtime.toolContext ?? {});
    if (!validation.ok) {
      transcript.push({
        type: "validation_error",
        tool: tool.id,
        error: validation.error
      });
      // For LLM planner, continue the loop so the model can fix its arguments.
      // For keyword planner, give up — it can't self-correct.
      if (resolvedPlanner === defaultPlanner) {
        return {
          status: "failed",
          error: validation.error,
          transcript
        };
      }
      continue;
    }

    const risk = registry.evaluate(tool.id, decision.args, runtime.toolContext ?? {});
    const securityDecision = runtime.securityBroker?.authorizeToolCall(tool, decision.args) ?? {
      allowed: true,
      reason: null
    };
    runtime.emitTaskEvent?.("tool_call_proposed", {
      tool_id: tool.id,
      args: decision.args,
      risk
    });

    appendAuditLog(runtime, task, "tool.call", {
      tool_id: tool.id,
      args: decision.args,
      risk
    });

    if (!securityDecision.allowed) {
      runtime.emitTaskEvent?.("tool_call_denied", {
        tool_id: tool.id,
        reason: securityDecision.reason
      });
      appendAuditLog(runtime, task, "tool.denied", {
        tool_id: tool.id,
        reason: securityDecision.reason
      });
      transcript.push({
        type: "tool_denied",
        tool: tool.id,
        reason: securityDecision.reason
      });
      return {
        status: "partial_success",
        final_text: `Blocked tool ${tool.id}: ${securityDecision.reason}`,
        transcript
      };
    }

    // Unified confirmation gate (UCA-180):
    //   - If a synchronous `runtime.confirmationHandler` is registered
    //     (scheduler, MCP host, integration tests) it is the source of
    //     truth — call it and honour confirm / edit / deny.
    //   - Otherwise we have a real interactive user. Surface a
    //     pending_approval and suspend the task so the UI's inline
    //     approval card resolves it.
    //   - `unattended_safe` never shows UI; it skips the prompt and
    //     relies on the high-risk gate below to block dangerous calls.
    // The previous code had two parallel branches keyed on
    // execution_mode, which silently auto-confirmed in interactive
    // chat when no handler was registered (the email-send no-prompt
    // bug). Keep this single gate.
    if (risk.requires_confirmation) {
      if (typeof runtime.confirmationHandler === "function") {
        const interactiveDecision = await resolveInteractiveConfirmation({
          runtime,
          task,
          tool,
          args: decision.args,
          risk,
          appendAuditLog: (subtype, payload) => appendAuditLog(runtime, task, subtype, payload)
        });

        if (interactiveDecision.status === "deny") {
          runtime.emitTaskEvent?.("tool_call_denied", {
            tool_id: tool.id,
            reason: "user_denied"
          });
          transcript.push({
            type: "tool_denied",
            tool: tool.id
          });
          continue;
        }

        decision.args = interactiveDecision.args;
      } else if (task.execution_mode !== "unattended_safe") {
        const approval = createPendingToolApproval({
          runtime,
          task,
          tool,
          args: decision.args,
          risk
        });
        transcript.push({
          type: "pending_approval",
          approval_id: approval.approval_id,
          tool: tool.id
        });
        const actionObligations = evaluateActionObligations(
          task.task_spec ?? task.task_spec_initial,
          transcript
        );
        const waitingAction = findWaitingActionApproval(actionObligations)
          ?? findWaitingActionApprovalInTranscript(transcript)
          ?? {
            group: "action",
            status: "waiting_approval",
            tool: tool.id,
            approval
          };
        return {
          status: "waiting_external_decision",
          approval,
          final_text: formatWaitingActionFinal({ task, obligation: waitingAction }),
          obligations: actionObligations,
          transcript
        };
      }
    }

    if (shouldBlockHighRiskUnattended({ task, risk })) {
      runtime.emitTaskEvent?.("tool_call_denied", {
        tool_id: tool.id,
        reason: "high_risk_blocked_in_unattended_safe"
      });
      appendAuditLog(runtime, task, "tool.denied", {
        tool_id: tool.id,
        reason: "high_risk_blocked_in_unattended_safe"
      });
      transcript.push({
        type: "tool_denied",
        tool: tool.id,
        reason: "high_risk_blocked_in_unattended_safe"
      });
      return {
        status: "partial_success",
        final_text: `Blocked high-risk tool ${tool.id} in unattended mode.`,
        transcript
      };
    }

    const result = await registry.call(tool.id, decision.args, {
      ...(runtime.toolContext ?? {}),
      outputDir: runtime.toolOutputDir,
      runtime,
      task
    });

    runtime.emitTaskEvent?.("tool_call_completed", {
      tool_id: tool.id,
      success: result.success,
      observation: result.observation
    });
    // UCA-054: Record args and success so buildConversationMessages can inject
    // proper observations into the next LLM turn (ReAct pattern).
    // UCA-179: also record artifact_paths so a later send_email /
    // account_send_email / account_upload_file turn can pick them up as
    // absolute paths — otherwise the model drops the attachment because it
    // never saw a structural path, only prose in the observation.
    transcript.push({
      type: "tool_result",
      tool: tool.id,
      args: decision.args,
      success: result.success,
      observation: result.observation,
      metadata: result.metadata,
      artifact_paths: Array.isArray(result.artifact_paths) ? result.artifact_paths.filter(Boolean) : []
    });

    {
      const actionObligationSpec = task.task_spec ?? task.task_spec_initial;
      const actionObligations = evaluateActionObligations(actionObligationSpec, transcript);
      const waitingAction = findWaitingActionApproval(actionObligations)
        ?? findWaitingActionApprovalInTranscript(transcript);
      if (waitingAction) {
        return {
          status: "waiting_external_decision",
          final_text: formatWaitingActionFinal({ task, obligation: waitingAction }),
          approval: waitingAction.approval ?? null,
          obligations: actionObligations,
          transcript
        };
      }
    }

    {
      const launchSequenceGuidance = buildLaunchSequenceGuidance(task, transcript);
      if (launchSequenceGuidance && iteration < maxIterations - 1) {
        transcript.push({
          type: "contract_guidance",
          groups: ["launch_app"],
          instruction: launchSequenceGuidance
        });
        runtime.emitTaskEvent?.("contract_action_handoff", {
          iteration,
          required_policy_groups: ["launch_app"],
          source: "launch_sequence"
        });
        appendAuditLog(runtime, task, "tool_loop.contract_action_handoff", {
          iteration,
          required_policy_groups: ["launch_app"],
          source: "launch_sequence"
        });
        continue;
      }
    }

    if (!saturationHintFired && shouldCheckSaturation(task)) {
      const sat = detectSearchSaturation(transcript, 3);
      if (sat.saturated) {
        saturationHintFired = true;
        transcript.push({
          type: "saturation_hint",
          window_size: sat.window_size,
          repeated_domains: sat.repeated_domains
        });
        runtime.emitTaskEvent?.("saturation_hint", {
          iteration,
          window_size: sat.window_size,
          repeated_domains: sat.repeated_domains,
          baseline_domain_count: sat.baseline_domain_count
        });
        appendAuditLog(runtime, task, "tool_loop.saturation_hint", {
          iteration,
          window_size: sat.window_size,
          repeated_domains: sat.repeated_domains
        });
      }
    }

    // P4-EB wire-up: charge the aggregate error budget. Skip the
    // keyword planner — it short-circuits below after a single tool
    // call and has no looping pathology to catch. The budget exists to
    // detect LLM-driven loops that bounce between failing tools.
    //
    // Two kinds of event get charged here:
    //   - tool_failure         result.success === false
    //   - empty_search_result  external_web_read tool returned without
    //                          substance (failure cases already counted
    //                          as tool_failure above; this branch only
    //                          fires when result.success === true but
    //                          there's nothing usable in the observation)
    // replan_round and no_file_change_run charge from elsewhere
    // (route_reconsider hook + finalize gate respectively); not wired
    // here.
    const budgetCharge = chargeToolLoopErrorBudget({
      errorBudget,
      tool,
      result,
      isDefaultPlanner: resolvedPlanner === defaultPlanner
    });
    if (budgetCharge.event) {
      errorBudget = budgetCharge.nextBudget;
      appendAuditLog(
        runtime,
        task,
        "tool_loop.error_budget_charge",
        errorBudgetChargeAuditPayload({
          iteration,
          event: budgetCharge.event,
          charge: budgetCharge.charge
        })
      );
      if (budgetCharge.charge.exhausted) {
        runtime.emitTaskEvent?.("error_budget_signal", errorBudgetSignalPayload({
          iteration,
          event: budgetCharge.event,
          charge: budgetCharge.charge
        }));
        return {
          status: "partial_success",
          final_text: await composeFinalAnswer({
            task,
            transcript,
            runtime,
            reason: budgetCharge.charge.reason ?? "error_budget_exhausted"
          }),
          transcript,
          artifacts: result.artifact_paths ?? [],
          error_budget: errorBudgetResultPayload({
            iteration,
            event: budgetCharge.event,
            charge: budgetCharge.charge
          })
        };
      }
    }

    // P4-08 wire-up: per-step phase gate. After every tool_result, ask
    // the validator whether the loop is on track. Skip for the keyword
    // planner (which short-circuits below) — it doesn't have the
    // looping pathology this gate exists to catch.
    if (resolvedPlanner !== defaultPlanner) {
      // Phase 1.12 — step gate uses the LATEST spec. The gate decides
      // FORWARD: continue / retry / abort. If SR upgraded the policy
      // (e.g. research budget tightened, web access opened up), the
      // next iteration should respect that. The gate is forward-only
      // and never retroactively invalidates work already done.
      const stepGate = evaluatePhaseGate({
        task,
        transcript,
        iteration,
        maxIterations
      });
      // Emit SSE + audit so inspect-routing can render the gate decision
      // alongside tool_call events. Compact payload — no full violations
      // dump on the wire.
      runtime.emitTaskEvent?.("phase_gate_signal", phaseGateSignalPayload({ iteration, stepGate }));
      appendAuditLog(runtime, task, "tool_loop.phase_gate", phaseGateAuditPayload({ iteration, stepGate }));

      const actionHandoff = planContractActionHandoff({
        stepGate,
        transcript,
        iteration,
        maxIterations,
        contractActionGuidanceCount,
        terminalContractActionGuidanceCount,
        limits: {
          maxContractActionGuidance: MAX_CONTRACT_ACTION_GUIDANCE,
          maxTerminalContractActionGuidance: MAX_TERMINAL_CONTRACT_ACTION_GUIDANCE
        }
      });
      if (actionHandoff) {
        if (actionHandoff.incrementTerminal) {
          terminalContractActionGuidanceCount += 1;
        }
        if (actionHandoff.incrementNormal) {
          contractActionGuidanceCount += 1;
        }
        transcript.push(actionHandoff.transcriptEntry);
        runtime.emitTaskEvent?.("contract_action_handoff", actionHandoff.eventPayload);
        appendAuditLog(runtime, task, "tool_loop.contract_action_handoff", actionHandoff.eventPayload);
        continue;
      }

      // P4-RB suggestion: log which runbook would handle this signal.
      // Acting on the runbook (executing its steps) is a follow-up
      // commit; for now we just record the recommendation so production
      // traces show what the recovery path would have been.
      const runbookPlan = planRunbookGuidance({
        stepGate,
        firedRunbooks,
        iteration,
        maxIterations
      });
      const runbook = runbookPlan.runbook;
      if (runbook) {
        appendAuditLog(runtime, task, "tool_loop.runbook_suggested", {
          iteration,
          runbook_id: runbook.id,
          terminal_action: runbook.terminal_action,
          step_count: runbook.steps.length
        });
      }

      if (runbookPlan.transcriptEntry) {
        firedRunbooks.add(runbook.id);
        transcript.push(runbookPlan.transcriptEntry);
        runtime.emitTaskEvent?.("runbook_signal", runbookPlan.eventPayload);
        appendAuditLog(runtime, task, "tool_loop.runbook_executed", {
          iteration,
          runbook_id: runbook.id,
          action: "guidance_injected"
        });
        continue;
      }

      // Early termination: abort or escalate both stop the loop and
      // hand off to finalize. validateSuccessContract runs there and
      // produces the proper downgrade reason — same path as the
      // existing maxIterations-exhaustion finalize, just earlier.
      // retry / continue keep iterating.
      const phaseGateStop = buildPhaseGateStop({ stepGate, iteration, runbook });
      if (phaseGateStop) {
        return {
          status: "partial_success",
          final_text: await composeFinalAnswer({
            task,
            transcript,
            runtime,
            reason: phaseGateStop.reasonText
          }),
          transcript,
          artifacts: result.artifact_paths ?? [],
          phase_gate: phaseGateStop.phaseGate
        };
      }
    }

    // For the keyword planner, return after one tool call (it doesn't read history)
    if (resolvedPlanner === defaultPlanner) {
      const finalText = needsFinalComposer(task, transcript)
        ? await composeFinalAnswer({
            task,
            transcript,
            runtime,
            reason: "default_planner_tool_result"
          })
        : finalFallbackText(transcript, task.user_command, task.task_spec, result.observation)
          ?? localFallbackFinal({ task, transcript, reason: "default_planner_tool_result" });
      return {
        status: "success",
        final_text: finalText,
        transcript,
        artifacts: result.artifact_paths ?? []
      };
    }
    // For the LLM planner, continue the loop — it will see the result in transcript
    // and decide whether to call another tool or finish.
  }

  // Reached max iterations — synthesize whatever we have
  return {
    status: "success",
    final_text: await composeFinalAnswer({
      task,
      transcript,
      runtime,
      reason: "max_iterations_reached"
    }),
    transcript
  };
}
