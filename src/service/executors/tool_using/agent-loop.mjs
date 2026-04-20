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

  if (isSearchOrNewsRequest(task.user_command)) {
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

function planDeterministicToolCall(userCommand = "", catalog = null) {
  const text = String(userCommand ?? "").trim();
  const url = extractUrl(text);
  if (url && /(打开|访问|open|visit|go to|网页|网站|链接|url)/i.test(text)) {
    return {
      type: "tool_call",
      tool: "open_url",
      args: { url }
    };
  }

  // Workflow dispatch is the LLM planner's job; this no-LLM fallback planner
  // only runs when no chat provider is configured. Only short-circuit here
  // when the user explicitly provided every required workflow input in the
  // text (e.g. "主题：xx 正文：yy") — otherwise let the capability-based read
  // path below take over so the user still sees something useful instead of
  // a validation-failed workflow.
  const workflow = catalog ? matchWorkflowByTrigger(text, catalog) : null;
  if (workflow) {
    const firstToolId = workflow.steps?.find((step) => step?.tool)?.tool;
    const firstTool = firstToolId ? catalog.getTool?.(firstToolId) : null;
    const required = firstTool?.inputSchema?.required ?? [];
    const input = extractWorkflowInput(text, workflow);
    const missing = required.filter((field) => {
      const value = input?.[field];
      if (value === undefined || value === null) return true;
      if (typeof value === "string" && !value.trim()) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });
    if (missing.length === 0) {
      return {
        type: "tool_call",
        tool: "connector_workflow_run",
        args: { workflowId: workflow.id, input }
      };
    }
  }

  // Connector-domain guesswork (account_list_emails for anything mentioning
  // "邮件"/"gmail") is intentionally NOT done here. It would short-circuit
  // write-intent commands like "给 X 发一份邮件" into a read call and never
  // let the LLM see the request. The LLM planner has catalog hints and picks
  // connector_workflow_run itself. Only no-LLM defaultPlanner uses
  // planConnectorToolCall (as a separate step, not from here).
  if (/(邮件|email|gmail|outlook|日历|calendar|drive|onedrive|文件|网盘)/i.test(text) || isSearchOrNewsRequest(text)) {
    return null;
  }

  const launchApp = extractLaunchAppName(text);
  if (launchApp) {
    return {
      type: "tool_call",
      tool: "launch_app",
      args: { app: launchApp }
    };
  }

  return null;
}

function planConnectorToolCall(userCommand = "", catalog = null) {
  const text = String(userCommand ?? "");
  if (!isConnectorDomainRequest(text)) return null;

  // Same rule as planDeterministicToolCall: only dispatch a workflow if the
  // user explicitly provided every required input. Otherwise drop through to
  // the read-tool fallback so we don't hand the dispatcher empty fields.
  const workflow = catalog ? matchWorkflowByTrigger(text, catalog) : null;
  if (workflow) {
    const firstToolId = workflow.steps?.find((step) => step?.tool)?.tool;
    const firstTool = firstToolId ? catalog.getTool?.(firstToolId) : null;
    const required = firstTool?.inputSchema?.required ?? [];
    const input = extractWorkflowInput(text, workflow);
    const missing = required.filter((field) => {
      const value = input?.[field];
      if (value === undefined || value === null) return true;
      if (typeof value === "string" && !value.trim()) return true;
      if (Array.isArray(value) && value.length === 0) return true;
      return false;
    });
    if (missing.length === 0) {
      return {
        type: "tool_call",
        tool: "connector_workflow_run",
        args: { workflowId: workflow.id, input }
      };
    }
  }

  const provider = inferConnectorProvider(text);
  const withProvider = provider ? { provider } : {};
  const limit = inferConnectorLimit(text, 10);

  if (isConnectorAccountIdentityRequest(text)) {
    return {
      type: "tool_call",
      tool: "account_list_connected_accounts",
      args: withProvider
    };
  }

  // Capability-driven read fallback: agent-loop no longer hardcodes Gmail /
  // Outlook strings. It asks the catalog for a read tool matching the
  // capability implied by the user's wording, so new providers pick this up
  // for free once they ship a contract. When the catalog is unavailable (eg
  // minimal test runtimes) we fall back to the provider-agnostic
  // account_list_* action tools using the same capability inference.
  const capability = inferCapabilityFromText(text);
  if (capability) {
    if (catalog) {
      const matches = catalog.listTools({ capability, provider: provider ?? undefined, risk: "low" });
      if (matches.length > 0) {
        const readToolId = pickReadActionToolFromCatalog(catalog, matches[0].id);
        if (readToolId) {
          return {
            type: "tool_call",
            tool: readToolId,
            args: { ...withProvider, limit }
          };
        }
      }
    }
    const fallback = fallbackReadToolForCapability(capability);
    if (fallback) {
      return {
        type: "tool_call",
        tool: fallback,
        args: { ...withProvider, limit }
      };
    }
  }

  return {
    type: "tool_call",
    tool: "account_list_connected_accounts",
    args: withProvider
  };
}

function fallbackReadToolForCapability(capability) {
  if (capability === "calendarRead") return "account_list_events";
  if (capability === "fileRead") return "account_list_files";
  if (capability === "emailRead") return "account_list_emails";
  return null;
}

function inferCapabilityFromText(text = "") {
  if (/(日历|\bcalendar\b|event|events|会议|日程)/i.test(text)) return "calendarRead";
  if (/(google\s*drive|onedrive|云端文件|网盘|drive|文件)/i.test(text)) return "fileRead";
  if (/(邮件|邮箱|\bemails?\b|\bmail\b|gmail|outlook)/i.test(text)) return "emailRead";
  return null;
}

function pickReadActionToolFromCatalog(catalog, toolId) {
  const tool = catalog.getTool?.(toolId);
  const actionToolId = tool?.execution?.actionTool;
  if (actionToolId && typeof actionToolId === "string") {
    return actionToolId;
  }
  // Fall back to the canonical account_list_* tools so older contracts still
  // work until they declare execution.actionTool explicitly.
  if (tool?.capability === "calendarRead") return "account_list_events";
  if (tool?.capability === "fileRead") return "account_list_files";
  if (tool?.capability === "emailRead") return "account_list_emails";
  return null;
}

/**
 * Summarise the resources the LLM can actually reach right now — attachments,
 * selection text, connected accounts, current wall-clock time. The LLM is a
 * single brain that decides how to act; without this block it has to guess
 * what's available. This is the pattern mainstream agent frameworks
 * (LangGraph / CrewAI / AutoGPT) use: give the model the raw context and
 * the tool belt, and let it plan.
 */
function formatResourceContext(task) {
  const runtime = task.__runtime ?? null;
  const ctx = task.context_packet ?? {};
  const lines = [];
  lines.push("");
  lines.push("Resources you can use right now:");
  lines.push(`- Current local time: ${new Date().toISOString()} (interpret "明天/tomorrow/今晚" relative to this)`);

  const attachments = [
    ...(ctx.file_paths ?? []),
    ...(ctx.image_paths ?? [])
  ].filter(Boolean);
  if (attachments.length > 0) {
    lines.push(`- Attached files (absolute paths, safe to pass as tool arguments): ${JSON.stringify(attachments)}`);
  } else {
    lines.push(`- Attached files: (none)`);
  }

  const selectionText = typeof ctx.text === "string" ? ctx.text.trim() : "";
  if (selectionText && selectionText.length <= 400) {
    lines.push(`- User-selected text: ${JSON.stringify(selectionText)}`);
  } else if (selectionText.length > 400) {
    lines.push(`- User-selected text: ${JSON.stringify(selectionText.slice(0, 200) + "…")} (truncated, ${selectionText.length} chars total)`);
  }

  try {
    const accounts = runtime?.store?.listConnectedAccounts?.()
      ?? runtime?.store?.listUserAccounts?.()
      ?? [];
    const rows = accounts.slice(0, 6).map((account) => {
      const caps = typeof account.capabilities === "object" && account.capabilities
        ? Object.entries(account.capabilities).filter(([, v]) => v).map(([k]) => k).join(",")
        : "";
      return `${account.provider} ${account.email ?? account.id ?? ""}${caps ? ` (${caps})` : ""}`;
    });
    if (rows.length > 0) {
      lines.push(`- Connected accounts: ${rows.join("; ")}`);
    }
  } catch { /* no-op */ }

  return lines.join("\n");
}

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

function isSearchOrNewsRequest(value = "") {
  if (isConnectorDomainRequest(value)) return false;
  return /(搜索|查找|查一下|查询|查看一下|帮我查|查.*(?:价格|航班|机票|酒店|天气|汇率|股价|新闻)|新闻|消息|要闻|时政|最新|最近|动态|资讯|热点|近况|机票|航班|订票|实时|当前|google|bing|百度|search|latest|recent|current|news|flight|ticket|weather|hotel)/i.test(String(value ?? ""));
}

function inferSearchRecencyFromText(value = "") {
  const text = String(value ?? "").toLowerCase();
  if (/(今天|今日|24\s*小时|today|breaking)/i.test(text)) return "day";
  if (/(本周|一周|近\s*7\s*天|week)/i.test(text)) return "week";
  if (/(本月|一个月|近\s*30\s*天|month)/i.test(text)) return "month";
  if (/(今年|一年|近\s*12\s*个月|year)/i.test(text)) return "year";
  if (/(今天|今日|时政|要闻|最新|最近|新闻|消息|近况|latest|recent|current|news)/i.test(text)) return "month";
  return null;
}

function extractLaunchAppName(value = "") {
  const text = String(value ?? "").trim();
  const patterns = [
    /(?:启动|打开|运行)\s*(?:一下|下)?\s*(?:应用|软件|程序|app)?\s*([^，。,.!?]+)/i,
    /\b(?:launch|open|start|run)\s+(?:the\s+)?(?:app\s+|application\s+)?([^,.!?]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim()
      ?.replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
      ?.trim();
    if (candidate
      && !/^(一个)?(应用|软件|程序|app|application)$/i.test(candidate)
      && !extractUrl(candidate)
      && !/(网页|网站|链接|网址|url|web\s*page|website)$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractUrl(value = "") {
  const text = String(value ?? "");
  const match = text.match(/\bhttps?:\/\/[^\s，。]+/i)
    ?? text.match(/\bwww\.[^\s，。]+/i);
  if (!match) return null;
  const raw = match[0].replace(/[,.!?]+$/g, "");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

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
function buildConversationMessages(userCommand, transcript) {
  const messages = [{ role: "user", content: userCommand }];

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
      messages.push({
        role: "user",
        content: `[Tool observation: ${entry.tool}]\n${entry.observation ?? "(no result)"}${metadataNote}${successNote}`
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
    }
  }

  return messages;
}

async function llmPlanner({ task, transcript, tools, iteration }) {
  const catalog = task.__runtime?.connectorCatalog ?? null;
  // Pass the catalog so a workflow with fully-specified input (e.g. user
  // wrote "主题:xx 正文:yy") can still short-circuit without an LLM call.
  // Ambiguous connector commands intentionally fall through to the LLM.
  const deterministic = planDeterministicToolCall(task.user_command, catalog);
  if (deterministic) return deterministic;

  // UCA-054/039: Enforce web search for current-data requests before trying LLM.
  // Both explicit TaskSpec flag and heuristic text detection trigger this.
  const connectorDomainRequest = isConnectorDomainRequest(task.user_command);
  const needsCurrentData = (task.task_spec?.needs_current_web_data === true && !connectorDomainRequest)
    || isSearchOrNewsRequest(task.user_command);
  const searchAlreadyCalled = transcript.some((entry) => entry.tool === "web_search_fetch");
  if (needsCurrentData && !searchAlreadyCalled) {
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

  // UCA-039: Inject a hard requirement when the task spec flags current web data as needed.
  const needsCurrentDataInstruction = (task.task_spec?.needs_current_web_data === true && !isConnectorDomainRequest(task.user_command))
    ? "\n\nREQUIRED: You MUST call web_search_fetch before answering. Do NOT answer from memory for current-events questions. Failure to call web_search_fetch will result in a partial_success downgrade."
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
- notify / copy_to_clipboard / translate_text / generate_document — self-describing

Guidance (not a rigid checklist — apply judgment):
- **Execute with what you have.** If the request is concrete and you have the tool + data, just call it. Don't ask for permission the user already implicitly gave.
- **Ask only when necessary.** If a required field (recipient email, file path, specific item) is truly missing AND you can't infer it from the resources listed above, return {"final": "<one short clarifying question in the user's language>"} and stop. Do NOT ask when the user gave enough to act.
- **Future-time requests schedule, not execute now.** If the user says "in N minutes/hours" or "tomorrow at X" or "tonight at Y" about WHEN to run the action (as opposed to event start time being an argument), call create_scheduled_task with action.type="task" and params.userCommand carrying the full instruction. The scheduler will wake you up at trigger time to execute.
- **Fan out enumerations.** When the user says "all / every / each <something>", start with an enumeration tool (list_files / glob_files / account_list_emails / account_list_files), read the result, then call the per-item action for each result in subsequent iterations. Do not guess counts or filenames.
- **Connector workflows over raw tools.** Gmail/Outlook/Calendar/Drive operations should use connector_workflow_run when a matching workflow exists (see the workflow list above). The workflow shows the user a draft with 确认/拒绝 buttons; you do NOT need to ask in chat.
- **Truthfulness.** Only claim an email was sent / event created / file uploaded when the transcript shows the corresponding tool returned success=true. If you prepared a draft and it's waiting on the user's approval, say so explicitly.
- **Search before answering about current events.** If the user asks about news / prices / flights / weather / anything time-sensitive, call web_search_fetch first. Never answer from memory for real-time topics.
- **No placeholder content.** If drafting an email, write an actual greeting / body in the user's language based on what they said — never emit literal "邮件主题" or "lorem ipsum" strings.
- **Don't repeat failed tool+args pairs.** You have at most ${maxIter} tool calls; end early once the goal is met.
${needsCurrentDataInstruction}${forceToolInstruction}${scheduledFireInstruction}${mcpCapabilitiesNote}
Respond ONLY with a single JSON object (no markdown, no code fences):
- Call a tool:       {"tool": "tool_id", "args": { ... }}
- Ask clarification: {"final": "your short clarifying question"}
- Finish with answer: {"final": "your reply in the user's language"}`;

  try {
    let resultText = "";
    // UCA-054: Use proper multi-turn messages with observations injected as turns
    const conversationMessages = buildConversationMessages(task.user_command, transcript);

    if (provider.kind === "anthropic") {
      const r = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: conversationMessages
        })
      });
      const data = await r.json();
      resultText = data.content?.find((b) => b.type === "text")?.text ?? "";
    } else {
      const r = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            ...conversationMessages
          ]
        })
      });
      const data = await r.json();
      resultText = data.choices?.[0]?.message?.content ?? "";
    }

    // strip markdown code fences if AI added them
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

        // UCA-039: Verify that web_search_fetch was actually called when the task
        // spec requires current web data. If the LLM skipped the search and answered
        // from memory, downgrade to partial_success so the user knows the result
        // may not reflect the latest information.
        const searchWasRequired = (task.task_spec?.needs_current_web_data === true && !isConnectorDomainRequest(task.user_command))
          || isSearchOrNewsRequest(task.user_command);
        const searchWasCalled = (result.transcript ?? []).some(
          (entry) => entry.type === "tool_result" && entry.tool === "web_search_fetch"
        );
        if (result.status === "success" && searchWasRequired && !searchWasCalled) {
          const warningNote = "\n\n[UCA] 注意：未能确认调用了网络搜索，结果可能不是最新的。";
          yield { event_type: "step_finished", payload: { step: "tool_planner", progress: 0.95 } };
          yield { event_type: "inline_result", payload: { text: (result.final_text || "Done.") + warningNote } };
          yield { event_type: "partial_success", payload: { text: (result.final_text || "Done.") + warningNote } };
          return;
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
  const registry = runtime.actionToolRegistry ?? createActionToolRegistry(BUILTIN_ACTION_TOOLS);
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

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const decision = await resolvedPlanner({
      task,
      transcript,
      tools: registry.list(),
      iteration,
      runtime
    });

    if (!decision || decision.type === "final") {
      const connectorFinal = latestConnectorFinal(transcript, task.user_command);
      return {
        status: "success",
        final_text: connectorFinal ?? decision?.text ?? "Done.",
        transcript
      };
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
    // proper observations into the next LLM turn (ReAct pattern)
    transcript.push({
      type: "tool_result",
      tool: tool.id,
      args: decision.args,
      success: result.success,
      observation: result.observation,
      metadata: result.metadata
    });

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
