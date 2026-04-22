import {
  DEFAULT_RUNTIME_URL,
  PROVIDER_CONFIGS,
  applyReasoningSelectionToBody,
  normalizeStandaloneConfig
} from "../shared/provider-catalog.js";

// Standalone LLM client used when the desktop runtime is unavailable.
// Calls Anthropic / OpenAI / Gemini directly from the extension service
// worker; supports simple text-in text-out turns.
//
// Security note: the API key lives in chrome.storage.local. We never log it.
// CORS: Anthropic requires the "anthropic-dangerous-direct-browser-access"
// header; OpenAI and Gemini allow CORS from extension origins by default.

export async function loadStandaloneConfig(chromeApi = chrome) {
  const data = await chromeApi.storage.local.get("ucaStandaloneConfig");
  return data.ucaStandaloneConfig ? normalizeStandaloneConfig(data.ucaStandaloneConfig) : null;
}

// Probe the desktop runtime with a short timeout; cache the result for a few
// seconds so rapid context-menu clicks don't each re-ping.
const probeCache = { ok: null, expiresAt: 0 };

export async function isDesktopAvailable(runtimeUrl) {
  const now = Date.now();
  if (probeCache.expiresAt > now) return probeCache.ok;
  const url = (runtimeUrl || DEFAULT_RUNTIME_URL).replace(/\/+$/, "");
  let ok = false;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(t);
    ok = response.ok;
  } catch { ok = false; }
  probeCache.ok = ok;
  probeCache.expiresAt = now + 5000; // 5s cache
  return ok;
}

export function invalidateDesktopProbe() {
  probeCache.expiresAt = 0;
}

// ── Provider-specific call wrappers. Each returns { ok, text, error }. ─────

async function callAnthropic({ apiKey, model, prompt, systemPrompt }) {
  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }]
  };
  if (systemPrompt) body.system = systemPrompt;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    return { ok: false, error: `anthropic_${response.status}:${await response.text().catch(() => "")}` };
  }
  const payload = await response.json();
  const text = payload?.content?.find?.((b) => b.type === "text")?.text ?? "";
  return { ok: true, text };
}

async function callOpenAICompat(config, { apiKey, model, prompt, systemPrompt, reasoningEffort = "" }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  const headers = { "Content-Type": "application/json" };
  if (config.authStyle === "bearer" && apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const body = {
    model: model || config.defaultModel,
    messages,
    max_tokens: 1024
  };
  applyReasoningSelectionToBody(body, {
    provider: config.id ?? "",
    model: body.model,
    reasoningEffort
  });
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    return { ok: false, error: `http_${response.status}:${await response.text().catch(() => "")}` };
  }
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content ?? "";
  return { ok: true, text };
}

async function callGemini({ apiKey, model, prompt, systemPrompt }) {
  const modelName = model || "gemini-1.5-flash";
  const parts = [];
  if (systemPrompt) parts.push({ text: `${systemPrompt}\n\n` });
  parts.push({ text: prompt });
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] })
    }
  );
  if (!response.ok) {
    return { ok: false, error: `gemini_${response.status}:${await response.text().catch(() => "")}` };
  }
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map?.((p) => p.text ?? "").join("") ?? "";
  return { ok: true, text };
}

// ── Vision: Anthropic / Gemini have custom shapes; a subset of OpenAI-
// compatible providers (OpenAI, Doubao Ark, GLM, Qwen, OpenRouter, etc.)
// can read `image_url` content over their chat-completions endpoints.

async function fetchImageAsBase64(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`image_fetch_${response.status}`);
  const blob = await response.blob();
  const mediaType = blob.type || "image/jpeg";
  const buffer = await blob.arrayBuffer();
  // base64 via btoa + String.fromCharCode (chunked to avoid stack overflow)
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mediaType };
}

async function callAnthropicVision({ apiKey, model, prompt, imageUrl }) {
  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  if (!response.ok) return { ok: false, error: `anthropic_vision_${response.status}:${await response.text().catch(() => "")}` };
  const payload = await response.json();
  return { ok: true, text: payload?.content?.find?.((b) => b.type === "text")?.text ?? "" };
}

async function callOpenAICompatVision(config, { apiKey, model, prompt, imageUrl, reasoningEffort = "" }) {
  const headers = { "Content-Type": "application/json" };
  if (config.authStyle === "bearer" && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = {
    model: model || config.defaultModel,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt }
      ]
    }]
  };
  applyReasoningSelectionToBody(body, {
    provider: config.id ?? "",
    model: body.model,
    reasoningEffort
  });
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if (!response.ok) return { ok: false, error: `openai_compat_vision_${response.status}:${await response.text().catch(() => "")}` };
  const payload = await response.json();
  return { ok: true, text: payload?.choices?.[0]?.message?.content ?? "" };
}

function providerSupportsDirectVision(provider = "") {
  return new Set([
    "openai",
    "doubao",
    "gemini",
    "qwen",
    "zhipu",
    "mistral",
    "siliconflow",
    "openrouter",
    "xai"
  ]).has(`${provider ?? ""}`.trim());
}

