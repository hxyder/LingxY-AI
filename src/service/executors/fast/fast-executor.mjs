/**
 * Fast Executor — lightweight LLM API calls for conversational tasks.
 * Reads provider+model from config (custom providers + task routing) on each call.
 * If a code_cli provider is configured for chat, delegates to Kimi-style subprocess.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveProviderForTask, buildKimiRuntimeFromProvider } from "../shared/provider-resolver.mjs";
import { executeKimiTask } from "../kimi/kimi-cli-executor.mjs";
import { buildKimiTaskPackage } from "../kimi/task-package-builder.mjs";
import { applyReasoningSelectionToBody } from "../../../shared/provider-catalog.mjs";

function buildMessages(task) {
  const parts = [];

  const contextText = task.context_packet?.text?.trim() ?? "";
  const filePaths = task.context_packet?.file_paths ?? [];
  const url = task.context_packet?.url?.trim() ?? "";

  if (contextText) {
    parts.push(`Context:\n${contextText.slice(0, 8000)}`);
  }
  if (filePaths.length > 0) {
    parts.push(`Files:\n${filePaths.join("\n")}`);
  }
  if (url) {
    parts.push(`URL: ${url}`);
  }

  const userContent = parts.length > 0
    ? `${task.user_command}\n\n${parts.join("\n\n")}`
    : task.user_command;

  return [
    {
      role: "system",
      content: "You are UCA, a fast desktop assistant. Reply concisely and directly. Use the user's language. Do not wrap answers in code fences unless asked."
    },
    {
      role: "user",
      content: userContent
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
