import crypto from "node:crypto";
import { createActionToolRegistry } from "../../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../action_tools/tools/index.mjs";
import { validateToolCall } from "./tool-call-validator.mjs";
import { extractFirstTier0Action, hasCompoundIntent } from "../../core/router/fast-path-router.mjs";
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
import {
  formatResourceContext,
  formatUntrustedSourceMaterial,
  extractAbsoluteLocalPathsFromText
} from "../shared/resource-context.mjs";
import { detect as detectExplicitSearch } from "../../core/intent/signals/explicit-search.mjs";
import { renderToolPolicyForPrompt } from "../../core/policy/policy-groups.mjs";
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
  extractUrl,
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

function repairToolArgs(decision, task, transcript = []) {
  if (!decision || decision.tool !== "launch_app") return decision?.args ?? {};
  const args = { ...(decision.args ?? {}) };
  const explicit = normalizeLaunchAppArg(args.app ?? args.name ?? args.appName);
  if (explicit) {
    args.app = explicit;
    delete args.name;
    delete args.appName;
    return args;
  }

  const candidates = extractLaunchAppCandidates(task?.user_command ?? "");
  if (candidates.length === 0) return args;

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
  return args;
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

function toolDescriptorForAdapter(tool) {
  return {
    name: tool.id,
    description: tool.description ?? tool.name ?? "",
    input_schema: tool.parameters ?? { type: "object", properties: {} }
  };
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

function latestConnectorFinal(transcript, userCommand = "") {
  const entry = [...(transcript ?? [])].reverse().find((item) =>
    item.type === "tool_result"
    && ["account_list_connected_accounts", "account_list_emails", "account_list_files", "account_list_events"].includes(item.tool)
  );
  return entry ? formatConnectorFinal(entry, userCommand) : null;
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
function buildConversationMessages(userCommand, transcript, initialFilePaths = []) {
  const messages = [{ role: "user", content: userCommand }];

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
    }
  }

  return messages;
}

/**
 * 83.1 — Decide whether a prose-only reply from the LLM warrants a prose-trap
 * retry. A request that is obviously a pure question shouldn't be retried
 * (LLM is correct to reply in prose). A request that looks action-shaped
 * SHOULD — that's where the bug bites.
 *
 * Conservative: defaults to "retry" unless we detect interrogative shape.
 */
function shouldRetryProseTrap({ task, prose, transcript }) {
  if (!prose || typeof prose !== "string") return false;
  // If the loop has already run any tool, we're not in the failure mode.
  const anyToolRan = transcript.some((e) => e.type === "tool_result");
  if (anyToolRan) return false;
  const cmd = (task.user_command ?? "").trim();
  if (!cmd) return false;
  // Interrogative markers → probably a pure Q&A, don't retry.
  if (/[?？]\s*$/.test(cmd)) return false;
  if (/^(什么|为什么|怎么|如何|哪|谁|何时|多少|几)/.test(cmd)) return false;
  if (/^(what|why|how|who|when|where|which|does|do|is|are|can|could|should|would|will|were|was)\b/i.test(cmd)) return false;
  // Otherwise — the command looks imperative / action-shaped. Retry once.
  return true;
}

async function llmPlanner({ task, transcript, tools, iteration }) {
  const catalog = task.__runtime?.connectorCatalog ?? null;
  // Pass the catalog so a workflow with fully-specified input (e.g. user
  // wrote "主题:xx 正文:yy") can still short-circuit without an LLM call.
  // Ambiguous connector commands intentionally fall through to the LLM.
  const deterministic = planDeterministicToolCall(task.user_command, catalog);
  if (deterministic) return deterministic;

  // UCA-077 P1-06: web_search_fetch is required iff tool-policy says so.
  // The previous OR-with-regex condition meant a positive regex hit could
  // override a TaskSpec that had been resolved to "forbidden" — that is the
  // root of the "最近这个框架很慢 → 误联网" symptom. The resolver is now the
  // only authority.
  const webSearchRequired = task.task_spec?.tool_policy?.web_search_fetch?.mode === "required";
  const searchAlreadyCalled = transcript.some((entry) => entry.tool === "web_search_fetch");
  if (webSearchRequired && !searchAlreadyCalled) {
    return {
      type: "tool_call",
      tool: "web_search_fetch",
      args: {
        query: task.user_command,
        recency: inferSearchRecencyFromText(task.user_command)
      }
    };
  }

  const { resolveProviderForTask } = await import("../shared/provider-resolver.mjs");
  const provider = resolveProviderForTask("chat");
  if (!provider || provider.kind === "code_cli") {
    return defaultPlanner({ task, runtime: task.__runtime ?? null });
  }

  const toolList = tools.map((t) => `- ${t.id}: ${t.description ?? ""}`).join("\n");
  const workflowHint = formatWorkflowsForPlanner(task.__runtime?.connectorCatalog);
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

  const systemPrompt = `You are LingxY, a capable desktop AI assistant. Read the user's request carefully, consider what you have available (tools, workflows, attached resources, connected accounts), and decide how to accomplish their goal. Ask a short clarifying question only when you genuinely cannot proceed faithfully.
${resourceHint}
Available tools:
${toolList}${workflowHint}

Key tool schemas:
- launch_app: { "app": "<app name>" }
- open_url: { "url": "https://..." }
- web_search_fetch: { "query": "...", "recency": "day"|"week"|"month"|"year" }
- open_file: { "path": "C:\\\\path\\\\to\\\\file" }
- list_files / glob_files / find_recent_files — enumerate local files BEFORE fanning out per-file actions
- account_send_email: { "to": [...], "subject": "...", "body": "...", "attachmentPaths": [optional absolute paths] }
- account_create_event: { "title": "...", "startTime": "<ISO8601>", "endTime": "<ISO8601>", "attendees": [...] }
- create_scheduled_task: delay work to a specific moment — use for "N 分钟后 / tomorrow X / at HH:MM" requests
- generate_document: { "kind": "pptx"|"docx"|"xlsx"|"pdf", "filename": "...", "outline": { ... } } — pass outline as a native object, not a stringified JSON string. For pptx use { title, subtitle?, slides:[{ heading, bullets?: string[] }] }; for docx/pdf use { title, sections:[{ heading, body|bullets }] }; for xlsx use { rows:[[...]] }.
- edit_file: { "path": "C:\\\\absolute\\\\existing-file.ext", "outline" | "content": ... } — use this when the user asks to revise an already-generated artifact. Keep the SAME absolute path so the file is updated in place instead of creating a new one.
- notify / copy_to_clipboard / translate_text — self-describing

Guidance (not a rigid checklist — apply judgment):
- **Execute with what you have.** If the request is concrete and you have the tool + data, just call it. Don't ask for permission the user already implicitly gave.
- **Ask only when necessary.** If a required field (recipient email, file path, specific item) is truly missing AND you can't infer it from the resources listed above, return {"final": "<one short clarifying question in the user's language>"} and stop. Do NOT ask when the user gave enough to act.
- **Use known absolute paths directly.** If the resources / history already include absolute local file paths, pass them verbatim to attachmentPaths / localPath / file tool arguments. Do NOT call list_files / glob_files / find_recent_files just to rediscover a path you already have.
- **Edit existing artifacts in place.** If the user asks to revise/refine a previously generated file, first locate the target path from attachments/resources/history (or get_latest_artifact if needed), then call edit_file with the SAME path. Do not create a fresh sibling file unless the user explicitly asks for a new copy.
- **Future-time requests schedule, not execute now.** If the user says "in N minutes/hours" or "tomorrow at X" or "tonight at Y" about WHEN to run the action (as opposed to event start time being an argument), call create_scheduled_task with action.type="task" and params.userCommand carrying the full instruction. The scheduler will wake you up at trigger time to execute.
- **Fan out enumerations.** When the user says "all / every / each <something>", start with an enumeration tool (list_files / glob_files / account_list_emails / account_list_files), read the result, then call the per-item action for each result in subsequent iterations. Do not guess counts or filenames.
- **Connector workflows over raw tools.** Gmail/Outlook/Calendar/Drive operations should use connector_workflow_run when a matching workflow exists (see the workflow list above). The workflow shows the user a draft with 确认/拒绝 buttons; you do NOT need to ask in chat.
- **Truthfulness.** Only claim an email was sent / event created / file uploaded when the transcript shows the corresponding tool returned success=true. If you prepared a draft and it's waiting on the user's approval, say so explicitly.
- **Search before answering about current events.** Read \`tool_policy.external_web_read\` first. When the mode is \`required\` or \`optional\`, AND the user asks about news / prices / flights / weather / anything time-sensitive, call a member of the \`external_web_read\` group first — \`web_search_fetch\` is the typical default; fall back to \`fetch_url_content\` on a known authoritative URL (e.g. weather.gov, en.wikipedia.org, finance.yahoo.com) if the search returns nothing. When the mode is \`forbidden\`, do NOT search — answer from the resources you already have, or tell the user the request is out of scope. Never fabricate real-time facts from memory.
- **Memory recall.** If the user refers to earlier work with a pronoun ("上个问题" / "刚才" / "之前那份" / "last one" / "that report") or asks you to continue / revise something done before, call list_recent_tasks first (or recall_memory with a topic query if the reference is thematic) and then get_task_detail on the matching task_id. Never reply "I don't remember prior work" while these tools exist.
- **No placeholder content.** If drafting an email, write an actual greeting / body in the user's language based on what they said — never emit literal "邮件主题" or "lorem ipsum" strings.
- **Don't repeat failed tool+args pairs.** You have at most ${maxIter} tool calls; end early once the goal is met.
${needsCurrentDataInstruction}${forceToolInstruction}${scheduledFireInstruction}${mcpCapabilitiesNote}
Use the native tool interface when a tool is needed. Call at most ONE tool per turn. If no tool is needed, or you need a clarification, reply with plain text only in the user's language.`;

  try {
    let resultText = "";
    // P4-00.5 trust split: ctx.text was previously surfaced only via the
    // system-side resourceHint (`User-selected text:` line). That path
    // elevated third-party page content to system trust and made any
    // embedded prompt-injection ("ignore previous instructions…") look
    // like a system directive. Now ctx.text + ctx.url ride in the user
    // turn, fenced as <untrusted_source> with a guard sentence.
    const untrusted = formatUntrustedSourceMaterial(task);
    const initialUserContent = untrusted
      ? `${task.user_command}\n\n${untrusted}`
      : task.user_command;
    // UCA-054: Use proper multi-turn messages with observations injected as turns
    const conversationMessages = buildConversationMessages(
      initialUserContent,
      transcript,
      [
        ...(task.context_packet?.file_paths ?? []),
        ...(task.context_packet?.image_paths ?? []),
        ...extractAbsoluteLocalPathsFromText(task.context_packet?.text ?? "")
      ]
    );

    const adapter = createProviderAdapter(provider);
    const toolSchemas = tools.map(toolDescriptorForAdapter);
    const response = await adapter.generate({
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationMessages
      ],
      tools: toolSchemas,
      maxTokens: 1024,
      onToolInputDelta: (toolName, partialJson) => {
        if (!["write_file", "generate_document", "edit_file"].includes(toolName)) return;
        task.__runtime?.emitTaskEvent?.("tool_input_delta", {
          tool_id: toolName,
          partial_json: partialJson
        });
      },
      // 83.4 — Stream reasoning_content (Qwen3 thinking, DeepSeek reasoner)
      // as a separate event so renderers (overlay, console) can render a
      // collapsible "🧠 思考过程" card next to the main bubble. Provider
      // adapters that don't expose reasoning never call this — silent no-op.
      onReasoningDelta: (delta) => {
        if (!delta) return;
        task.__runtime?.emitTaskEvent?.("reasoning_delta", { delta });
      }
    });
    resultText = response?.text ?? "";

    if (Array.isArray(response?.tool_calls) && response.tool_calls.length > 0) {
      const call = response.tool_calls[0];
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

// UCA-063: Detect AI refusal text so we can force a retry with tool calls.
// Generic — catches any refusal regardless of app/action/language.
const REFUSAL_PATTERNS = [
  /我无法.{0,15}(直接|帮你|为你)?操作/,
  /我不能.{0,15}(直接|帮你|为你)?操作/,
  /I\s+(cannot|can't|am\s+unable\s+to).{0,25}(operate|control|access|open|launch|run)/i,
  /无法直接.{0,15}(为你|帮你|操作)/,
  /需要你.{0,15}(手动|自行|自己)/,
  /请你?.{0,10}(手动|自行|自己).{0,15}(打开|启动|操作)/,
  /please.{0,15}(manually|yourself).{0,15}(open|launch|start)/i
];

function isRefusalText(text) {
  return REFUSAL_PATTERNS.some((p) => p.test(String(text ?? "")));
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
        yield { event_type: "success", payload: { text: "Tool executor missing runtime context." } };
        return;
      }

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
          const { satisfied, violations } = validateSuccessContract(task.task_spec, result.transcript ?? []);
          if (!satisfied) {
            const reasons = violations.map((v) => v.message).join(" ");
            const warningNote = `\n\n[UCA] 注意：未通过 SuccessContract 校验：${reasons}`;
            yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
            yield { event_type: "inline_result", payload: { text: (result.final_text || "Done.") + warningNote } };
            yield { event_type: "partial_success", payload: { text: (result.final_text || "Done.") + warningNote, violations } };
            return;
          }
        }

        // UCA-063: Refusal guard — if LLM returned a refusal text but had tools
        // available and the task goal is action-oriented, force a retry with an
        // explicit system-level override. Generic: works for any app/action.
        const isActionGoal = ["launch_and_act", "open_or_reveal_file", "transform_existing_file"]
          .includes(task.task_spec?.goal);
        const noToolsUsed = !(result.transcript ?? []).some((e) => e.type === "tool_result");
        if (result.status === "success" && isActionGoal && noToolsUsed && isRefusalText(result.final_text)) {
          // Inject override and retry once with llmPlanner
          task.__forceToolUse = true;
          const retryResult = await runToolAgentLoop({ task, runtime, maxIterations: 4, planner: llmPlanner });
          task.__forceToolUse = false;
          const retryText = retryResult.final_text || "Done.";
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: retryText } };
          yield { event_type: retryResult.status === "success" ? "success" : "partial_success", payload: { text: retryText } };
          return;
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
          yield { event_type: "inline_result", payload: { text: (result.final_text || "Done.") + warning } };
          yield { event_type: "partial_success", payload: { text: (result.final_text || "Done.") + warning } };
          return;
        }

        if (result.status === "success") {
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: result.final_text || "Done." } };
          yield { event_type: "success", payload: { text: result.final_text || "Done." } };
        } else if (result.status === "waiting_external_decision") {
          yield { event_type: "inline_result", payload: { text: "Waiting for your approval..." } };
          yield { event_type: "success", payload: { text: "Pending approval." } };
        } else if (result.status === "partial_success") {
          const text = result.final_text || result.error || "Tool loop stopped before the success contract was fully satisfied.";
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
          yield { event_type: "inline_result", payload: { text: result.final_text || result.error || "Tool execution failed." } };
          yield { event_type: "success", payload: { text: result.final_text || "Done with errors." } };
        }
      } catch (error) {
        yield { event_type: "success", payload: { text: `Tool executor error: ${error.message}` } };
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

export async function runToolAgentLoop({
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

  // UCA-065/066: Choose planner based on command structure.
  // - Compound intent ("open X, do Y"): force llmPlanner so both steps are handled.
  // - Otherwise: use runtime override, then defaultPlanner.
  // This ensures "打开Outlook写邮件" always uses llmPlanner, never defaultPlanner
  // (which exits after one tool call).
  const resolvedPlanner = planner
    ?? (hasCompoundIntent(task.user_command) ? llmPlanner : null)
    ?? runtime.toolPlanner
    ?? defaultPlanner;

  // NOTE: workflow dispatch is owned by the LLM planner via the
  // connector_workflow_run tool — no regex short-circuit here. The LLM sees
  // available workflows in its system prompt (formatWorkflowsForPlanner) and
  // composes them with other tools (e.g. web_search_fetch → workflow) when
  // the user's request needs multi-step reasoning. See llmPlanner below.

  // UCA-066: Tier 0 in-loop optimisation.
  // On the first iteration, if the command starts with a deterministic action
  // (launch app / open URL), execute it immediately without calling the LLM.
  // The LLM then only needs to handle what comes AFTER (e.g. drafting an email).
  // This saves 2-5s per compound action and works for ANY app, not just Outlook.
  if (resolvedPlanner !== defaultPlanner) {
    const tier0 = extractFirstTier0Action(task.user_command);
    if (tier0) {
      const toolContext = { ...(runtime.toolContext ?? {}), outputDir: runtime.toolOutputDir, runtime, task };
      const t0result = await registry.call(tier0.tool, tier0.args, toolContext);
      runtime.emitTaskEvent?.("tool_call_completed", { tool_id: tier0.tool, success: t0result.success });
      transcript.push({
        type: "tool_result",
        tool: tier0.tool,
        args: tier0.args,
        success: t0result.success,
        observation: t0result.observation ?? "",
        metadata: t0result.metadata
      });
      seenCalls.add(`${tier0.tool}::${JSON.stringify(tier0.args)}`);
    }
  }

  // 83.1 — Track prose-trap retries separately from the tool-call iteration
  // budget. Hard cap at 1: if the model returns prose again after the retry
  // hint, we accept that as genuinely final.
  let proseTrapAttemptsUsed = 0;
  const PROSE_TRAP_MAX_ATTEMPTS = 1;

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
        runtime?.emitTaskEvent?.(task.task_id, "prose_trap_retry", {
          reason: "prose_without_tool_call",
          attempt: proseTrapAttemptsUsed
        });
        continue;
      }
      const connectorFinal = latestConnectorFinal(transcript, task.user_command);
      return {
        status: "success",
        final_text: connectorFinal ?? decision?.text ?? "Done.",
        transcript
      };
    }

    if (decision?.type === "tool_call") {
      decision.args = repairToolArgs(decision, task, transcript);
    }

    // Dedupe: if the planner is asking for the same tool+args we already executed, treat as final
    const callKey = `${decision.tool}::${JSON.stringify(decision.args ?? {})}`;
    if (seenCalls.has(callKey)) {
      const connectorFinal = latestConnectorFinal(transcript, task.user_command);
      return {
        status: "success",
        final_text: connectorFinal ?? (transcript.length > 0
          ? transcript.filter((e) => e.type === "tool_result").map((e) => e.observation).join("\n")
          : "Done."),
        transcript
      };
    }
    seenCalls.add(callKey);

    const tool = registry.get(decision.tool);
    if (!tool) {
      return {
        status: "failed",
        error: `Unknown tool requested: ${decision.tool}`,
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
        const connectorFinal = latestConnectorFinal(transcript, task.user_command);
        return {
          status: "partial_success",
          final_text: connectorFinal ?? `Error budget exhausted at iteration ${iteration}: ${charge.reason}`,
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
      const stepGate = validateStepGate(task.task_spec, transcript, {
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
        const connectorFinal = latestConnectorFinal(transcript, task.user_command);
        return {
          status: "partial_success",
          final_text: connectorFinal ?? reasonText,
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
      const connectorFinal = latestConnectorFinal(transcript, task.user_command);
      return {
        status: "success",
        final_text: connectorFinal ?? result.observation,
        transcript,
        artifacts: result.artifact_paths ?? []
      };
    }
    // For the LLM planner, continue the loop — it will see the result in transcript
    // and decide whether to call another tool or finish.
  }

  // Reached max iterations — synthesize whatever we have
  const connectorFinal = latestConnectorFinal(transcript, task.user_command);
  const lastObservation = [...transcript].reverse().find((e) => e.type === "tool_result")?.observation;
  return {
    status: "success",
    final_text: connectorFinal ?? (lastObservation || "Done (max iterations reached)."),
    transcript
  };
}
