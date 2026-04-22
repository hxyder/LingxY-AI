// Standalone LLM client used when the desktop runtime is unavailable.
// Calls Anthropic / OpenAI / Gemini directly from the extension service
// worker; supports simple text-in text-out turns.
//
// Security note: the API key lives in chrome.storage.local. We never log it.
// CORS: Anthropic requires the "anthropic-dangerous-direct-browser-access"
// header; OpenAI and Gemini allow CORS from extension origins by default.

export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4310";

export async function loadStandaloneConfig(chromeApi = chrome) {
  const data = await chromeApi.storage.local.get("ucaStandaloneConfig");
  return data.ucaStandaloneConfig ?? null;
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

// Most providers below speak the OpenAI /chat/completions shape — same
// request body, same response shape, just a different endpoint + auth header.
// PROVIDER_CONFIGS collects them in one table so adding a new one is a
// one-line change.
export const PROVIDER_CONFIGS = Object.freeze({
  openai:      { label: "OpenAI",                endpoint: "https://api.openai.com/v1/chat/completions",                    defaultModel: "gpt-4o",                     authStyle: "bearer" },
  deepseek:    { label: "DeepSeek",              endpoint: "https://api.deepseek.com/chat/completions",                     defaultModel: "deepseek-chat",              authStyle: "bearer" },
  doubao:      { label: "豆包 (火山方舟 Ark)",    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",     defaultModel: "doubao-seed-2-0-lite-260215", authStyle: "bearer" },
  moonshot:    { label: "Moonshot (Kimi)",       endpoint: "https://api.moonshot.cn/v1/chat/completions",                   defaultModel: "moonshot-v1-8k",             authStyle: "bearer" },
  qwen:        { label: "通义千问 (DashScope)",   endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: "qwen-turbo",            authStyle: "bearer" },
  zhipu:       { label: "智谱 GLM",              endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",         defaultModel: "glm-4-flash",                authStyle: "bearer" },
  siliconflow: { label: "硅基流动 SiliconFlow",   endpoint: "https://api.siliconflow.cn/v1/chat/completions",                defaultModel: "deepseek-ai/DeepSeek-V2.5",  authStyle: "bearer" },
  yi:          { label: "零一万物 Yi",            endpoint: "https://api.lingyiwanwu.com/v1/chat/completions",               defaultModel: "yi-large",                   authStyle: "bearer" },
  groq:        { label: "Groq",                  endpoint: "https://api.groq.com/openai/v1/chat/completions",               defaultModel: "llama-3.1-70b-versatile",    authStyle: "bearer" },
  mistral:     { label: "Mistral",               endpoint: "https://api.mistral.ai/v1/chat/completions",                    defaultModel: "mistral-large-latest",       authStyle: "bearer" },
  xai:         { label: "xAI (Grok)",            endpoint: "https://api.x.ai/v1/chat/completions",                          defaultModel: "grok-2-latest",              authStyle: "bearer" },
  perplexity:  { label: "Perplexity",            endpoint: "https://api.perplexity.ai/chat/completions",                    defaultModel: "sonar",                      authStyle: "bearer" },
  openrouter:  { label: "OpenRouter (聚合)",      endpoint: "https://openrouter.ai/api/v1/chat/completions",                 defaultModel: "anthropic/claude-3.5-sonnet", authStyle: "bearer" },
  ollama:      { label: "Ollama (本地)",          endpoint: "http://127.0.0.1:11434/v1/chat/completions",                    defaultModel: "llama3.1",                   authStyle: "none"   }
});

async function callOpenAICompat(config, { apiKey, model, prompt, systemPrompt }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  const headers = { "Content-Type": "application/json" };
  if (config.authStyle === "bearer" && apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || config.defaultModel,
      messages,
      max_tokens: 1024
    })
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

export async function callLLMDirect({ config, prompt, systemPrompt }) {
  const provider = config?.provider;
  // Anthropic and Gemini have their own request/response shapes. Everything
  // else goes through the OpenAI-compatible dispatcher via PROVIDER_CONFIGS.
  try {
    if (provider === "anthropic") {
      if (!config?.apiKey) return { ok: false, error: "no_api_key" };
      return await callAnthropic({ apiKey: config.apiKey, model: config.model, prompt, systemPrompt });
    }
    if (provider === "gemini") {
      if (!config?.apiKey) return { ok: false, error: "no_api_key" };
      return await callGemini({ apiKey: config.apiKey, model: config.model, prompt, systemPrompt });
    }
    const entry = PROVIDER_CONFIGS[provider];
    if (!entry) return { ok: false, error: `unknown_provider:${provider}` };
    if (entry.authStyle !== "none" && !config?.apiKey) return { ok: false, error: "no_api_key" };
    return await callOpenAICompat(entry, { apiKey: config.apiKey, model: config.model, prompt, systemPrompt });
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
      return { prompt: `请分析图片 URL：${selectionState.imageUrl ?? ""}（本独立模式无法直接识图，请基于 URL/上下文推测或告知无法分析）`, systemPrompt: "You describe images concisely." };
    case "uca.explain-page":
    case "explain":
      return { prompt: `请解释下面网页内容的要点，并说明为什么它值得关注。\n\n标题/URL：${contextLine}\n\n内容：${body}`, systemPrompt: "You explain webpages to a curious reader." };
    case "uca.summarize-selection":
    case "summarize":
    default:
      return { prompt: `请总结以下内容并列出关键点（使用 Markdown 的编号列表）：\n\n${body}`, systemPrompt: "You write clear bullet-point summaries." };
  }
}
