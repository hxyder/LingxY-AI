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
import { SYNTHESIS_REQUIRED_OUTPUTS } from "../../core/intent/semantic-router.mjs";
import {
  formatResourceContext,
  formatUntrustedSourceMaterial,
  extractAbsoluteLocalPathsFromText
} from "../shared/resource-context.mjs";
import { renderBackgroundContextsBlock } from "../../core/intent/background-contexts.mjs";
import { renderToolPolicyForPrompt } from "../../core/policy/policy-groups.mjs";
import { renderResearchPrinciples, renderResearchBudget } from "../shared/research-principles.mjs";
import { extractEvidence } from "../../core/policy/evidence-normalizer.mjs";
import { validateSuccessContract, validateStepGate } from "../../core/policy/success-contract-validator.mjs";
import { suggestRunbookForStepGate } from "../../core/runtime/runbook-engine.mjs";
import { createErrorBudget, chargeBudget, snapshotBudget } from "../../core/runtime/error-budget.mjs";
import { groupsOfTool } from "../../core/policy/policy-groups.mjs";
// UCA-077 P3-01: deterministic / connector planners + their helpers moved
// into a `planners/` directory so this file owns the loop and provider
// glue, not regex tables. defaultPlanner / repairToolArgs still live here
// because they touch runtime state.
import { planDeterministicToolCall } from "./planners/deterministic.mjs";
import { planConnectorToolCall } from "./planners/connector.mjs";
import {
  extractLaunchAppName,
  extractLaunchAppCandidates,
  normalizeLaunchAppArg,
  normalizeLaunchAppKey
} from "./planners/launch-helpers.mjs";

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

/**
 * Render the connector catalog's workflows as a concise hint block for the
 * LLM planner's system prompt. The LLM owns when to call
 * connector_workflow_run and how to sequence it with other tools — this block
 * just tells it which workflows exist, what triggers them, and what inputs
 * they need so it doesn't have to guess.
 */
function formatWorkflowsForPlanner(catalog) {
  if (!catalog || typeof catalog.listWorkflows !== "function") return "";
  const summaries = catalog.listWorkflows();
  if (!summaries.length) return "";
  const lines = ["", "Connector workflows (call via connector_workflow_run):"];
  for (const summary of summaries) {
    const full = catalog.getWorkflow?.(summary.id) ?? summary;
    const firstToolId = full.steps?.find((step) => step?.tool)?.tool;
    const firstTool = firstToolId ? catalog.getTool?.(firstToolId) : null;
    const required = firstTool?.inputSchema?.required ?? [];
    const triggers = (full.triggerPatterns ?? []).slice(0, 5).join(" | ");
    lines.push(`- ${full.id} — ${full.description ?? full.name ?? ""}`);
    if (triggers) lines.push(`    trigger hints: ${triggers}`);
    if (required.length) lines.push(`    required input: { ${required.join(", ")} }`);
  }
  lines.push("");
  lines.push("When a user asks to send mail / create calendar event / upload Drive file, prefer a workflow call with a fully-filled input. If you need data to fill the input (e.g. weather forecast, search results, current context), chain the relevant read/search tool FIRST, then call connector_workflow_run with all required fields populated. Never call connector_workflow_run with empty subject/body — the workflow validator will reject it.");
  return lines.join("\n");
}

// UCA-077 P1-06: isSearchOrNewsRequest was the parallel regex gate that
// short-circuited web_search_fetch before the LLM planner ran. Its concerns
// have been split:
//   - The "search verb" half lives in core/intent/signals/explicit-search.mjs
//   - The "weak time marker" half lives in core/intent/signals/weak-freshness.mjs
//   - The actual decision (forbidden/optional/required) is owned by
//     core/policy/tool-policy-resolver.mjs and surfaces as
//     task.task_spec.tool_policy.web_search_fetch.mode.
// Callers in this file now read the resolved policy instead of re-deriving.

function inferSearchRecencyFromText(value = "") {
  const text = String(value ?? "").toLowerCase();
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "day";
  if (/(本周|一周|近\s*7\s*天|week)/i.test(text)) return "week";
  if (/(本月|一个月|近\s*30\s*天|month)/i.test(text)) return "month";
  if (/(今年|一年|近\s*12\s*个月|year)/i.test(text)) return "year";
  if (/(今天|今日|时政|要闻|最新|最近|新闻|消息|近况|latest|recent|current|news)/i.test(text)) return "month";
  return null;
}

// UCA-077 P3-01: launch-app helpers moved to ./planners/launch-helpers.mjs.

function repairSchemaArgAliases(args = {}, tool = null) {
  const repaired = { ...(args ?? {}) };
  const properties = tool?.parameters?.properties && typeof tool.parameters.properties === "object"
    ? tool.parameters.properties
    : {};
  if (!("query" in repaired) && "query" in properties && typeof repaired.q === "string") {
    repaired.query = repaired.q;
    delete repaired.q;
  }
  const propertyKeys = Object.keys(properties);
  const providedKeys = Object.keys(repaired);
  if (propertyKeys.length === 1 && providedKeys.length === 1 && !(providedKeys[0] in properties)) {
    repaired[propertyKeys[0]] = repaired[providedKeys[0]];
    delete repaired[providedKeys[0]];
  }
  return repaired;
}

function repairToolArgs(decision, task, transcript = [], tool = null) {
  if (!decision) return {};
  if (decision.tool !== "launch_app") return repairSchemaArgAliases(decision.args ?? {}, tool);
  const args = { ...(decision.args ?? {}) };
  const explicit = normalizeLaunchAppArg(args.app ?? args.name ?? args.appName);
  if (explicit) {
    args.app = explicit;
    delete args.name;
    delete args.appName;
    return repairSchemaArgAliases(args, tool);
  }

  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  if (candidates.length === 0) return repairSchemaArgAliases(args, tool);

  const alreadyUsed = new Set(
    transcript
      .filter((entry) => entry?.type === "tool_result" && entry.tool === "launch_app")
      .map((entry) => normalizeLaunchAppKey(entry.args?.app))
      .filter(Boolean)
  );
  const next = candidates.find((candidate) => !alreadyUsed.has(normalizeLaunchAppKey(candidate)))
    ?? candidates[0];
  args.app = next;
  delete args.name;
  delete args.appName;
  return repairSchemaArgAliases(args, tool);
}

