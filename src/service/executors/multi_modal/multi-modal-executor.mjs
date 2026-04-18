/**
 * Multi-Modal Executor — sends images to Vision APIs (Claude / OpenAI).
 * Reads provider+model from config (custom providers + task routing) on each call.
 * If a code_cli provider is configured for vision, delegates to Kimi-style subprocess.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { resolveProviderForTask, buildKimiRuntimeFromProvider } from "../shared/provider-resolver.mjs";
import { executeKimiTask } from "../kimi/kimi-cli-executor.mjs";
import { buildKimiTaskPackage } from "../kimi/task-package-builder.mjs";
import { mkdir } from "node:fs/promises";
import os from "node:os";

// CLIs that don't actually process image bytes. Claude Code / Codex / Kimi
// Code / OpenCode / Cursor Agent / Aider are text-only coding assistants.
// Gemini CLI + CodeBuddy and a few others DO have vision, so we whitelist
// those as "vision-capable CLIs" and let them go through.
function isVisionCapableCli(command = "") {
  return /(gemini|codebuddy|qwen)(\.exe)?$/i.test(`${command ?? ""}`);
}

// Find a vision-capable API provider among the user's configured providers —
// used as a fallback when Vision routing points at a non-vision CLI.
function findFallbackVisionApiProvider() {
  try {
    const configPath = process.env.UCA_CONFIG_PATH
      ?? path.join(os.homedir(), "AppData", "Roaming", "UCA", "config", "runtime.json");
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const providers = config.ai?.customProviders ?? [];
    // Native Anthropic first (Claude API does vision on every model), then
    // OpenAI-kind providers with vision-capable baseUrls (OpenAI, Gemini,
    // Zhipu GLM-4V, Qwen-VL, Mistral Pixtral, OpenRouter, SiliconFlow).
    const anthropic = providers.find((p) => p.kind === "anthropic" && p.apiKey);
    if (anthropic) return anthropic;
    const visionOpenai = providers.find((p) => {
      if (p.kind !== "openai" || !p.apiKey) return false;
      const fp = `${p.baseUrl ?? ""} ${p.defaultModel ?? ""} ${p.name ?? ""}`.toLowerCase();
      return /api\.openai\.com|generativelanguage|gemini|glm|qwen|pixtral|mistral|openrouter|siliconflow|gpt-4o|gpt-4-vision/.test(fp);
    });
    return visionOpenai ?? null;
  } catch {
    return null;
  }
}

function defaultVisionModelForProvider(provider) {
  const fp = `${provider.baseUrl ?? ""} ${provider.defaultModel ?? ""}`.toLowerCase();
  if (provider.kind === "anthropic") return provider.defaultModel || "claude-sonnet-4-5-20250514";
  if (/generativelanguage|gemini/.test(fp)) return provider.defaultModel || "gemini-2.0-flash";
  if (/glm|bigmodel|zhipu/.test(fp)) return provider.defaultModel || "glm-4v-plus";
  if (/qwen|dashscope/.test(fp)) return provider.defaultModel || "qwen-vl-max";
  if (/mistral/.test(fp)) return provider.defaultModel || "pixtral-large-latest";
  if (/openrouter/.test(fp)) return provider.defaultModel || "openai/gpt-4o";
  return provider.defaultModel || "gpt-4o";
}

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
      let provider = resolveProviderForTask("vision");
      if (!provider) {
        yield { event_type: "success", payload: { text: "No Vision-capable provider configured. Open Console → Settings to add one." } };
        return;
      }

      // If the routed provider is a code_cli that doesn't handle images
      // natively (Claude Code / Codex / Kimi / OpenCode / Cursor / Aider —
      // these are coding assistants, not vision models), try to fall back
      // to any vision-capable API provider the user has configured.
      if (provider.kind === "code_cli" && !isVisionCapableCli(provider.command)) {
        const fallback = findFallbackVisionApiProvider();
        if (fallback) {
          yield { event_type: "log", payload: { message: `${provider.providerName ?? "Code CLI"} 不处理图片 — 自动降级到 ${fallback.name}。` } };
          provider = {
            id: fallback.kind,
            configId: fallback.id ?? fallback.kind,
            kind: fallback.kind,
            apiKey: fallback.apiKey,
            baseUrl: fallback.baseUrl,
            model: defaultVisionModelForProvider(fallback),
            providerName: fallback.name
          };
        } else {
          yield {
            event_type: "success",
            payload: {
              text: `⚠️ ${provider.providerName ?? "当前 CLI"} 不支持图片理解（Claude Code / Codex / Kimi Code 等是编程助手，不读图）。\n\n` +
                    `请在 Console → Settings → Providers 里为 Vision/Image 配置一个视觉 API：\n` +
                    `• Anthropic（Claude API，每个模型都支持图片）\n` +
                    `• OpenAI（gpt-4o）\n` +
                    `• Google Gemini（gemini-2.0-flash 等）\n` +
                    `• 智谱 GLM-4V / 阿里 Qwen-VL / Mistral Pixtral\n` +
                    `配好后重新拖入图片即可。`
            }
          };
          return;
        }
      }

      // If routed to a code_cli provider that IS vision-capable (Gemini,
      // CodeBuddy, Qwen), run it as a subprocess.
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
