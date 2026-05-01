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
import { loadStructuredHistoryFor } from "../shared/conversation-history-loader.mjs";
import { buildSynthesisGuidance } from "../shared/synthesis-prompt.mjs";
import { executeKimiTask } from "../kimi/kimi-cli-executor.mjs";
import { buildKimiTaskPackage } from "../kimi/task-package-builder.mjs";
import { applyReasoningSelectionToBody } from "../../../shared/provider-catalog.mjs";
import { fetchExternal } from "../../core/external-call.mjs";
import { emitTaskEvent as emitRuntimeTaskEvent } from "../../core/task-runtime.mjs";

const FAST_API_FETCH_TIMEOUT_MS = 120_000;

/**
 * Build the chat messages array for the fast executor. Exported so the
 * P4-00.5 verifier can assert the actual array structure (system content
 * carries trusted resource context only; user content carries the user
 * command plus the untrusted-source-material block when ctx.text/url is
 * present).
 *
 * @param {object} task
 */
export function buildMessages(task, opts = {}) {
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

  const untrusted = formatUntrustedSourceMaterial(task);
  const filePart = filePaths.length > 0 ? `Files:\n${filePaths.join("\n")}` : null;

  const runtime = opts.runtime ?? task.__runtime ?? null;
  const modelContextWindow = opts.modelContextWindow ?? 200000;
  const historyResult = runtime
    ? loadStructuredHistoryFor({ runtime, task, executor: "fast", modelContextWindow })
    : { mode: "legacy_fallback", historyMessages: [], currentMessageRendered: null };

  const synthesisGuidance = buildSynthesisGuidance(task?.task_spec);
  const systemContent = synthesisGuidance
    ? `${baseSystem}\n${resourceContext}\n${synthesisGuidance}`
    : `${baseSystem}\n${resourceContext}`;
  const messages = [{ role: "system", content: systemContent }];

  if (historyResult.mode === "structured" && historyResult.currentMessageRendered) {
    for (const m of historyResult.historyMessages) messages.push(m);
    const triggerContent = historyResult.currentMessageRendered.content ?? task.user_command;
    const userParts = [triggerContent];
    if (filePart) userParts.push(filePart);
    if (untrusted) userParts.push(untrusted);
    messages.push({
      role: historyResult.currentMessageRendered.role,
      content: userParts.join("\n\n")
    });
  } else {
    const userParts = [task.user_command];
    if (filePart) userParts.push(filePart);
    if (untrusted) userParts.push(untrusted);
    messages.push({ role: "user", content: userParts.join("\n\n") });
  }

  return messages;
}

async function callAnthropic({ apiKey, baseUrl, model, messages, signal }) {
  const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
  const userMsgs = messages.filter((m) => m.role !== "system");

  const response = await fetchExternal(`${baseUrl}/v1/messages`, {
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
  }, {
    timeoutMs: FAST_API_FETCH_TIMEOUT_MS,
    label: "fast_executor.anthropic",
    httpErrorPrefix: "Anthropic API error"
  });

  const data = await response.json();
  return data.content
    ?.filter((block) => block.type === "text")
    ?.map((block) => block.text)
    ?.join("\n") ?? "";
}

async function callOpenAICompatible({ provider, apiKey, baseUrl, model, messages, signal, onTextDelta }) {
  const body = {
    model,
    messages,
    max_tokens: 2048,
    stream: typeof onTextDelta === "function"
  };
  applyReasoningSelectionToBody(body, provider, model, provider?.reasoningEffort ?? "");
  const response = await fetchExternal(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal
  }, {
    timeoutMs: FAST_API_FETCH_TIMEOUT_MS,
    label: "fast_executor.openai_compatible",
    httpErrorPrefix: "API error"
  });

  if (body.stream) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let fullText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        reader.cancel();
        throw Object.assign(new Error("OpenAI-compatible stream aborted."), { code: "ABORT_ERR" });
      }
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        let data;
        try { data = JSON.parse(raw); } catch { continue; }
        const delta = data.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          fullText += delta;
          onTextDelta(delta);
        }
      }
    }
    return fullText;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callOllama({ baseUrl, model, messages, signal }) {
  const response = await fetchExternal(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false
    }),
    signal
  }, {
    timeoutMs: FAST_API_FETCH_TIMEOUT_MS,
    label: "fast_executor.ollama",
    httpErrorPrefix: "Ollama error"
  });

  const data = await response.json();
  return data.message?.content ?? "";
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

      const messages = buildMessages(task, {
        runtime: task.__runtime ?? null,
        modelContextWindow: provider?.model?.context_window
          ?? provider?.model?.context_length
          ?? provider?.context_window
          ?? 200000
      });

      if (signal?.aborted) {
        throw Object.assign(new Error("Fast executor cancelled."), { code: "ABORT_ERR" });
      }

      yield {
        event_type: "log",
        payload: { message: `Calling ${provider.id} (${provider.model})...` }
      };
      yield {
        event_type: "planner_request_started",
        payload: { executor: "fast", provider: provider.id, model: provider.model }
      };

      let resultText = "";
      const emitTextDelta = (delta) => {
        if (!delta) return;
        if (typeof task.__runtime?.emitTaskEvent === "function") {
          task.__runtime.emitTaskEvent("text_delta", { delta });
          return;
        }
        if (task.__runtime) {
          emitRuntimeTaskEvent({
            runtime: task.__runtime,
            taskId: task.task_id,
            eventType: "text_delta",
            payload: { delta }
          });
        }
      };
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
            signal,
            onTextDelta: emitTextDelta
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