// UCA-077 P3-01: extractUrl moved to ./planners/launch-helpers.mjs.

function buildHistoryString(transcript) {
  if (!transcript || transcript.length === 0) return "(no actions taken yet)";
  return transcript.map((entry, i) => {
    if (entry.type === "tool_result") {
      return `[step ${i + 1}] called ${entry.tool} → ${entry.observation ?? "(no observation)"}`;
    }
    if (entry.type === "tool_denied") {
      return `[step ${i + 1}] denied ${entry.tool}: ${entry.reason ?? ""}`;
    }
    if (entry.type === "validation_error") {
      return `[step ${i + 1}] validation error on ${entry.tool}: ${entry.error ?? ""}`;
    }
    return `[step ${i + 1}] ${entry.type}`;
  }).join("\n");
}

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value ?? ""));
}

function plannerToolDescriptorForAdapter() {
  return {
    name: "call_tool",
    description: "Call one available execution tool by id. Choose the tool id from Available execution tools and pass its arguments as an object.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["tool", "args"],
      properties: {
        tool: { type: "string", description: "Exact tool id to call." },
        args: { type: "object", description: "Arguments for the selected tool.", additionalProperties: true }
      }
    }
  };
}

function summarizeToolParameters(schema = {}) {
  const properties = schema?.properties && typeof schema.properties === "object"
    ? schema.properties
    : {};
  const entries = Object.entries(properties).slice(0, 10).map(([key, descriptor = {}]) => {
    const type = descriptor.type ?? (descriptor.enum ? "enum" : "any");
    const values = Array.isArray(descriptor.enum) && descriptor.enum.length > 0
      ? `:${descriptor.enum.slice(0, 8).join("|")}`
      : "";
    return `${key}:${type}${values}`;
  });
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
}

function formatToolDescription(tool = {}) {
  const base = String(tool.description ?? tool.name ?? "").trim();
  const metadata = [];
  metadata.push(`args=${summarizeToolParameters(tool.parameters)}`);
  if (tool.policy_group) metadata.push(`group=${tool.policy_group}`);
  if (tool.risk_level) metadata.push(`risk=${tool.risk_level}`);
  if (tool.requires_confirmation === true) metadata.push("confirmation=required");
  if (Array.isArray(tool.required_capabilities) && tool.required_capabilities.length > 0) {
    metadata.push(`capabilities=${tool.required_capabilities.join(",")}`);
  }
  return `${base} [${metadata.join("; ")}]`.trim();
}

function formatToolForPlanner(tool = {}) {
  return `- ${tool.id}: ${formatToolDescription(tool)}`;
}

function formatAccountLabel(account = {}, fallback = {}) {
  const provider = account.provider ?? fallback.provider ?? "connector";
  const email = account.email || fallback.accountId || "";
  const display = account.displayName ? ` (${account.displayName})` : "";
  return `${provider}${email ? ` ${email}` : ""}${display}`.trim();
}

