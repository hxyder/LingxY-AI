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
import { formatUntrustedSourceMaterial } from "../shared/resource-context.mjs";
import { loadStructuredHistoryFor } from "../shared/conversation-history-loader.mjs";
import { getMcpActionTools } from "../../ai/mcp/client-bridge.mjs";
// H1: parity with tool_using — run the same SuccessContract validator
// and evidence normalizer at planner exit. Pre-H1 agentic skipped both,
// so D3 research_quality coverage and required_policy_groups were never
// enforced for agentic tasks.
import {
  validateSuccessContract,
  validateStepGate,
  validateAnswerSynthesis,
  detectUnbackedActionClaims
} from "../../core/policy/success-contract-validator.mjs";
import { extractEvidence, detectSearchSaturation } from "../../core/policy/evidence-normalizer.mjs";
// J1: per-iteration parity. Pre-J1 agentic ran for the full
// maxIterations even when the same tool failed repeatedly OR when the
// success contract was already known to be unreachable. tool_using
// charges an error budget after each tool result (max 2 tool failures /
// 1 empty external_web_read) and runs validateStepGate to catch
// same-tool failure streaks; agentic now does the same.
import { suggestRunbookForStepGate } from "../../core/runtime/runbook-engine.mjs";
import { createErrorBudget, chargeBudget, snapshotBudget } from "../../core/runtime/error-budget.mjs";
import { groupsOfTool } from "../../core/policy/policy-groups.mjs";
import {
  actionObligationsWithStatus,
  buildActionObligationGuidance,
  evaluateActionObligations,
  findWaitingActionApproval,
  findWaitingActionApprovalInTranscript,
  formatWaitingActionFinal
} from "../../core/policy/obligation-evaluator.mjs";

const DEFAULT_MAX_ITERATIONS = 8;

// Whitelist of tools whose argument streams are surfaced as
// `tool_input_delta` events for the live preview panel. Limiting the set
// keeps the SSE bus from carrying every partial JSON token (e.g. for
// arguments to search / lookup tools where a live preview is meaningless).
const FILE_GEN_TOOLS = new Set(["write_file", "generate_document", "edit_file"]);

function resolveTaskMaxIterations(task, fallback = DEFAULT_MAX_ITERATIONS) {
  const configured = task?.task_spec?.execution_constraints?.max_iterations;
  if (Number.isFinite(configured) && configured > 0) {
    // execution_constraints is an exact per-task budget, not merely an
    // upward override. This lets single_lookup cap a generic executor at 8
    // while multi/deep research can opt into 12/16.
    return Math.min(24, Math.max(1, Math.floor(configured)));
  }
  return fallback;
}

// Mirror of tool_using/agent-loop's shouldCheckSaturation: only fire the
// saturation hint for tasks that expect multiple independent sources.
function shouldCheckSaturation(task) {
  const profile = task?.task_spec?.research_quality?.profile;
  return profile === "multi_source_research" || profile === "deep_research";
}

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

/**
 * H1: translate the agentic planner's transcript shape
 * (`{role:"tool", name, success, observation, artifact_paths}`) into the
 * shape `validateSuccessContract` / `extractEvidence` expect
 * (`{type:"tool_result", tool, success, observation, artifact_paths}`).
 * tool_using already uses the validator shape natively; agentic kept
 * its own shape for adapter-replay compatibility, so the translation
 * lives at the validator seam rather than touching the planner's
 * internal state.
 */
function transcriptForValidator(plannerTranscript = []) {
  const out = [];
  for (const entry of plannerTranscript) {
    if (!entry || entry.role !== "tool") continue;
    out.push({
      type: "tool_result",
      tool: entry.name,
      success: entry.success,
      observation: entry.observation ?? "",
      // metadata is what evidence-normalizer reads (results[].url for
      // web_search_fetch, url for fetch_url_content); preserve it
      // through the translation.
      metadata: entry.metadata ?? {},
      artifact_paths: entry.artifact_paths ?? []
    });
  }
  return out;
}

/**
 * J1: locally-mirrored substance check from tool_using/agent-loop's
 * `toolResultHasSubstance`. Used by the per-iteration error budget to
 * decide whether an external_web_read success "actually returned
 * something" — a 200-OK call with empty results still consumes the
 * empty_search_result budget. Kept as a local copy (small, stable)
 * rather than refactoring tool_using's private helper into a shared
 * module; matches the H1 transcriptForValidator pattern of putting
 * cross-executor parity logic at each executor's seam.
 */