async function callGeminiVision({ apiKey, model, prompt, imageUrl }) {
  const { base64, mediaType } = await fetchImageAsBase64(imageUrl);
  const modelName = model || "gemini-1.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: prompt }
        ] }]
      })
    }
  );
  if (!response.ok) return { ok: false, error: `gemini_vision_${response.status}:${await response.text().catch(() => "")}` };
  const payload = await response.json();
  return { ok: true, text: payload?.candidates?.[0]?.content?.parts?.map?.((p) => p.text ?? "").join("") ?? "" };
}

export async function callLLMDirectVision({ config, prompt, imageUrl }) {
  const normalizedConfig = normalizeStandaloneConfig(config);
  if (!normalizedConfig?.apiKey) return { ok: false, error: "no_api_key" };
  if (!imageUrl) return { ok: false, error: "no_image_url" };
  try {
    if (normalizedConfig.provider === "anthropic") return await callAnthropicVision({ apiKey: normalizedConfig.apiKey, model: normalizedConfig.model, prompt, imageUrl });
    if (normalizedConfig.provider === "gemini") return await callGeminiVision({ apiKey: normalizedConfig.apiKey, model: normalizedConfig.model, prompt, imageUrl });
    const entry = PROVIDER_CONFIGS[normalizedConfig.provider];
    if (entry && providerSupportsDirectVision(normalizedConfig.provider)) {
      return await callOpenAICompatVision({ ...entry, id: normalizedConfig.provider }, {
        apiKey: normalizedConfig.apiKey,
        model: normalizedConfig.model,
        prompt,
        imageUrl,
        reasoningEffort: normalizedConfig.reasoningEffort
      });
    }
    return { ok: false, error: `vision_unsupported_provider:${normalizedConfig.provider}` };
  } catch (error) {
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }
}

export async function callLLMDirect({ config, prompt, systemPrompt }) {
  const normalizedConfig = normalizeStandaloneConfig(config);
  const provider = normalizedConfig?.provider;
  // Anthropic and Gemini have their own request/response shapes. Everything
  // else goes through the OpenAI-compatible dispatcher via PROVIDER_CONFIGS.
  try {
    if (provider === "anthropic") {
      if (!normalizedConfig?.apiKey) return { ok: false, error: "no_api_key" };
      return await callAnthropic({ apiKey: normalizedConfig.apiKey, model: normalizedConfig.model, prompt, systemPrompt });
    }
    if (provider === "gemini") {
      if (!normalizedConfig?.apiKey) return { ok: false, error: "no_api_key" };
      return await callGemini({ apiKey: normalizedConfig.apiKey, model: normalizedConfig.model, prompt, systemPrompt });
    }
    const entry = PROVIDER_CONFIGS[provider];
    if (!entry) return { ok: false, error: `unknown_provider:${provider}` };
    if (entry.authStyle !== "none" && !normalizedConfig?.apiKey) return { ok: false, error: "no_api_key" };
    return await callOpenAICompat({ ...entry, id: provider }, {
      apiKey: normalizedConfig.apiKey,
      model: normalizedConfig.model,
      prompt,
      systemPrompt,
      reasoningEffort: normalizedConfig.reasoningEffort
    });
  } catch (error) {
    return { ok: false, error: `network_error:${error?.message ?? "unknown"}` };
  }
}

// ── Prompt builders for each quick-action kind ─────────────────────────────

export function buildPromptFor(action, selectionState = {}) {
  const text = (selectionState.text ?? selectionState.selectionText ?? "").trim();
  const url = selectionState.url ?? "";
  const title = selectionState.pageTitle ?? "";
  const contextLine = [title, url].filter(Boolean).join(" · ");
  const body = text || title || url || "";
  switch (action) {
    case "uca.translate-selection":
    case "translate":
      return { prompt: `请把下面这段文字翻译成中文（若本身是中文，则译为英文），只输出翻译结果：\n\n${body}`, systemPrompt: "You are a precise translator." };
    case "uca.fetch-link":
      return { prompt: `请帮我总结链接内容。已知标题/URL：${contextLine}\n内容片段：${body}`, systemPrompt: "You are a concise summarizer." };
    case "uca.inspect-image":
      return { prompt: `请分析这张图片，并直接回答图里有什么、关键文字是什么、是否需要进一步注意细节。图片 URL：${selectionState.imageUrl ?? ""}`, systemPrompt: "You describe images concisely." };
    case "uca.explain-page":
    case "explain":
      return { prompt: `请解释下面网页内容的要点，并说明为什么它值得关注。\n\n标题/URL：${contextLine}\n\n内容：${body}`, systemPrompt: "You explain webpages to a curious reader." };
    case "uca.summarize-selection":
    case "summarize":
    default:
      return { prompt: `请总结以下内容并列出关键点（使用 Markdown 的编号列表）：\n\n${body}`, systemPrompt: "You write clear bullet-point summaries." };
  }
}
