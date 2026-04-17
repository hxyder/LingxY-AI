/**
 * Multi-Modal Executor — sends images to Vision APIs (Claude / OpenAI).
 * Reads provider+model from config (custom providers + task routing) on each call.
 * If a code_cli provider is configured for vision, delegates to Kimi-style subprocess.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProviderForTask, buildKimiRuntimeFromProvider } from "../shared/provider-resolver.mjs";
import { executeKimiTask } from "../kimi/kimi-cli-executor.mjs";
import { buildKimiTaskPackage } from "../kimi/task-package-builder.mjs";
import { mkdir } from "node:fs/promises";
import os from "node:os";

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml"
  };
  return map[ext] ?? "image/png";
}

async function loadImageAsBase64(imagePath) {
  const buffer = await readFile(imagePath);
  return {
    base64: buffer.toString("base64"),
    mimeType: guessMimeType(imagePath)
  };
}

async function callAnthropicVision({ apiKey, baseUrl, model, userCommand, images, signal }) {
  const content = [];

  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mimeType,
        data: img.base64
      }
    });
  }

  content.push({ type: "text", text: userCommand });

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
      messages: [{ role: "user", content }]
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Anthropic Vision API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.content
    ?.filter((block) => block.type === "text")
    ?.map((block) => block.text)
    ?.join("\n") ?? "";
}

async function callOpenAIVision({ apiKey, baseUrl, model, userCommand, images, signal }) {
  const content = [];

  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
    });
  }

  content.push({ type: "text", text: userCommand });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: "user", content }]
    }),
    signal
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI Vision API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export function createMultiModalExecutorScaffold() {
  return {
    id: "multi_modal",
    model: "dynamic",
    supportsStreaming: true,
    async *execute(task, { signal } = {}) {
      if (signal?.aborted) {
        throw Object.assign(new Error("Multi-modal executor cancelled."), { code: "ABORT_ERR" });
      }

      const imagePaths = task.context_packet?.image_paths ?? [];
      if (imagePaths.length === 0) {
        yield { event_type: "log", payload: { message: "No images provided." } };
        yield { event_type: "success", payload: { text: "No images to analyze." } };
        return;
      }

      // Resolve dynamically — for vision tasks
      const provider = resolveProviderForTask("vision");
      if (!provider) {
        yield { event_type: "success", payload: { text: "No Vision-capable provider configured. Open Console → Settings to add one." } };
        return;
      }

      // If routed to a code_cli provider, run it as a subprocess
      if (provider.kind === "code_cli") {
        yield { event_type: "log", payload: { message: `Delegating to ${provider.providerName}...` } };
        const kimiRuntime = buildKimiRuntimeFromProvider(provider);
        const outputDir = path.join(os.tmpdir(), "uca-vision-out", `${task.task_id}`);
        await mkdir(outputDir, { recursive: true });
        const taskPackage = buildKimiTaskPackage({ task, outputDir });

        let cliResultText = "";
        const pendingEvents = [];
        let resolvePending = null;
        let cliDone = false;
        let cliError = null;
        let cliExec = null;
        const pushCliEvent = (event) => {
          pendingEvents.push(event);
          if (event.type === "inline_result" && event.text) cliResultText = event.text;
          if (resolvePending) {
            const resolve = resolvePending;
            resolvePending = null;
            resolve();
          }
        };
        try {
          const runPromise = executeKimiTask({
            command: kimiRuntime.command,
            args: kimiRuntime.args,
            env: kimiRuntime.env,
            taskPackage,
            transport: kimiRuntime.transport,
            model: kimiRuntime.model,
            maxRuntimeSeconds: 600,
            abortSignal: signal,
            onEvent: pushCliEvent
          }).then((exec) => {
            cliExec = exec;
          }).catch((error) => {
            cliError = error;
          }).finally(() => {
            cliDone = true;
            if (resolvePending) {
              const resolve = resolvePending;
              resolvePending = null;
              resolve();
            }
          });

          while (!cliDone || pendingEvents.length > 0) {
            if (pendingEvents.length > 0) {
              const event = pendingEvents.shift();
              yield { event_type: event.type, payload: event };
              continue;
            }
            await new Promise((resolve) => { resolvePending = resolve; });
          }

          await runPromise;

          if (cliError) {
            throw cliError;
          }
          if (cliExec?.status !== "success") {
            throw new Error(`Code CLI failed (exit ${cliExec?.exitCode ?? "?"})`);
          }
        } catch (error) {
          yield { event_type: "success", payload: { text: `Code CLI vision failed: ${error.message}` } };
          return;
        }

        yield { event_type: "inline_result", payload: { text: cliResultText || "(no output)" } };
        yield { event_type: "success", payload: { text: cliResultText || "(no output)" } };
        return;
      }

      yield {
        event_type: "step_started",
        payload: { step: "load_images", progress: 0.1 }
      };

      // load images as base64
      const images = [];
      for (const imgPath of imagePaths.slice(0, 4)) {
        try {
          const img = await loadImageAsBase64(imgPath);
          images.push(img);
        } catch (error) {
          yield { event_type: "log", payload: { message: `Failed to load ${path.basename(imgPath)}: ${error.message}` } };
        }
      }

      if (images.length === 0) {
        yield { event_type: "success", payload: { text: "Could not load any images." } };
        return;
      }

      if (signal?.aborted) {
        throw Object.assign(new Error("Cancelled."), { code: "ABORT_ERR" });
      }

      yield {
        event_type: "step_started",
        payload: { step: "vision_api_call", progress: 0.3 }
      };

      const userCommand = task.user_command || "Describe this image in detail.";
      const ocrText = task.context_packet?.text?.trim() ?? "";
      const fullCommand = ocrText
        ? `${userCommand}\n\nOCR extracted text (may be partial): ${ocrText}`
        : userCommand;

      yield { event_type: "log", payload: { message: `Calling ${provider.id} Vision (${provider.model})...` } };

      let resultText = "";
      try {
        if (provider.id === "anthropic") {
          resultText = await callAnthropicVision({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
            userCommand: fullCommand,
            images,
            signal
          });
        } else {
          resultText = await callOpenAIVision({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
            userCommand: fullCommand,
            images,
            signal
          });
        }
      } catch (error) {
        if (error.code === "ABORT_ERR" || error.name === "AbortError") {
          throw Object.assign(new Error("Cancelled during API call."), { code: "ABORT_ERR" });
        }
        throw error;
      }

      yield {
        event_type: "step_finished",
        payload: { step: "vision_api_call", progress: 0.95 }
      };

      yield {
        event_type: "inline_result",
        payload: { text: resultText || "No description returned." }
      };

      yield {
        event_type: "success",
        payload: { text: resultText || "No description returned." }
      };
    }
  };
}