function agenticToolResultHasSubstance(result) {
  if (!result || typeof result !== "object") return false;
  if (Array.isArray(result.results) && result.results.length > 0) return true;
  if (Array.isArray(result.sources) && result.sources.length > 0) return true;
  if (typeof result.observation === "string" && result.observation.trim().length > 32) return true;
  if (Array.isArray(result.metadata?.results) && result.metadata.results.length > 0) return true;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim().length > 32) return true;
  }
  return false;
}

/**
 * J2: shared per-tool control helper used by BOTH the preflight call
 * (`taskNeedsCurrentWebData` web_search_fetch) and the main loop's
 * tool calls. Pre-J2 only the main loop ran the budget + step-gate
 * checks; the preflight transcript entry was completely outside the
 * controls. This meant a preflight that returned an empty external
 * search result OR a preflight failure was invisible to error-budget /
 * phase-gate, so the planner kept iterating with one strike already on
 * the wall but no metadata to act on. tool_using has no preflight, so
 * its J1 wiring caught everything; agentic was the asymmetric case.
 *
 * Returns:
 *   { errorBudget: <updated state>, earlyExit: null | { kind, error_budget?, phase_gate? } }
 *
 * Caller is responsible for breaking out of its loop when earlyExit
 * is non-null. The same earlyExitState shape is reused so the
 * post-loop validator block produces a single consistent diagnostic
 * surface regardless of which code path detected the early exit.
 *
 * @param {{
 *   call:          { name: string },
 *   result:        { success: boolean, observation?: string, metadata?: object },
 *   transcript:    object[],   // already includes the just-pushed entry for `call`
 *   errorBudget:   object,
 *   iteration:     number,
 *   maxIterations: number,
 *   taskSpec:      object | undefined,
 *   onEvent:       function | undefined,
 *   preflight:     boolean     // set true for the preflight call site
 * }} ctx
 */
