/**
 * Fast Executor — lightweight LLM API calls for conversational tasks.
 * Reads provider+model from config (custom providers + task routing) on each call.
 * If a code_cli provider is configured for chat, delegates to Kimi-style subprocess.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveProviderForTask, buildKimiRuntimeFromProvider } from "../shared/provider-resolver.mjs";
import { formatResourceContext, formatUntrustedSourceMaterial } from "../shared/resource-context.mjs";
import { executeKimiTask } from "../kimi/kimi-cli-executor.mjs";
import { buildKimiTaskPackage } from "../kimi/task-package-builder.mjs";
import { applyReasoningSelectionToBody } from "../../../shared/provider-catalog.mjs";

/**
 * Build the chat messages array for the fast executor. Exported so the
 * P4-00.5 verifier can assert the actual array structure (system content
 * carries trusted resource context only; user content carries the user
 * command plus the untrusted-source-material block when ctx.text/url is
 * present).
 *
 * @param {object} task
 */
export function buildMessages(task) {
  const filePaths = task.context_packet?.file_paths ?? [];

  // System: trusted ambient facts only — clock, location, attached file
  // paths, connected accounts. NEVER ctx.text or page-content; that goes
  // to the user side wrapped in <untrusted_source>.
  //
  // P4-RQ G5d: explicit no-tools clause. Fast executor passes ZERO
  // tools to the model. Without this clause the model used to fabricate
  // tool-action claims ("让我查一下", "I'll search the web") and the
  // task would mark success with no actual query happening (the user-
  // reported reproduction).
  const baseSystem = "You are UCA, a fast desktop assistant. Reply concisely and directly. Use the user's language. Do not wrap answers in code fences unless asked.\n\nYou have NO tools available in this fast mode. Do NOT promise to search, query, fetch live data, browse, or perform any external action. If the user is asking for current information or external data and you cannot answer from your training, say honestly that this assistant mode cannot perform live queries and suggest they retry with the tool-using path.";
  const resourceContext = formatResourceContext(task);

  // User: command + optional file-path list (still trusted, just placed
  // in user role for proximity to the request) + optional untrusted block
  // for ctx.text / url. The untrusted block has its own fencing + guard
  // sentence; we don't add another "Context:" prefix because the fencing
  // already disambiguates it from the user's actual instruction.
  const userParts = [task.user_command];
  if (filePaths.length > 0) {
    userParts.push(`Files:\n${filePaths.join("\n")}`);
  }
  const untrusted = formatUntrustedSourceMaterial(task);
  if (untrusted) {
    userParts.push(untrusted);
  }

  return [
    {
      role: "system",
      content: `${baseSystem}\n${resourceContext}`
    },
    {
      role: "user",
      content: userParts.join("\n\n")
    }
  ];
}

async function callAnthropic({ apiKey, baseUrl, model, messages, signal }) {
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsgs = messages.filter((m) => m.role !== "system");

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemMsg,
      messages: userMsgs
    }),
    signal
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content
    ?.filter((block) => block.type === "text")
    ?.map((block) => block.text)
    ?.join("\n") ?? "";
}