function formatConnectorFinal(entry, userCommand = "") {
  const metadata = entry?.metadata ?? {};
  const zh = hasCjk(userCommand);

  if (entry?.tool === "account_list_connected_accounts") {
    const accounts = metadata.accounts ?? [];
    if (accounts.length === 0) return zh ? "我查了一下，目前没有已连接的 Google/Microsoft 账户。" : "No connected Google/Microsoft accounts were found.";
    const lines = accounts.map((account, index) => {
      const caps = Object.entries(account.capabilities ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(", ") || "none";
      return zh
        ? `${index + 1}. ${formatAccountLabel(account)}，状态 ${account.tokenStatus}，能力：${caps}`
        : `${index + 1}. ${formatAccountLabel(account)}; status=${account.tokenStatus}; capabilities=${caps}`;
    });
    return zh
      ? `我查到当前已连接账户：\n${lines.join("\n")}`
      : `Connected accounts:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_emails") {
    const emails = metadata.emails ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (emails.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到邮件。` : `No emails were found in ${formatAccountLabel(account)}.`;
    const lines = emails.map((email, index) => {
      const sender = email.fromName ? `${email.fromName} <${email.from ?? ""}>` : (email.from ?? "unknown sender");
      return `${index + 1}. ${email.received ?? "unknown date"} | ${sender} | ${email.subject ?? "(no subject)"}`;
    });
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${emails.length} 封邮件：\n${lines.join("\n")}`
      : `I found ${emails.length} emails in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_files") {
    const files = metadata.files ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (files.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到云端文件。` : `No cloud files were found in ${formatAccountLabel(account)}.`;
    const lines = files.map((file, index) => `${index + 1}. ${file.name ?? "(untitled)"} | modified ${file.modified ?? "unknown"}${file.url ? ` | ${file.url}` : ""}`);
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${files.length} 个云端文件：\n${lines.join("\n")}`
      : `I found ${files.length} cloud files in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  if (entry?.tool === "account_list_events") {
    const events = metadata.events ?? [];
    const account = metadata.account ?? { provider: metadata.provider, accountId: metadata.accountId };
    if (events.length === 0) return zh ? `我查看了 ${formatAccountLabel(account)}，没有找到日历事件。` : `No calendar events were found in ${formatAccountLabel(account)}.`;
    const lines = events.map((event, index) => `${index + 1}. ${event.start ?? "unknown time"} | ${event.title ?? "(untitled)"}${event.location ? ` | ${event.location}` : ""}`);
    return zh
      ? `我从 ${formatAccountLabel(account)} 查到 ${events.length} 个日历事件：\n${lines.join("\n")}`
      : `I found ${events.length} calendar events in ${formatAccountLabel(account)}:\n${lines.join("\n")}`;
  }

  return null;
}

function allowsRawConnectorFinal(taskSpec) {
  return taskSpec?.synthesis?.expected_output === "raw_results";
}

function connectorFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const rawAllowed = allowsRawConnectorFinal(taskSpec);
  const entry = [...(transcript ?? [])].reverse().find((item) =>
    item.type === "tool_result"
    && item.success === true
    && ["account_list_connected_accounts", "account_list_emails", "account_list_files", "account_list_events"].includes(item.tool)
  );
  if (!entry) return fallbackText;
  if (rawAllowed) return formatConnectorFinal(entry, userCommand);
  const expected = taskSpec?.synthesis?.expected_output;
  const needsSynthesis = expected === null
    || expected === undefined
    || expected === ""
    || SYNTHESIS_REQUIRED_OUTPUTS.has(expected);
  if (needsSynthesis) {
    const zh = hasCjk(userCommand);
    return zh
      ? "工具已经返回了连接器数据，但最终答复仍需要按你的请求进行总结/分析，不能直接把原始记录列表当作答案。"
      : "The connector returned data, but the final answer still needs synthesis rather than a raw record list.";
  }
  return fallbackText ?? entry.observation ?? null;
}

const ACTION_CONFIRMATION_TOOLS = new Set(["launch_app", "open_url", "open_file", "copy_to_clipboard", "notify"]);

// Phase 1.8 — `WEB_DESTINATION_ALIASES`, `openActionForLaunchTarget`,
// `plannedOpenActions`, `executedOpenActionKeys`, `nextPlannedOpenAction`,
// `allPlannedOpenActionsCompleted` were the regex layer that tried to
// pre-plan multi-app launches. Deleted: the LLM is the only authority on
// "what tools to call in what order" for compound intents. The system
// prompt tells it to keep calling tools until the user's full request is
// satisfied; ReAct iterations naturally chain launch_app(A) → launch_app(B).

function actionCompletionFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const completed = (transcript ?? []).filter((entry) =>
    entry?.type === "tool_result"
    && entry.success === true
    && ACTION_CONFIRMATION_TOOLS.has(entry.tool)
    && typeof entry.observation === "string"
    && entry.observation.trim()
  );
  if (completed.length === 0) return fallbackText;
  const observations = [...new Set(completed.map((entry) => entry.observation.trim()))];
  const zh = hasCjk(userCommand);
  return zh
    ? `已完成这些操作：\n${observations.map((line) => `- ${line}`).join("\n")}`
    : `Completed these actions:\n${observations.map((line) => `- ${line}`).join("\n")}`;
}

function finalFallbackText(transcript, userCommand = "", taskSpec = null, fallbackText = null) {
  const actionFallback = actionCompletionFallbackText(transcript, userCommand, taskSpec);
  if (actionFallback) return actionFallback;
  return connectorFallbackText(transcript, userCommand, taskSpec)
    ?? fallbackText;
}

function hasToolTranscript(transcript = []) {
  return transcript.some((entry) => entry?.type === "tool_result");
}

function isActionConfirmationOnly(transcript = []) {
  const results = transcript.filter((entry) => entry?.type === "tool_result");
  return results.length > 0
    && results.every((entry) => entry.success !== false && ACTION_CONFIRMATION_TOOLS.has(entry.tool));
}

function needsFinalComposer(task, transcript = []) {
  if (!hasToolTranscript(transcript)) return false;
  if (allowsRawConnectorFinal(task?.task_spec)) return false;
  if (isActionConfirmationOnly(transcript)) return false;
  return true;
}

function compactTranscriptForComposer(transcript = []) {
  const lines = [];
  for (const [index, entry] of transcript.entries()) {
    if (entry?.type === "tool_result") {
      const status = entry.success === false ? "failed" : "success";
      const obs = String(entry.observation ?? "").replace(/\s+/g, " ").trim().slice(0, 5000);
      const metadata = entry.metadata
        ? ` metadata=${JSON.stringify(entry.metadata).slice(0, 1000)}`
        : "";
      lines.push(`${index + 1}. ${entry.tool}(${JSON.stringify(entry.args ?? {}).slice(0, 500)}) ${status}: ${obs}${metadata}`);
    } else if (entry?.type === "tool_denied") {
      lines.push(`${index + 1}. ${entry.tool} denied: ${entry.reason ?? "denied"}`);
    } else if (entry?.type === "validation_error") {
      lines.push(`${index + 1}. ${entry.tool} validation_error: ${entry.error ?? "invalid arguments"}`);
    }
  }
  return lines.join("\n").slice(0, 24000);
}

function localFallbackFinal({ task, transcript, reason = "" }) {
  const userCommand = task?.user_command ?? "";
  const action = actionCompletionFallbackText(transcript, userCommand, task?.task_spec);
  if (action) return action;
  const connector = connectorFallbackText(transcript, userCommand, { synthesis: { expected_output: "raw_results" } });
  if (connector) return connector;
  const latest = [...(transcript ?? [])].reverse()
    .find((entry) => entry?.type === "tool_result" && String(entry.observation ?? "").trim());
  const zh = hasCjk(userCommand);
  const obs = String(latest?.observation ?? "").trim().slice(0, 800);
  if (obs) {
    return zh
      ? `我已经拿到工具返回的信息，但最终整理没有完成。可用信息如下：\n${obs}`
      : `I collected tool results, but final synthesis did not complete. Available information:\n${obs}`;
  }
  return zh
    ? `这次没有拿到足够的工具结果来完成最终答复。${reason ? `原因：${reason}` : ""}`.trim()
    : `I could not collect enough tool results to finish the answer.${reason ? ` Reason: ${reason}` : ""}`.trim();
}

async function composeFinalAnswer({ task, transcript, runtime, reason = "" }) {
  runtime?.emitTaskEvent?.("final_composer_started", { reason });
  const started = Date.now();
  try {
    if (typeof runtime?.finalAnswerComposer === "function") {
      const composed = await runtime.finalAnswerComposer({ task, transcript, reason });
      const text = String(composed ?? "").trim();
      if (text) return text;
    }
    const provider = resolveProviderForTask("chat");
    if (!provider || provider.kind === "code_cli") {
      return localFallbackFinal({ task, transcript, reason });
    }
    const adapter = createProviderAdapter(provider);
    let text = "";
    const userCommand = task?.user_command ?? "";
    const taskSpec = task?.task_spec ?? {};
    const expected = taskSpec?.synthesis?.expected_output ?? null;
    const system = [
      "You are LingxY's final answer composer.",
      "Use only the user request, task spec, and sanitized tool transcript below.",
      "Do not call tools. Do not mention internal pipeline, retries, budgets, validators, or raw tool protocol.",
      "Turn tool observations into the final answer the user asked for, in the user's language.",
      "If the transcript contains concrete values or facts that directly answer the request, use them. Do not claim data is unavailable just because the same observation also contains page boilerplate, navigation text, warnings, or unrelated errors.",
      "Preserve relevant source, timestamp, location, units, and uncertainty from the transcript when they matter to the answer.",
      "If a tool failed, say what could be completed and what could not, without exposing stack traces."
    ].join("\n");
    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          `[User request]\n${userCommand}`,
          `[Expected output]\n${expected ?? "infer from user request"}`,
          `[Task spec]\n${JSON.stringify({
            goal: taskSpec.goal,
            connector_domain: taskSpec.connector_domain,
            tool_policy: taskSpec.tool_policy,
            synthesis: taskSpec.synthesis,
            research_quality: taskSpec.research_quality
          })}`,
          `[Stop reason]\n${reason || "normal"}`,
          `[Tool transcript]\n${compactTranscriptForComposer(transcript) || "(no tool transcript)"}`
        ].join("\n\n")
      }
    ];
    const response = await adapter.generate({
      messages,
      tools: [],
      maxTokens: 1024,
      onTextDelta: adapter.supportsStreaming === true
        ? (delta) => {
            if (!delta) return;
            text += delta;
            runtime?.emitTaskEvent?.("text_delta", { delta });
          }
        : undefined
    });
    if (!text) text = response?.text ?? "";
    const finalText = String(text ?? "").trim();
    return finalText || localFallbackFinal({ task, transcript, reason });
  } catch {
    return localFallbackFinal({ task, transcript, reason });
  } finally {
    runtime?.emitTaskEvent?.("phase_timing", {
      phase: "final_composer",
      duration_ms: Math.max(0, Date.now() - started),
      reason
    });
  }
}

/**
 * Mirrors `resultHasSubstance` in success-contract-validator.mjs but
 * operates on the raw `result` object the registry returns (the
 * validator inspects transcript entries that wrap that result). Used
 * by the P4-EB error-budget wire-up to decide whether an
 * external_web_read success returned anything usable.
 */
function toolResultHasSubstance(result) {
  if (!result || typeof result !== "object") return false;
  if (Array.isArray(result.results) && result.results.length > 0) return true;
  if (Array.isArray(result.sources) && result.sources.length > 0) return true;
  if (typeof result.observation === "string" && result.observation.trim().length > 32) return true;
  for (const value of Object.values(result)) {
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim().length > 32) return true;
  }
  return false;
}

/**
 * UCA-054: Build a proper multi-turn messages array that injects tool
 * observations as actual message turns (not just system-prompt text).
 *
 * Pattern (ReAct: Thought → Action → Observation):
 *   user:      original request
 *   assistant: {"tool": "web_search_fetch", "args": {...}}
 *   user:      [Tool result] <observation text>
 *   assistant: {"tool": "..."} | {"final": "..."}
 *   ...
 *
 * The LLM genuinely sees each observation before it decides the next step,
 * eliminating the "LLM answers from memory without calling tools" failure mode.
 */
function buildConversationMessages(prefixMessages, transcript, initialFilePaths = []) {
  const messages = Array.isArray(prefixMessages) ? [...prefixMessages] : [];

  // UCA-179: roll up every artifact_paths seen so far so a later tool call
  // (e.g. send_email, account_upload_file) always sees the full list. We
  // append this as a short addendum to each tool observation.
  // Seed with the user-attached files from the context packet — a user who
  // says "send this file to x@y.com" expects it to land as an attachment.
  const seenArtifacts = Array.isArray(initialFilePaths)
    ? initialFilePaths.filter(Boolean).slice()
    : [];

  for (const entry of transcript) {
    if (entry.type === "tool_result") {
      // Represent the assistant's tool call decision
      messages.push({
        role: "assistant",
        content: JSON.stringify({ tool: entry.tool, args: entry.args ?? {} })
      });
      // Inject the actual observation as a user turn (standard ReAct convention)
      const successNote = entry.success === false
        ? "\n[IMPORTANT: This tool call FAILED. Do NOT claim success. You must handle the failure.]"
        : "";
      const metadataNote = entry.metadata
        ? `\n[Tool metadata JSON]\n${JSON.stringify(entry.metadata)}`
        : "";
      for (const p of entry.artifact_paths ?? []) {
        if (p && !seenArtifacts.includes(p)) seenArtifacts.push(p);
      }
      const artifactNote = seenArtifacts.length > 0
        ? `\n[Artifacts available so far — pass any of these verbatim to attachmentPaths / localPath / file arguments if the user asks to attach / send / upload]:\n${seenArtifacts.map((p) => `- ${p}`).join("\n")}`
        : "";
      messages.push({
        role: "user",
        content: `[Tool observation: ${entry.tool}]\n${entry.observation ?? "(no result)"}${metadataNote}${artifactNote}${successNote}`
      });
    } else if (entry.type === "tool_denied") {
      messages.push({
        role: "assistant",
        content: JSON.stringify({ tool: entry.tool, args: {} })
      });
      messages.push({
        role: "user",
        content: `[Tool denied: ${entry.tool}] Reason: ${entry.reason ?? "user denied"}`
      });
    } else if (entry.type === "validation_error") {
      messages.push({
        role: "user",
        content: `[Validation error for ${entry.tool}]: ${entry.error ?? "invalid arguments"}`
      });
    } else if (entry.type === "prose_trap_retry") {
      // 83.1: Reinject the LLM's prose-only reply as an assistant turn, then
      // a synthetic user turn pointing out that no tool call was made. This
      // breaks the loop where the model promises an action ("我来帮你发邮
      // 件...") but emits no tool_calls, causing the outer loop to exit
      // with type:"final" — the user sees a promise that was never kept,
      // and has to re-submit the request to get the tool actually called.
      messages.push({
        role: "assistant",
        content: entry.assistantProse ?? ""
      });
      messages.push({
        role: "user",
        content: entry.retryHint
          ?? "你上面说要执行操作，但没有发出 tool_call。如果确实需要操作，请直接调用工具；如果只是回答/解释而不需要操作，请重新输出最终答复（纯文本）。"
      });
    } else if (entry.type === "runbook_guidance") {
      messages.push({
        role: "user",
        content: `[Runbook recovery: ${entry.runbook_id}]\n${entry.instruction}`
      });
    } else if (entry.type === "synthesis_retry") {
      if (entry.assistantDraft) {
        messages.push({ role: "assistant", content: entry.assistantDraft });
      }
      const reasons = (entry.violations ?? []).map((v) => `- ${v.kind}: ${v.message}`).join("\n");
      messages.push({
        role: "user",
        content: `[Synthesis required] The previous draft did not satisfy the user's expected output. Issues:\n${reasons}\n\nRewrite the final answer in the user's language: read the prior tool observations above, transform them into the requested output kind, and respond as plain text. Do NOT call another tool unless new data is genuinely missing. Do NOT repeat raw observation lines verbatim.`
      });
    }
  }

  return messages;
}

function taskRequiresToolUse(task) {
  const spec = task?.task_spec ?? {};
  const contract = spec.success_contract ?? {};
  const requiredToolNames = contract.required_tool_names ?? [];
  const requiredPolicyGroups = contract.required_policy_groups ?? [];
  const actionGoals = new Set([
    "launch_and_act",
    "open_or_reveal_file",
    "transform_existing_file",
    "schedule_or_notify",
    "create_or_update_calendar_event"
  ]);
  return Boolean(
    task?.__forceToolUse === true
    || spec.connector_domain === true
    || spec.artifact?.required === true
    || spec.tool_policy?.web_search_fetch?.mode === "required"
    || contract.tool_called === true
    || (Array.isArray(requiredToolNames) && requiredToolNames.length > 0)
    || (Array.isArray(requiredPolicyGroups) && requiredPolicyGroups.length > 0)
    || actionGoals.has(spec.goal)
  );
}

function semanticDecisionOf(task) {
  return task?.context_packet?.semantic_router_decision ?? null;
}

function externalWebModeOf(task) {
  return task?.task_spec?.tool_policy?.policy_groups?.external_web_read?.mode
    ?? task?.task_spec?.tool_policy?.web_search_fetch?.mode
    ?? "forbidden";
}

function neededCapabilitiesOf(task) {
  const decision = semanticDecisionOf(task);
  return Array.isArray(decision?.needed_capabilities)
    ? decision.needed_capabilities.filter((value) => typeof value === "string" && value.trim())
    : [];
}

function capabilitiesAreNone(capabilities = []) {
  return capabilities.length === 0 || capabilities.every((capability) => capability === "none");
}

function shouldUseLeanChatMode(task) {
  if (taskRequiresToolUse(task)) return false;
  const spec = task?.task_spec ?? {};
  if (spec.artifact?.required === true) return false;
  if (spec.connector_domain === true) return false;
  if (externalWebModeOf(task) === "required") return false;
  if (Array.isArray(task?.context_packet?.file_paths) && task.context_packet.file_paths.length > 0) return false;
  if (Array.isArray(task?.context_packet?.image_paths) && task.context_packet.image_paths.length > 0) return false;

  const decision = semanticDecisionOf(task);
  if (decision && typeof decision === "object") {
    const capabilities = neededCapabilitiesOf(task);
    const sourceMode = decision.source_mode ?? "unknown";
    const toolFirstIntents = new Set([
      "automation",
      "computer_control",
      "email_calendar_action",
      "artifact_generation",
      "file_analysis",
      "research"
    ]);
    return Boolean(
      decision.needs_tool_use === false
      && decision.artifact_required !== true
      && decision.web_policy !== "required"
      && capabilitiesAreNone(capabilities)
      && ["no_external", "provided_context"].includes(sourceMode)
      && !toolFirstIntents.has(decision.primary_intent)
    );
  }

  // Conservative no-SR fallback. This is not a rules-answer fast path: it only
  // trims tool prompting after TaskSpec has already classified the turn as qa.
  return Boolean(
    spec.goal === "qa"
    && spec.contract?.mode === "qa"
    && externalWebModeOf(task) === "forbidden"
  );
}

const CAPABILITY_TOOL_MATCHERS = Object.freeze({
  external_web_read: (tool) =>
    tool.policy_group === "external_web_read"
    || ["web_search", "web_search_fetch", "fetch_url_content", "open_url"].includes(tool.id),
  file_read: (tool) =>
    /^(list_files|glob_files|find_recent_files|get_latest_artifact|stat_file|verify_file_exists|file_op|open_file|reveal_in_explorer)$/.test(tool.id),
  artifact_generation: (tool) =>
    /^(write_file|generate_document|edit_file|render_diagram|resolve_output_path|register_artifact|verify_file_exists)$/.test(tool.id),
  code_execution: (tool) => tool.id === "run_script",
  browser_control: (tool) => ["open_url", "take_screenshot"].includes(tool.id),
  email_calendar_action: (tool) =>
    /^(compose_email|send_email_smtp|account_|connector_)/.test(tool.id),
  desktop_action: (tool) =>
    /^(launch_app|gui_|open_file|reveal_in_explorer|copy_to_clipboard|notify|read_clipboard)/.test(tool.id),
  image_understanding: () => false,
  image_generation: (tool) => ["generate_document", "write_file"].includes(tool.id),
  none: () => false
});

function filterToolsForTask(tools = [], task) {
  const capabilities = neededCapabilitiesOf(task).filter((capability) => capability !== "none");
  if (capabilities.length === 0) return tools;
  const filtered = tools.filter((tool) => capabilities.some((capability) => {
    const matcher = CAPABILITY_TOOL_MATCHERS[capability];
    return typeof matcher === "function" ? matcher(tool) : false;
  }));
  return filtered.length > 0 ? filtered : tools;
}

function shouldRenderWorkflowHint(task) {
  const capabilities = neededCapabilitiesOf(task);
  if (task?.task_spec?.connector_domain === true) return true;
  if (capabilities.includes("email_calendar_action")) return true;
  if (Array.isArray(task?.task_spec?.intent_tags) && task.task_spec.intent_tags.includes("connector")) return true;
  return false;
}

function formatLeanAmbientContext() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return `Current local date and time: ${now.toLocaleString("sv-SE", { hour12: false })} (${tz}).`;
}

function buildLeanChatSystemPrompt({ task, synthesisBlock }) {
  const expected = task?.task_spec?.synthesis?.expected_output ?? "direct_answer";
  return `You are LingxY, a helpful conversational AI assistant.
The current task contract says this turn should be answered directly without external tools.
If the conversation history establishes a roleplay/persona (interviewer, coach, reviewer, or another requested role), keep that role active. When that role conflicts with the generic LingxY identity, follow the conversation role unless it asks for unsafe real-world action.
Do not ask for files, folders, accounts, or apps unless the current user message explicitly asks to use them.
If fresh/current external data is actually required despite the contract, ask one short permission or clarification question instead of guessing.
Phantom-attachment rule: if the user refers to an attachment (image / file / screenshot / 图片 / 这张图 / 这张照片 / 这个文件 / 上传的) but no attachment is present in this turn, ASK which one — never describe, analyze, or guess at the contents of a fictional attachment.
Expected output: ${expected}.
${formatLeanAmbientContext()}${synthesisBlock}
Reply in the user's language.`;
}

function shouldRetryProseTrap({ task, prose, transcript }) {
  if (!prose || typeof prose !== "string") return false;
  const anyToolRan = transcript.some((e) => e.type === "tool_result");
  if (anyToolRan) return false;
  const cmd = (task.user_command ?? "").trim();
  if (!cmd) return false;
  return taskRequiresToolUse(task);
}

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
  const maxIter = 8;

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
  // scheduler marks its own submissions with source_app="uca.scheduler";
  // detect that and tell the LLM to execute the action directly.
  const scheduledFireInstruction = task.context_packet?.source_app === "uca.scheduler"
    ? "\n\nSCHEDULED-FIRE CONTEXT: This request is the actual firing of an already-scheduled task — the delay has ALREADY elapsed. Execute the action NOW. Do NOT call create_scheduled_task under any circumstances. For a reminder, call notify directly. For an email, call the send workflow directly. The scheduling was done earlier; your job here is to perform the action."
    : "";

  const systemPrompt = leanChatMode
    ? buildLeanChatSystemPrompt({ task, synthesisBlock })
    : `You are LingxY, a capable desktop AI assistant running ON the user's machine. You have real local-execution tools: launch_app actually starts native applications, open_url actually navigates the user's browser, generate_document actually writes files to disk. You are NOT a "web assistant", "shortcut helper", or "chat-only" persona — refusing to call launch_app on the grounds that you "cannot operate a desktop computer" is wrong; the tools below are exactly that operation. Read the user's request carefully, consider what you have available (tools, workflows, attached resources, connected accounts), and decide how to accomplish their goal. Ask a short clarifying question only when you genuinely cannot proceed faithfully.
${resourceHint}
Available execution tools:
${toolList}${workflowHint}

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
- **Local context first.** For location-dependent requests, use a real location only when it is present in Resources, the user's message, or conversation history. If Resources says UNKNOWN_LOCATION and the user did not name a place, ask for the city or location permission before searching or acting. Never infer a city from timezone, locale, IP, search defaults, or examples.
- **Phantom attachments.** If the user refers to an image / file / screenshot / 图片 / 这张 / 这张照片 / 这个文件 / 上传的 but Resources shows \`Attached files: (none)\`, ASK them to attach or paste it. Never describe, summarize, or analyze a fictional attachment. If the conversation history mentions a concrete path, pass that path to a tool argument; do not pretend to "see" it as an inline attachment.
- **Contracts are boundaries, not dead ends.** If a policy, risk gate, or missing approval blocks the action you think is necessary, do not give up and do not pretend success. Ask the user for the smallest permission or missing detail needed, then stop.
- **Memory recall.** If the user refers to earlier work with a pronoun ("上个问题" / "刚才" / "之前那份" / "last one" / "that report") or asks you to continue / revise something done before, call list_recent_tasks first (or recall_memory with a topic query if the reference is thematic) and then get_task_detail on the matching task_id. Never reply "I don't remember prior work" while these tools exist.
- **No placeholder content.** If drafting an email, write an actual greeting / body in the user's language based on what they said — never emit literal "邮件主题" or "lorem ipsum" strings.
- **Compound requests = chain tool calls.** When the user asks for multiple actions in one message ("打开 Outlook 和 Excel"，"open A then B"，"启动这三个 app"), call ONE tool per turn but KEEP CALLING tools across turns until every requested action is done. Do NOT return a final answer after the first launch_app — the second / third are still pending. Only return final after every requested action shows success in the transcript.
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

const EMAIL_SEND_CLAIM_RE = /(已\s*(?:确认|确认发送)?\s*发\s*送|已\s*发出|已\s*寄出|邮件已\s*发(?:送|出)|已通过\s*gmail\s*发送|sent(?:\s+successfully|\s+the\s+email)?|email\s+(?:has\s+been\s+)?sent)/i;
const CALENDAR_CREATE_CLAIM_RE = /(已\s*创建(?:日程|会议|事件)|event\s+created|calendar\s+event\s+(?:has\s+been\s+)?created)/i;
const FILE_UPLOAD_CLAIM_RE = /(已\s*上传|uploaded(?:\s+successfully)?|file\s+(?:has\s+been\s+)?uploaded)/i;
const CONNECTOR_SEND_SUCCESS_TOOLS = new Set(["account_send_email", "connector_workflow_run", "google.gmail.send_email", "microsoft.outlook.send_email"]);
const CONNECTOR_EVENT_SUCCESS_TOOLS = new Set(["account_create_event", "google.calendar.create_event", "microsoft.calendar.create_event", "connector_workflow_run"]);
const CONNECTOR_FILE_SUCCESS_TOOLS = new Set(["account_upload_file", "google.drive.upload_file", "microsoft.onedrive.upload_file", "connector_workflow_run"]);

function transcriptHasSuccessfulTool(transcript = [], allowedIds) {
  return transcript.some((entry) => {
    if (entry?.type !== "tool_result") return false;
    if (entry.success === false) return false;
    if (!allowedIds.has(entry.tool)) return false;
    // For workflow runs, require the metadata to actually report a success
    // connector_status (not "waiting_external_decision" / "failed").
    if (entry.tool === "connector_workflow_run") {
      return entry.metadata?.connector_status === "success";
    }
    return true;
  });
}

/**
 * Given the tool-loop result, return true when the final_text claims a
 * connector write action succeeded but no transcript entry backs it up.
 * This is the truthfulness guard for hallucinated "email sent" replies.
 */
function detectUnbackedConnectorClaim(result) {
  const text = String(result?.final_text ?? "");
  if (!text) return false;
  const transcript = result?.transcript ?? [];
  if (EMAIL_SEND_CLAIM_RE.test(text)
    && !transcriptHasSuccessfulTool(transcript, CONNECTOR_SEND_SUCCESS_TOOLS)) {
    return "email_send";
  }
  if (CALENDAR_CREATE_CLAIM_RE.test(text)
    && !transcriptHasSuccessfulTool(transcript, CONNECTOR_EVENT_SUCCESS_TOOLS)) {
    return "calendar_create";
  }
  if (FILE_UPLOAD_CLAIM_RE.test(text)
    && !transcriptHasSuccessfulTool(transcript, CONNECTOR_FILE_SUCCESS_TOOLS)) {
    return "file_upload";
  }
  return null;
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

        // Truthfulness guard (extension of UCA-039/063): if the final text
        // claims a connector write action was performed (email sent, event
        // created, file uploaded) but no corresponding tool actually returned
        // success in the transcript, downgrade to partial_success. Without
        // this, DeepSeek-class models occasionally fabricate "已发送" without
        // calling connector_workflow_run or account_send_email.
        const connectorClaimGuard = detectUnbackedConnectorClaim(result);
        if (result.status === "success" && connectorClaimGuard) {
          const warning = "\n\n[LingxY] 注意：系统没有检测到对应的连接器工具调用成功。上面的文字是模型叙述，不是真实执行结果。请重新发起操作。";
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: (result.final_text || "任务没有生成最终答复。") + warning } };
          yield { event_type: "partial_success", payload: { text: (result.final_text || "任务没有生成最终答复。") + warning } };
          return;
        }

        if (result.status === "success") {
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: result.final_text || "任务已完成，但没有生成可显示的答复。" } };
          yield { event_type: "success", payload: { text: result.final_text || "任务已完成，但没有生成可显示的答复。" } };
        } else if (result.status === "waiting_external_decision") {
          yield { event_type: "inline_result", payload: { text: "等待你的确认。" } };
          yield { event_type: "success", payload: { text: "已创建待确认操作。" } };
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

async function resolveInteractiveConfirmation({ runtime, task, tool, args, risk }) {
  const decision = await (runtime.confirmationHandler?.({
    task,
    tool,
    args,
    risk
  }) ?? Promise.resolve({ decision: "confirm", args }));

  if (decision?.decision === "edit") {
    return {
      status: "confirm",
      args: decision.args ?? args
    };
  }

  if (decision?.decision === "deny") {
    appendAuditLog(runtime, task, "tool.denied", {
      tool_id: tool.id
    });
    return {
      status: "deny",
      args
    };
  }

  return {
    status: "confirm",
    args: decision?.args ?? args
  };
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
    const decision = await resolvedPlanner({
      task,
      transcript,
      tools: registry.list(),
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
      let candidateFinal = decision?.text
        ?? finalFallbackText(transcript, task.user_command, task.task_spec)
        ?? "";
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

    const tool = registry.get(decision.tool);
    if (!tool) {
      return {
        status: "failed",
        error: `Unknown tool requested: ${decision.tool}`,
        transcript
      };
    }

    if (decision?.type === "tool_call") {
      decision.args = repairToolArgs(decision, task, transcript, tool);
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

    const validation = validateToolCall(tool, decision.args, runtime.toolContext ?? {});
    if (!validation.ok) {
      transcript.push({
        type: "validation_error",
        tool: tool.id,
        error: validation.error
      });
      // For LLM planner, continue the loop so the model can fix its arguments.
      // For keyword planner, give up — it can't self-correct.
      if (planner === defaultPlanner) {
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

    if (task.execution_mode === "interactive" && risk.requires_confirmation) {
      const interactiveDecision = await resolveInteractiveConfirmation({
        runtime,
        task,
        tool,
        args: decision.args,
        risk
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
    }

    if (task.execution_mode === "unattended_safe" && risk.risk_level === "high") {
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

    if (task.execution_mode === "approval_required" && risk.requires_confirmation) {
      const approval = runtime.pendingApprovals.create({
        sourceType: "agent_tool_call",
        sourceId: task.task_id,
        proposedAction: "action_tool",
        proposedTarget: tool.id,
        proposedParams: decision.args,
        previewText: `Pending tool ${tool.id}`
      });
      runtime.emitTaskEvent?.("pending_approval_created", {
        approval_id: approval.approval_id,
        tool_id: tool.id
      });
      transcript.push({
        type: "pending_approval",
        approval_id: approval.approval_id,
        tool: tool.id
      });
      return {
        status: "waiting_external_decision",
        approval,
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
    let budgetEvent = null;
    if (resolvedPlanner !== defaultPlanner) {
      if (result.success === false) {
        budgetEvent = "tool_failure";
      } else if (groupsOfTool(tool.id).includes("external_web_read") && !toolResultHasSubstance(result)) {
        budgetEvent = "empty_search_result";
      }
    }
    if (budgetEvent) {
      const charge = chargeBudget(errorBudget, budgetEvent);
      errorBudget = charge.state;
      appendAuditLog(runtime, task, "tool_loop.error_budget_charge", {
        iteration,
        event: budgetEvent,
        exhausted: charge.exhausted,
        snapshot: snapshotBudget(errorBudget)
      });
      if (charge.exhausted) {
        runtime.emitTaskEvent?.("error_budget_signal", {
          iteration,
          event: budgetEvent,
          reason: charge.reason,
          snapshot: snapshotBudget(errorBudget)
        });
        return {
          status: "partial_success",
          final_text: await composeFinalAnswer({
            task,
            transcript,
            runtime,
            reason: charge.reason ?? "error_budget_exhausted"
          }),
          transcript,
          artifacts: result.artifact_paths ?? [],
          error_budget: {
            event: budgetEvent,
            reason: charge.reason,
            iteration,
            snapshot: snapshotBudget(errorBudget)
          }
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
      const stepGateSpec = task.task_spec ?? task.task_spec_initial;
      const stepGate = validateStepGate(stepGateSpec, transcript, {
        iteration,
        maxIterations
      });
      // Emit SSE + audit so inspect-routing can render the gate decision
      // alongside tool_call events. Compact payload — no full violations
      // dump on the wire.
      runtime.emitTaskEvent?.("phase_gate_signal", {
        iteration,
        next_action: stepGate.next_action,
        violation_kinds: (stepGate.violations ?? []).map((v) => v.kind),
        satisfied: stepGate.satisfied
      });
      appendAuditLog(runtime, task, "tool_loop.phase_gate", {
        iteration,
        next_action: stepGate.next_action,
        satisfied: stepGate.satisfied,
        violation_count: (stepGate.violations ?? []).length
      });

      // P4-RB suggestion: log which runbook would handle this signal.
      // Acting on the runbook (executing its steps) is a follow-up
      // commit; for now we just record the recommendation so production
      // traces show what the recovery path would have been.
      const runbook = suggestRunbookForStepGate(stepGate);
      if (runbook) {
        appendAuditLog(runtime, task, "tool_loop.runbook_suggested", {
          iteration,
          runbook_id: runbook.id,
          terminal_action: runbook.terminal_action,
          step_count: runbook.steps.length
        });
      }

      if (runbook && !firedRunbooks.has(runbook.id) && iteration < maxIterations - 1) {
        const instruction = runbook.steps
          .map((step, index) => `${index + 1}. ${step.description}`)
          .join("\n");
        firedRunbooks.add(runbook.id);
        transcript.push({
          type: "runbook_guidance",
          runbook_id: runbook.id,
          instruction: `${instruction}\n\nExecute the recovery with a different tool call or different arguments now. Do not repeat a failed identical tool+args pair.`
        });
        runtime.emitTaskEvent?.("runbook_signal", {
          iteration,
          runbook_id: runbook.id,
          terminal_action: runbook.terminal_action
        });
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
      if (stepGate.next_action === "abort" || stepGate.next_action === "escalate") {
        const violationSummary = (stepGate.violations ?? [])
          .map((v) => v.kind)
          .filter(Boolean)
          .join(", ");
        const reasonText = stepGate.next_action === "abort"
          ? `Phase gate aborted at iteration ${iteration}: ${violationSummary || "iteration ceiling reached without satisfying contract"}`
          : `Phase gate escalated at iteration ${iteration}: ${violationSummary || "no specific violation"}`;
        return {
          status: "partial_success",
          final_text: await composeFinalAnswer({
            task,
            transcript,
            runtime,
            reason: reasonText
          }),
          transcript,
          artifacts: result.artifact_paths ?? [],
          phase_gate: {
            next_action: stepGate.next_action,
            iteration,
            violations: stepGate.violations ?? [],
            runbook_suggested: runbook?.id ?? null
          }
        };
      }
    }

    // For the keyword planner, return after one tool call (it doesn't read history)
    if (planner === defaultPlanner) {
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