function processAgenticToolResultForControls(ctx) {
  const { call, result, transcript, iteration, maxIterations, taskSpec, onEvent, preflight } = ctx;
  let errorBudget = ctx.errorBudget;

  // 1. Charge error budget. tool_failure for outright failures;
  //    empty_search_result when the call is in the external_web_read
  //    group AND the success result has no substance. Same predicates
  //    as tool_using/agent-loop:1226-1230.
  let budgetEvent = null;
  if (result.success === false) {
    budgetEvent = "tool_failure";
  } else if (groupsOfTool(call.name).includes("external_web_read")
      && !agenticToolResultHasSubstance(result)) {
    budgetEvent = "empty_search_result";
  }
  if (budgetEvent) {
    const charge = chargeBudget(errorBudget, budgetEvent);
    errorBudget = charge.state;
    onEvent?.({
      event_type: "log",
      payload: {
        message: `error_budget_charge ${budgetEvent} (exhausted=${charge.exhausted}${preflight ? ", preflight" : ""})`
      }
    });
    if (charge.exhausted) {
      // Parity with tool_using/agent-loop:1242-1247 — emit a separate
      // observability event so SSE consumers can render "budget burned"
      // distinctly from a phase_gate decision.
      onEvent?.({
        event_type: "error_budget_signal",
        payload: {
          iteration,
          preflight: Boolean(preflight),
          event: budgetEvent,
          reason: charge.reason,
          snapshot: snapshotBudget(errorBudget)
        }
      });
      return {
        errorBudget,
        earlyExit: {
          kind: "error_budget_exhausted",
          error_budget: {
            event: budgetEvent,
            reason: charge.reason,
            iteration,
            preflight: Boolean(preflight),
            snapshot: snapshotBudget(errorBudget)
          }
        }
      };
    }
  }

  // 2. Phase gate. Walks the validator-shape transcript and decides
  //    continue / retry / escalate / abort. Always runs (regardless of
  //    budgetEvent) so a preflight that returned substance still gets
  //    its same-tool-streak / contract-unreachable signal recorded.
  const validatorTx = transcriptForValidator(transcript);
  const stepGate = validateStepGate(taskSpec, validatorTx, {
    iteration,
    maxIterations
  });
  const runbook = suggestRunbookForStepGate(stepGate);
  onEvent?.({
    event_type: "phase_gate_signal",
    payload: {
      iteration,
      preflight: Boolean(preflight),
      next_action: stepGate.next_action,
      satisfied: stepGate.satisfied,
      violation_kinds: (stepGate.violations ?? []).map((v) => v.kind),
      runbook_suggested: runbook?.id ?? null
    }
  });
  if (stepGate.next_action === "abort" || stepGate.next_action === "escalate") {
    return {
      errorBudget,
      earlyExit: {
        kind: `phase_gate_${stepGate.next_action}`,
        phase_gate: {
          next_action: stepGate.next_action,
          iteration,
          preflight: Boolean(preflight),
          violations: stepGate.violations ?? [],
          runbook_suggested: runbook?.id ?? null
        }
      }
    };
  }

  return { errorBudget, earlyExit: null };
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

  const filePaths = task.context_packet?.file_paths ?? [];
  if (filePaths.length > 0) {
    parts.push("");
    parts.push(`Attached files:\n${filePaths.join("\n")}`);
  }
  // P4-00.5 trust split: ctx.text and ctx.url come from third-party pages
  // / selections and may carry prompt-injection payloads. Wrap them in
  // <untrusted_source> with a guard sentence so the LLM treats them as
  // data, not policy. Block placement is the user role (this function's
  // return) — never the system prompt.
  const untrusted = formatUntrustedSourceMaterial(task);
  if (untrusted) {
    parts.push("");
    parts.push(untrusted);
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
// UCA-181 follow-up: tools that mutate the schedule registry. Inside a
// real scheduler fire, these MUST NOT run — calling create_scheduled_task
// from the firing of a previous schedule produces an infinite-loop of
// clones. tool_using/agent-loop has the same set; keep them aligned.
const SCHEDULE_REGISTRY_TOOL_IDS = new Set([
  "create_scheduled_task",
  "delete_scheduled_task",
  "pause_scheduled_task"
]);

function isScheduledFireTask(task) {
  return task?.context_packet?.selection_metadata?.scheduled_task_fire === true;
}

function isScheduleRegistryTool(tool) {
  const id = typeof tool === "string" ? tool : tool?.id;
  const mcpToolName = typeof tool === "object" ? tool?._mcpToolName : null;
  return SCHEDULE_REGISTRY_TOOL_IDS.has(id) || SCHEDULE_REGISTRY_TOOL_IDS.has(mcpToolName);
}

// Tools whose success has irreversible side-effects (email send,
// calendar create, file upload, schedule create). Once one has
// succeeded in this run, refuse re-fires that vary args slightly to
// dodge the args-based dedupe (the wild 4-event repro).
const SIDE_EFFECT_OBLIGATION_GROUPS = new Set([
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
]);

function isSideEffectTool(tool) {
  if (!tool) return false;
  const groupSet = new Set(groupsOfTool(tool.id));
  if (typeof tool.policy_group === "string") groupSet.add(tool.policy_group);
  if (Array.isArray(tool.policy_groups)) {
    for (const group of tool.policy_groups) {
      if (typeof group === "string") groupSet.add(group);
    }
  }
  for (const g of groupSet) {
    if (SIDE_EFFECT_OBLIGATION_GROUPS.has(g)) return true;
  }
  return tool.risk_level === "high" || tool.requires_confirmation === true;
}

function transcriptHasSuccessfulToolCall(transcript = [], toolId) {
  if (!toolId) return false;
  return (transcript ?? []).some((entry) =>
    entry?.role === "tool"
    && entry.name === toolId
    && entry.success === true
  );
}

async function executeToolCall({ registry, mcpToolById, toolContext, call, runtime, task, transcript = [] }) {
  const tool = registry?.get?.(call.name) ?? mcpToolById?.get?.(call.name);
  if (!tool) {
    return {
      success: false,
      observation: `Tool ${call.name} is not registered.`,
      metadata: { tool_id: call.name }
    };
  }

  // UCA-181 follow-up: defense-in-depth recursion guard. Even when the
  // prompt's tool list omits schedule-registry tools (filtered upstream
  // for scheduled_task_fire context), the LLM occasionally hallucinates
  // a familiar id. Refuse fast — BEFORE the confirmation gate — so the
  // user does not see a pointless approval popup for a call that would
  // have been refused anyway by the tool's own UCA-096 guard.
  if (isScheduleRegistryTool(tool) && isScheduledFireTask(task)) {
    return {
      success: false,
      observation: `${tool.id} is unavailable inside a scheduled task fire — execute the action directly (notify / send_email / etc.) instead of creating another schedule.`,
      metadata: {
        tool_id: tool.id,
        reason: "scheduled_fire_cannot_modify_schedule_registry"
      }
    };
  }

  // UCA-181 follow-up: redundant side-effect block. After a side-effect
  // tool already succeeded in this run, refuse further calls to the
  // SAME tool. Agents that varied a single field (description ordering,
  // attendee list) were bypassing args-based dedupe and double-firing
  // real-world side effects.
  if (isSideEffectTool(tool) && transcriptHasSuccessfulToolCall(transcript, tool.id)) {
    return {
      success: false,
      observation: `${tool.id} already succeeded earlier in this run; do not re-fire side-effect tools — finalize from the existing result.`,
      metadata: {
        tool_id: tool.id,
        reason: "redundant_side_effect_call"
      }
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
    mcpTools = await getMcpActionTools(mcpRegistry);
  } catch { /* MCP unavailable — continue without it */ }
  if (insideScheduledFire) {
    mcpTools = mcpTools.filter((tool) => !isScheduleRegistryTool(tool));
  }

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
  const MAX_CONTRACT_ACTION_GUIDANCE = 2;
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
      task,
      transcript
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
        taskSpec: task?.task_spec,
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

  const userContent = [buildUserMessage(task), preflightSearchText].filter(Boolean).join("\n\n---\n\n");
  const modelContextWindow = provider?.model?.context_window
    ?? provider?.model?.context_length
    ?? provider?.context_window
    ?? 200000;
  const historyResult = runtime
    ? loadStructuredHistoryFor({ runtime, task, executor: "agentic", modelContextWindow })
    : { mode: "legacy_fallback", historyMessages: [], currentMessageRendered: null };

  const messages = [{ role: "system", content: systemPrompt }];
  if (historyResult.mode === "structured" && historyResult.currentMessageRendered) {
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
    messages.push({
      role: "user",
      content: `[Action obligations]\n${buildActionObligationGuidance(initialPendingActionObligations)}`
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
        onReasoningDelta: (adapter.supportsStreaming && onEvent)
          ? (delta) => {
              if (!delta) return;
              onEvent({ event_type: "reasoning_delta", payload: { delta } });
            }
          : undefined,
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
        task,
        transcript
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
        taskSpec: task?.task_spec,
        onEvent,
        preflight: false
      });
      errorBudget = ctrl.errorBudget;
      if (ctrl.earlyExit) {
        earlyExitState = ctrl.earlyExit;
        break;
      }

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
      const text = synthesis?.text ?? "";
      if (text && text.trim()) finalText = text;
    } catch (error) {
      onEvent?.({
        event_type: "log",
        payload: { message: `Final synthesis failed: ${error.message}` }
      });
    }
  }

  // Truthfulness guard (UCA-049 §B + UCA-181): the original `anyToolSucceeded`
  // form was too loose — a successful web_search would mask a fabricated
  // "邮件已发送" because *some* tool succeeded. We now also run
  // `detectUnbackedActionClaims`, which ties the claim verb (sent /
  // created / uploaded) to the policy group's actual success tools. If
  // either guard fires, prepend a banner so the user sees the
  // correction before the body.
  let downgraded = false;
  let violations = null;
  const validatorTranscript = transcriptForValidator(transcript);
  const actionObligationTerminal = earlyExitState?.kind === "action_obligation_terminal"
    ? earlyExitState.obligations
    : null;
  const waitingObligation = earlyExitState?.kind === "waiting_external_decision"
    ? earlyExitState.obligation
    : findWaitingActionApprovalInTranscript(validatorTranscript);
  const waitingExternalDecision = Boolean(waitingObligation);
  if (waitingExternalDecision) {
    finalText = formatWaitingActionFinal({ task, obligation: waitingObligation });
  }
  if (actionObligationTerminal?.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(actionObligationTerminal.map((obligation) => ({
      kind: `${obligation.group}_${obligation.status}`,
      message: `Required action obligation ${obligation.group} ended as ${obligation.status}: ${obligation.reason ?? ""}`.trim()
    })));
  }

  if (!waitingExternalDecision && finalText && claimsCompletion(finalText) && !anyToolSucceeded(transcript)) {
    downgraded = true;
    finalText = `⚠️ The model claimed the task was completed, but no tool in this run returned success. The claim has been downgraded to "partial". See the transcript for what actually happened.\n\n---\n\n${finalText}`;
  }
  const actionClaimViolations = waitingExternalDecision
    ? []
    : detectUnbackedActionClaims(validatorTranscript, finalText);
  if (actionClaimViolations.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(actionClaimViolations);
    const banners = actionClaimViolations.map((v) => {
      const group = v.kind.replace(/_claim_unsupported$/, "");
      if (group === "email_send") {
        return "⚠️ 邮件实际并未发送。系统未检测到任何成功的邮件发送工具调用，下面的文字是模型自述。";
      }
      if (group === "calendar_create") {
        return "⚠️ 日程/事件实际并未创建。下面的文字仅为模型自述。";
      }
      if (group === "file_upload") {
        return "⚠️ 文件实际并未上传。下面的文字仅为模型自述。";
      }
      return "⚠️ 模型声称完成了一项操作，但系统未检测到对应工具的成功调用。下面的文字是模型自述。";
    });
    finalText = `${banners.join("\n")}\n\n---\n\n${finalText || ""}`;
  }

  // H1: SuccessContract enforcement (parity with tool_using's
  // validateSuccessContract call). Walks the transcript and checks every
  // entry on `task_spec.success_contract.required_policy_groups`, plus
  // research_quality coverage thresholds (D3). If unsatisfied, downgrade
  // — independent from the truthfulness guard above; both can fire and
  // both messages are surfaced.
  const contract = (waitingExternalDecision || actionObligationTerminal?.length > 0)
    ? { satisfied: true, violations: [] }
    : validateSuccessContract(task?.task_spec, validatorTranscript);
  if (!contract.satisfied) {
    downgraded = true;
    violations = (violations ?? []).concat(contract.violations);
    const reasons = contract.violations.map((v) => v.message).join(" ");
    finalText = `[UCA] 注意：未通过 SuccessContract 校验：${reasons}\n\n${finalText || ""}`;
  }

  // PT2: post-tool synthesis check. When expected_output is a synthesis
  // kind (summary/comparison/recommendation/analysis/action_items) and
  // the final text is a raw dump or missing the expected shape, mark
  // the task as not synthesised and surface the violation alongside the
  // contract message. The agentic loop has already exited; we don't
  // retry here (the upstream user can re-prompt). The transcript-retry
  // shape used by tool_using is not symmetrical to agentic, which uses
  // a single LLM finalize step — so for agentic the v1 behaviour is
  // "downgrade + visible reason", not "regenerate".
  const synthesisViolations = waitingExternalDecision
    ? []
    : validateAnswerSynthesis(
      task?.task_spec,
      validatorTranscript,
      finalText
    );
  if (synthesisViolations.length > 0) {
    downgraded = true;
    violations = (violations ?? []).concat(synthesisViolations);
    const reason = synthesisViolations[0].message;
    finalText = `[UCA] 注意：${reason}\n\n${finalText || ""}`;
  }

  // H1: evidence_summary stamp for observability — same as tool_using's
  // finaliseWithEvidence. Audit-only.
  const evidenceSummary = extractEvidence(validatorTranscript);

  // J1: surface per-iteration early-exit diagnostics. When the planner
  // broke out of the loop on a budget/gate signal, downgrade and prepend
  // an explanation; the validator above may have already flagged the
  // same task (no successful web tool, etc.), and that's fine — both
  // messages stack and tell the user what happened.
  let phaseGate = null;
  let errorBudgetDiag = null;
  if (earlyExitState
      && earlyExitState.kind !== "waiting_external_decision"
      && earlyExitState.kind !== "action_obligation_terminal") {
    downgraded = true;
    if (earlyExitState.kind === "error_budget_exhausted") {
      errorBudgetDiag = earlyExitState.error_budget;
      finalText = `[UCA] 阶段提前结束：error_budget exhausted (${errorBudgetDiag.event} at iteration ${errorBudgetDiag.iteration}). ${errorBudgetDiag.reason}\n\n${finalText || ""}`;
    } else if (earlyExitState.kind === "phase_gate_abort"
        || earlyExitState.kind === "phase_gate_escalate") {
      phaseGate = earlyExitState.phase_gate;
      const kindLabel = phaseGate.next_action;
      const violationKinds = (phaseGate.violations ?? []).map((v) => v.kind).join(", ") || "(none)";
      const runbookHint = phaseGate.runbook_suggested
        ? ` Runbook recommended: ${phaseGate.runbook_suggested}.`
        : "";
      finalText = `[UCA] 阶段提前结束：phase_gate ${kindLabel} at iteration ${phaseGate.iteration} (violations: ${violationKinds}).${runbookHint}\n\n${finalText || ""}`;
    }
  }

  return {
    success: !waitingExternalDecision && !downgraded && Boolean(finalText),
    finalText: finalText || "(no response from agentic planner)",
    toolCalls: transcript.filter((entry) => entry.role === "tool"),
    artifactPaths,
    provider_descriptor: descriptor,
    iterations: iterations + 1,
    downgraded,
    waiting_external_decision: waitingExternalDecision,
    pendingApproval: waitingObligation?.approval ?? null,
    obligations: waitingObligation ? [waitingObligation] : null,
    violations,
    evidence_summary: evidenceSummary,
    phase_gate: phaseGate,
    error_budget: errorBudgetDiag
  };
}
