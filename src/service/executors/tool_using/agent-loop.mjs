import crypto from "node:crypto";
import { createActionToolRegistry } from "../../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../action_tools/tools/index.mjs";
import { validateToolCall } from "./tool-call-validator.mjs";
import { extractFirstTier0Action, hasCompoundIntent } from "../../core/router/fast-path-router.mjs";

function nowIso() {
  return new Date().toISOString();
}

function defaultPlanner({ task }) {
  const text = task.user_command.toLowerCase();
  const deterministic = planDeterministicToolCall(task.user_command);
  if (deterministic) return deterministic;

  if (text.includes("邮件") || text.includes("email")) {
    return {
      type: "tool_call",
      tool: "compose_email",
      args: {
        to: ["advisor@example.com"],
        subject: "UCA Draft",
        body: task.context_packet.text ?? "Generated draft."
      }
    };
  }

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

function planDeterministicToolCall(userCommand = "") {
  const text = String(userCommand ?? "").trim();
  const url = extractUrl(text);
  if (url && /(打开|访问|open|visit|go to|网页|网站|链接|url)/i.test(text)) {
    return {
      type: "tool_call",
      tool: "open_url",
      args: { url }
    };
  }

  if (/(邮件|email)/i.test(text) || isSearchOrNewsRequest(text)) {
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

function isSearchOrNewsRequest(value = "") {
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
      messages.push({
        role: "user",
        content: `[Tool observation: ${entry.tool}]\n${entry.observation ?? "(no result)"}${successNote}`
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
  // dynamic import to avoid circular dep
  const deterministic = planDeterministicToolCall(task.user_command);
  if (deterministic) return deterministic;

  // UCA-054/039: Enforce web search for current-data requests before trying LLM.
  // Both explicit TaskSpec flag and heuristic text detection trigger this.
  const needsCurrentData = task.task_spec?.needs_current_web_data === true
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
    return defaultPlanner({ task });
  }

  const toolList = tools.map((t) => `- ${t.id}: ${t.description ?? ""}`).join("\n");
  const maxIter = 8;

  // UCA-039: Inject a hard requirement when the task spec flags current web data as needed.
  const needsCurrentDataInstruction = (task.task_spec?.needs_current_web_data === true)
    ? "\n\nREQUIRED: You MUST call web_search_fetch before answering. Do NOT answer from memory for current-events questions. Failure to call web_search_fetch will result in a partial_success downgrade."
    : "";

  // UCA-063: Override instruction when refusal retry is active.
  const forceToolInstruction = task.__forceToolUse
    ? "\n\nCRITICAL OVERRIDE: You MUST call a tool. Saying 'I cannot operate your computer' or any similar refusal is STRICTLY FORBIDDEN. You have tools available — use them. The user is on a desktop computer and you have launch_app, open_url, and other action tools."
    : "";

  const systemPrompt = `You are UCA, a thoughtful desktop AI assistant. You are caring, proactive, and always consider the user's real needs. You can perform actions on the user's computer using the tools below.

Available tools:
${toolList}

Key tool schemas:
- launch_app: { "app": "<app name>" }
- open_url: { "url": "https://..." }
- web_search_fetch: { "query": "...", "recency": "day"|"week"|"month"|"year" } — search the real-time web; ALWAYS use this for current information
- open_file: { "path": "C:\\\\path\\\\to\\\\file" }
- verify_file_exists: { "path": "..." } — check before claiming a file was created
- find_recent_files: { "kind": "pptx"|"docx"|"xlsx"|"pdf", "limit": 5 }
- compose_email: { "to": "...", "subject": "...", "body": "..." }
- notify: { "title": "...", "body": "..." }
- copy_to_clipboard: { "content": "..." }

Decision rules:
1. PERFORM actions (open, launch, copy, notify, search) — call the matching tool immediately. NEVER say you "cannot" do something you have a tool for.
2. SEARCH requests (flights, hotels, weather, news, prices, "查一下", "Google", "search for") → call web_search_fetch FIRST with a good query; NEVER answer from memory for real-time information.
3. After web_search_fetch returns results, extract the most relevant URLs from the observations. If the user wants to open a site, pick the most relevant URL from your search results and call open_url.
4. MISSING INFORMATION: If the user's request is under-specified (e.g. "find flights" without a departure city), ask ONE clarifying question in your final answer BEFORE calling any tool. Format: {"final": "请问您从哪个城市出发？"}
5. After a tool succeeds, use its observation to formulate a helpful answer. Include key facts (price, time, link) from the search results.
6. If a tool returns success:false, acknowledge the failure — do NOT claim success.
7. Never repeat the exact same tool+args you already tried.
8. Maximum ${maxIter} tool calls. End early when the task is clearly done.
9. CONTEXT: If the conversation history contains previous search results or URLs, use them when the user asks to "open the appropriate one" or refers to "that website".
${needsCurrentDataInstruction}${forceToolInstruction}
Respond ONLY with a single JSON object (no markdown, no code fences):
- Call a tool:       {"tool": "tool_id", "args": { ... }}
- Ask clarification: {"final": "your clarifying question"}
- Finish with answer: {"final": "your reply in the user's language (Chinese if they wrote Chinese)"}`;

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
    if (jsonMatch) cleaned = jsonMatch[0];

    const parsed = JSON.parse(cleaned);

    if (parsed.tool) {
      return { type: "tool_call", tool: parsed.tool, args: parsed.args ?? {} };
    }
    if (parsed.final) {
      return { type: "final", text: parsed.final };
    }
    return { type: "final", text: resultText };
  } catch (error) {
    // LLM call failed or returned non-JSON — give up gracefully with a final message
    return { type: "final", text: `I couldn't determine how to handle this request. (planner error: ${error.message})` };
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

      try {
        const result = await runToolAgentLoop({
          task,
          runtime,
          planner: llmPlanner
        });

        // UCA-039: Verify that web_search_fetch was actually called when the task
        // spec requires current web data. If the LLM skipped the search and answered
        // from memory, downgrade to partial_success so the user knows the result
        // may not reflect the latest information.
        const searchWasRequired = task.task_spec?.needs_current_web_data === true
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
        observation: t0result.observation ?? ""
      });
      seenCalls.add(`${tier0.tool}::${JSON.stringify(tier0.args)}`);
    }
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const decision = await resolvedPlanner({
      task,
      transcript,
      tools: registry.list(),
      iteration
    });

    if (!decision || decision.type === "final") {
      return {
        status: "success",
        final_text: decision?.text ?? "Done.",
        transcript
      };
    }

    // Dedupe: if the planner is asking for the same tool+args we already executed, treat as final
    const callKey = `${decision.tool}::${JSON.stringify(decision.args ?? {})}`;
    if (seenCalls.has(callKey)) {
      return {
        status: "success",
        final_text: transcript.length > 0
          ? transcript.filter((e) => e.type === "tool_result").map((e) => e.observation).join("\n")
          : "Done.",
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
      observation: result.observation
    });

    // For the keyword planner, return after one tool call (it doesn't read history)
    if (planner === defaultPlanner) {
      return {
        status: "success",
        final_text: result.observation,
        transcript,
        artifacts: result.artifact_paths ?? []
      };
    }
    // For the LLM planner, continue the loop — it will see the result in transcript
    // and decide whether to call another tool or finish.
  }

  // Reached max iterations — synthesize whatever we have
  const lastObservation = [...transcript].reverse().find((e) => e.type === "tool_result")?.observation;
  return {
    status: "success",
    final_text: lastObservation || "Done (max iterations reached).",
    transcript
  };
}
