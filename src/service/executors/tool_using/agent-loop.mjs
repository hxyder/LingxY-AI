import crypto from "node:crypto";
import { createActionToolRegistry } from "../../action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../action_tools/tools/index.mjs";
import { validateToolCall } from "./tool-call-validator.mjs";

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
  return /(搜索|查找|新闻|消息|要闻|时政|最新|最近|动态|资讯|热点|近况|search|latest|recent|current|news)/i.test(String(value ?? ""));
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

async function llmPlanner({ task, transcript, tools, iteration }) {
  // dynamic import to avoid circular dep
  const deterministic = planDeterministicToolCall(task.user_command);
  if (deterministic) return deterministic;
  if (!transcript.some((entry) => entry.tool === "web_search_fetch") && isSearchOrNewsRequest(task.user_command)) {
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
  const history = buildHistoryString(transcript);

  const systemPrompt = `You are a desktop action agent. You can call tools to help the user, then synthesize the results into a final answer.

Available tools:
${toolList}

Tool argument schemas:
- launch_app: { "app": "outlook" | "word" | "excel" | "powerpoint" | "notepad" | "calc" | "edge" | "chrome" | "firefox" | "vscode" | "paint" }
- open_url: { "url": "https://..." }
- web_search: { "query": "search terms" }   // opens Google in browser, does NOT return content
- web_search_fetch: { "query": "search terms", "recency": "day" | "week" | "month" | "year" } // returns snippets; use for latest/current/news searches
- open_file: { "path": "C:\\\\path\\\\to\\\\file" }
- compose_email: { "to": "addr@x.com" (optional), "subject": "..." (optional), "body": "..." }
- notify: { "title": "...", "body": "..." }
- copy_to_clipboard: { "content": "..." }
- reveal_in_explorer: { "path": "C:\\\\..." }

Decision rules:
1. If the user wants you to PERFORM an action (open, launch, copy, notify), call the matching tool.
2. If the user asks for latest/current/recent information, news, updates, Chinese "新闻/消息/最新/最近/动态/资讯/热点", or explicitly asks to search, call web_search_fetch and include recency when appropriate.
3. After you have already executed a tool that completes the user's request, return {"final": "..."} acknowledging the action.
4. Never call the same tool twice with the same arguments — if a step is done, move on or finish.
5. When summarizing web_search_fetch results, format the final answer with short Chinese sections such as "要点", "来源", and "还需要确认", and keep links readable.
6. Maximum 4 tool calls per task. Prefer ending early.

Respond ONLY with a single JSON object, no markdown, no code fences:
- To call a tool: {"tool": "tool_id", "args": { ... }}
- To finish:    {"final": "your reply to the user"}

User request: ${task.user_command}

History so far:
${history}

This is iteration ${iteration + 1}/4. What's the next step?`;

  try {
    let resultText = "";
    if (provider.kind === "anthropic") {
      const r = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": provider.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: task.user_command }]
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
            { role: "user", content: task.user_command }
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
  maxIterations = 4,
  planner = runtime.toolPlanner ?? defaultPlanner
}) {
  const registry = runtime.actionToolRegistry ?? createActionToolRegistry(BUILTIN_ACTION_TOOLS);
  const transcript = [];
  const seenCalls = new Set(); // dedupe identical tool+args to prevent infinite loops

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const decision = await planner({
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
    transcript.push({
      type: "tool_result",
      tool: tool.id,
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