async function callOpenAICompatible({ provider, apiKey, baseUrl, model, messages, signal }) {
  const body = {
    model,
    messages,
    max_tokens: 2048
  };
  applyReasoningSelectionToBody(body, provider, model, provider?.reasoningEffort ?? "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`API error ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOllama({ baseUrl, model, messages, signal }) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.message?.content ?? "";
}

/**
 * P4-RQ G5b: pre-LLM short-circuit for routing-degraded research tasks.
 *
 * Conditions (all must hold):
 *   1. routing_status != "ok" — SR couldn't run (sr_timeout /
 *      sr_no_provider / sr_unsupported_provider / etc.).
 *   2. Some research-class structural signal is present —
 *      explicit_search OR explicit_external OR weak_freshness on
 *      the research_quality decision input. We read these via
 *      task.task_spec.research_signals_present (stamped in
 *      createTaskSpec).
 *
 * When both hold, the fast executor refuses to fabricate a live-
 * lookup answer. No LLM call. No model gets to claim "let me search".
 *
 * Reads framework state only — no topic regex.
 */
function shouldShortCircuitForRoutingDegraded(task) {
  const status = task?.task_spec?.routing_status;
  if (!status || status === "ok") return false;
  return Boolean(task?.task_spec?.research_signals_present);
}

/**
 * P4-RQ G5c: post-LLM truthfulness guard. Detects unbacked-claim
 * patterns in the model's output that would only be true if the
 * fast executor actually had tools (which it doesn't). Mirrors
 * detectUnbackedConnectorClaim in tool_using/agent-loop. These
 * regexes are output-side truthfulness assertions, NOT input-side
 * topic regex — they describe what the fast executor cannot have
 * done, not what the user asked.
 *
 * If matched, caller downgrades to partial_success with an honest
 * message instead of letting "我帮你查一下" propagate as a success.
 */
const FAST_UNBACKED_CLAIM_PATTERNS = Object.freeze([
  // Chinese: "让我帮你查/搜/搜索/查询/检索 ..." or future-tense
  // claims of an action the fast executor cannot have performed.
  /(让我|让我帮你|帮你|我现在|正在|马上|稍等)\s*(查(?:一下|一下子|看|阅|找)?|搜(?:索|一下)?|搜寻|查询|检索|获取|抓取|访问|打开网页|浏览|联网)/,
  // English equivalents.
  /\b(I'?ll|I am going to|I'?m going to|let me|hold on while I|stand by while I)\s+(check|search|look it up|fetch|query|browse|go online|visit|access)\b/i,
  /\b(searching|querying|fetching|browsing|looking it up|accessing the web)\b/i
]);

function detectFastUnbackedClaim(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return FAST_UNBACKED_CLAIM_PATTERNS.some((re) => re.test(text));
}

export function createFastExecutorScaffold() {
  return {
    id: "fast",
    model: "dynamic",
    supportsStreaming: true,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Fast executor cancelled before start."), { code: "ABORT_ERR" });
      }

      // P4-RQ G5b: pre-LLM short-circuit. When SR couldn't run
      // AND structural research signals are present, refuse to
      // fabricate a live-lookup answer. No model call. No
      // possibility of "I'll search" claims.
      if (shouldShortCircuitForRoutingDegraded(task)) {
        const status = task.task_spec.routing_status;
        const honestText = "我无法在快速模式下进行实时搜索（路由层暂不可用：" + status + "）。请稍后重试，或改用工具执行模式。\n\nI cannot perform a live web lookup in this fast mode (routing degraded: " + status + "). Please retry shortly, or rephrase to use the tool-using executor.";
        yield {
          event_type: "step_finished",
          payload: { step: "fast_executor", progress: 0.95 }
        };
        yield {
          event_type: "inline_result",
          payload: { text: honestText }
        };
        yield {
          event_type: "partial_success",
          payload: {
            text: honestText,
            routing_degraded: true,
            routing_status: status
          }
        };
        return;
      }

      // Resolve provider dynamically on each call (config may have changed)
      const provider = resolveProviderForTask("chat");
      if (!provider) {
        yield { event_type: "success", payload: { text: "No AI provider configured. Open Console → Settings to add one." } };
        return;
      }

      // If routed to a code_cli provider, run it as a subprocess
      if (provider.kind === "code_cli") {
        yield { event_type: "log", payload: { message: `Delegating chat to ${provider.providerName}...` } };
        const kimiRuntime = buildKimiRuntimeFromProvider(provider);
        const outputDir = path.join(os.tmpdir(), "uca-chat-out", `${task.task_id}`);
        await mkdir(outputDir, { recursive: true });
        const taskPackage = buildKimiTaskPackage({ task, outputDir });

        let cliResultText = "";
        try {
          const exec = await executeKimiTask({
            command: kimiRuntime.command,
            args: kimiRuntime.args,
            env: kimiRuntime.env,
            taskPackage,
            transport: kimiRuntime.transport,
            model: kimiRuntime.model,
            reasoningEffort: kimiRuntime.reasoningEffort ?? "",
            maxRuntimeSeconds: 600,
            abortSignal: signal,
            onEvent(event) {
              if (event.type === "inline_result" && event.text) cliResultText = event.text;
            }
          });
          if (exec.status !== "success") {
            throw new Error(`Code CLI failed (exit ${exec.exitCode ?? "?"})`);
          }
        } catch (error) {
          yield { event_type: "success", payload: { text: `Code CLI failed: ${error.message}` } };
          return;
        }

        yield { event_type: "inline_result", payload: { text: cliResultText || "(no output)" } };
        yield { event_type: "success", payload: { text: cliResultText || "(no output)" } };
        return;
      }

      yield {
        event_type: "step_started",
        payload: { step: "fast_executor", progress: 0.1 }
      };

      const messages = buildMessages(task);

      if (signal?.aborted) {
        throw Object.assign(new Error("Fast executor cancelled."), { code: "ABORT_ERR" });
      }

      yield {
        event_type: "log",
        payload: { message: `Calling ${provider.id} (${provider.model})...` }
      };

      let resultText = "";
      try {
        if (provider.id === "anthropic") {
          resultText = await callAnthropic({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
            messages,
            signal
          });
        } else if (provider.id === "ollama") {
          resultText = await callOllama({
            baseUrl: provider.baseUrl,
            model: provider.model,
            messages,
            signal
          });
        } else {
          resultText = await callOpenAICompatible({
            provider,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
            messages,
            signal
          });
        }
      } catch (error) {
        if (error.code === "ABORT_ERR" || error.name === "AbortError") {
          throw Object.assign(new Error("Fast executor cancelled during API call."), { code: "ABORT_ERR" });
        }
        throw error;
      }

      yield {
        event_type: "step_finished",
        payload: { step: "fast_executor", progress: 0.95 }
      };

      // P4-RQ G5c: post-LLM truthfulness guard. Even with the
      // updated system prompt (G5d), some models still emit
      // "让我查一下" / "I'll search" claims. Fast executor has no
      // tools — those claims are unbacked. Downgrade to
      // partial_success with an honest message.
      if (resultText && detectFastUnbackedClaim(resultText)) {
        const honestNote = "\n\n[UCA] 注意：上面的回复声称要执行查询/搜索动作，但 fast 模式没有工具能力，没有真实查询发生。如需联网检索，请改用工具执行模式重试。";
        const augmented = `${resultText}${honestNote}`;
        yield {
          event_type: "inline_result",
          payload: { text: augmented }
        };
        yield {
          event_type: "partial_success",
          payload: {
            text: augmented,
            unbacked_tool_claim: true
          }
        };
        return;
      }

      // emit inline_result for conversational display
      yield {
        event_type: "inline_result",
        payload: { text: resultText || "No response." }
      };

      yield {
        event_type: "success",
        payload: { text: resultText || "No response.", summary: resultText.slice(0, 200) }
      };
    }
  };
}
