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

// True when the configured provider can plausibly handle image bytes.
// Used only for the UI hint in Settings → Routing → Vision — the
// backend does NOT pre-empt based on this, because modern agentic
// CLIs (Claude Code / Codex / Kimi Code / Gemini CLI / etc) all have
// a Read tool that inspects image file paths supplied in the prompt.
// The task package builder threads image_paths into both file_paths
// and the prompt (see print-mode-prompt.mjs:152), so CLIs just
// "open and look" through their normal file-reading flow.
export function providerCanVision(provider) {
  if (!provider) return false;
  if (provider.supportsVision === true) return true;
  if (provider.supportsVision === false) return false;
  if (provider.kind === "anthropic" && provider.apiKey) return true;
  if (provider.kind === "openai" && provider.apiKey) {
    const fp = `${provider.baseUrl ?? ""} ${provider.defaultModel ?? ""} ${provider.name ?? ""}`.toLowerCase();
    return /api\.openai\.com|generativelanguage|gemini|glm|qwen|pixtral|mistral|openrouter|siliconflow|gpt-4o|gpt-4-vision|claude-3|claude-sonnet|claude-opus|doubao|ark|volces/.test(fp);
  }
  // All code_cli providers go through the agent-loop with a Read
  // tool. Trust them — if the CLI genuinely can't (e.g. a stripped-
  // down legacy CLI) the user can set supportsVision: false.
  if (provider.kind === "code_cli") return true;
  if (provider.kind === "ollama") {
    const m = `${provider.defaultModel ?? ""}`.toLowerCase();
    return /llava|llama-?3\.2.*vision|qwen.*vl|minicpm.*v|bakllava/.test(m);
  }
  return false;
}

// Fallback used when the routed provider demonstrably cannot handle
// images (e.g. kind:"ollama" with a text-only model) OR when the user
// explicitly sets supportsVision:false. Fallback candidates must not be
// the current provider and must not carry supportsVision:false.
function sameProvider(candidate = {}, current = {}) {
  if (!candidate || !current) return false;
  const currentId = current.configId ?? current.id ?? null;
  if (candidate.id && currentId) return candidate.id === currentId;
  if (candidate.kind === "code_cli" && current.kind === "code_cli") {
    if (candidate.command && current.command && candidate.command === current.command) return true;
  }
  return false;
}

function findFallbackVisionProvider(currentProvider = null) {
  try {
    const configPath = process.env.UCA_CONFIG_PATH
      ?? path.join(os.homedir(), "AppData", "Roaming", "UCA", "config", "runtime.json");
    if (!existsSync(configPath)) return null;
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const providers = (config.ai?.customProviders ?? [])
      .filter((p) => p?.supportsVision !== false)
      .filter((p) => !sameProvider(p, currentProvider));
    const override = providers.find((p) => p.supportsVision === true);
    if (override) return override;
    const anthropic = providers.find((p) => p.kind === "anthropic" && p.apiKey);
    if (anthropic) return anthropic;
    const visionOpenai = providers.find((p) => {
      if (p.kind !== "openai" || !p.apiKey) return false;
      const fp = `${p.baseUrl ?? ""} ${p.defaultModel ?? ""} ${p.name ?? ""}`.toLowerCase();
      return /api\.openai\.com|generativelanguage|gemini|glm|qwen|pixtral|mistral|openrouter|siliconflow|gpt-4o|gpt-4-vision|doubao|ark|volces/.test(fp);
    });
    if (visionOpenai) return visionOpenai;
    const cli = providers.find((p) => p.kind === "code_cli");
    if (cli) return cli;
    const visionOllama = providers.find((p) => {
      if (p.kind !== "ollama") return false;
      const m = `${p.defaultModel ?? ""}`.toLowerCase();
      return /llava|llama-?3\.2.*vision|qwen.*vl|minicpm.*v|bakllava/.test(m);
    });
    return visionOllama ?? null;
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
  if (/doubao|ark|volces/.test(fp)) return provider.defaultModel || "doubao-seed-2-0-lite-260215";
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

// Exported so the `vision_analyze` action tool can reuse the exact same
// base64 + MIME-detection path without duplicating it. See 架构思路.md
// §12.3.1 — the tool is a tool-backed specialist that delegates the
// transport plumbing to these helpers; it is NOT a generic abstraction.
export async function loadImageAsBase64(imagePath) {
  const buffer = await readFile(imagePath);
  return {
    base64: buffer.toString("base64"),
    mimeType: guessMimeType(imagePath)
  };
}

export async function callAnthropicVision({ apiKey, baseUrl, model, userCommand, images, signal }) {
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

export async function callOpenAIVision({ apiKey, baseUrl, model, userCommand, images, signal }) {
  const content = [];

  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${img.mimeType};base64,${img.base64}`,
        detail: "high"
      }
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

      // Pre-empt ONLY when we can prove the provider can't see images
      // AND the user hasn't opted in with supportsVision:true. The
      // explicit-false opt-out triggers a fallback; everything else —
      // especially code_cli — goes through as configured, because the
      // task package + print-mode prompt give the CLI the image paths
      // and instruct its Read tool to inspect them.
      const mustSwitch = provider.supportsVision === false
        || (provider.kind === "ollama" && !providerCanVision({
          kind: provider.kind,
          defaultModel: provider.model ?? provider.defaultModel
        }));
      if (mustSwitch) {
        const fallback = findFallbackVisionProvider(provider);
        if (fallback) {
          const fromName = provider.providerName ?? provider.command ?? "当前 provider";
          yield { event_type: "log", payload: { message: `${fromName} 标记为不支持图片 — 切到 ${fallback.name ?? fallback.kind}。` } };
          provider = {
            id: fallback.kind,
            configId: fallback.id ?? fallback.kind,
            kind: fallback.kind,
            apiKey: fallback.apiKey,
            baseUrl: fallback.baseUrl,
            command: fallback.command,
            args: fallback.args,
            transport: fallback.transport,
            model: defaultVisionModelForProvider(fallback),
            providerName: fallback.name,
            supportsVision: fallback.supportsVision
          };
        } else {
          yield {
            event_type: "success",
            payload: {
              text: `⚠️ ${provider.providerName ?? "当前 provider"} 标记为不支持图片，且没找到能读图的备选 provider。\n\n` +
                    `在 Console → Settings → Providers 里加一个有视觉能力的 provider，或把 supportsVision:false 标志去掉。`
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
