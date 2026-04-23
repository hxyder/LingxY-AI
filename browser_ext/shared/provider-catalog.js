export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4310";

export const PROVIDER_GROUPS = Object.freeze([
  {
    label: "国际",
    providers: [
      { id: "anthropic", label: "Anthropic (Claude)", defaultModel: "claude-sonnet-4-6" },
      { id: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
      { id: "gemini", label: "Google Gemini", defaultModel: "gemini-1.5-flash" },
      { id: "xai", label: "xAI (Grok)", defaultModel: "grok-2-latest" },
      { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest" },
      { id: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile" },
      { id: "perplexity", label: "Perplexity", defaultModel: "sonar" },
      { id: "openrouter", label: "OpenRouter（聚合）", defaultModel: "anthropic/claude-3.5-sonnet" }
    ]
  },
  {
    label: "国内",
    providers: [
      { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
      { id: "doubao", label: "豆包（火山方舟 Ark）", defaultModel: "doubao-seed-2-0-lite-260215" },
      { id: "moonshot", label: "Moonshot (Kimi)", defaultModel: "moonshot-v1-8k" },
      { id: "qwen", label: "通义千问 (DashScope)", defaultModel: "qwen3.6-plus" },
      { id: "zhipu", label: "智谱 GLM", defaultModel: "glm-4-flash" },
      { id: "siliconflow", label: "硅基流动 SiliconFlow", defaultModel: "deepseek-ai/DeepSeek-V2.5" },
      { id: "yi", label: "零一万物 Yi", defaultModel: "yi-large" }
    ]
  },
  {
    label: "本地",
    providers: [
      { id: "ollama", label: "Ollama（本地，无需 Key）", defaultModel: "llama3.1" }
    ]
  }
]);

export const PROVIDER_DEFAULT_MODELS = Object.freeze(
  Object.fromEntries(
    PROVIDER_GROUPS.flatMap((group) => group.providers.map((provider) => [provider.id, provider.defaultModel]))
  )
);

export const PROVIDER_CONFIGS = Object.freeze({
  openai: { label: "OpenAI", endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.openai, authStyle: "bearer" },
  deepseek: { label: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.deepseek, authStyle: "bearer" },
  doubao: { label: "豆包 (火山方舟 Ark)", endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.doubao, authStyle: "bearer" },
  moonshot: { label: "Moonshot (Kimi)", endpoint: "https://api.moonshot.cn/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.moonshot, authStyle: "bearer" },
  qwen: { label: "通义千问 (DashScope)", endpoint: "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.qwen, authStyle: "bearer" },
  zhipu: { label: "智谱 GLM", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.zhipu, authStyle: "bearer" },
  siliconflow: { label: "硅基流动 SiliconFlow", endpoint: "https://api.siliconflow.cn/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.siliconflow, authStyle: "bearer" },
  yi: { label: "零一万物 Yi", endpoint: "https://api.lingyiwanwu.com/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.yi, authStyle: "bearer" },
  groq: { label: "Groq", endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.groq, authStyle: "bearer" },
  mistral: { label: "Mistral", endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.mistral, authStyle: "bearer" },
  xai: { label: "xAI (Grok)", endpoint: "https://api.x.ai/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.xai, authStyle: "bearer" },
  perplexity: { label: "Perplexity", endpoint: "https://api.perplexity.ai/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.perplexity, authStyle: "bearer" },
  openrouter: { label: "OpenRouter (聚合)", endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.openrouter, authStyle: "bearer" },
  ollama: { label: "Ollama (本地)", endpoint: "http://127.0.0.1:11434/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.ollama, authStyle: "none" }
});

export const PROVIDER_MODEL_PRESETS = Object.freeze({
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-5-20250514", "claude-haiku-4-5-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-5"],
  gemini: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-flash"],
  xai: ["grok-2-latest", "grok-vision-beta"],
  mistral: ["mistral-large-latest", "pixtral-large-latest"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  perplexity: ["sonar", "sonar-pro"],
  openrouter: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5", "google/gemini-2.0-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  doubao: ["doubao-seed-2-0-lite-260215", "doubao-seed-2-0-pro-260215", "doubao-seed-2-0-mini-260215"],
  moonshot: ["moonshot-v1-8k", "moonshot-v1-32k", "kimi-k2-0711-preview"],
  qwen: ["qwen3.6-plus", "qwen-plus", "qwen-turbo", "qwen-vl-max"],
  zhipu: ["glm-4-flash", "glm-4-plus", "glm-4v-plus"],
  siliconflow: ["deepseek-ai/DeepSeek-V2.5", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
  yi: ["yi-large", "yi-medium"],
  ollama: ["llama3.1", "llama3.2", "qwen2.5", "llava"]
});

const OPENAI_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "none", label: "None (普通 / 不思考)" },
  { id: "minimal", label: "Minimal (最省)" },
  { id: "low", label: "Low (快速)" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High (深思)" },
  { id: "xhigh", label: "Extra High (最深)" }
]);

const DOUBAO_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "thinking:disabled|minimal", label: "关闭思考 (disabled / minimal)" },
  { id: "thinking:enabled|low", label: "轻量思考 (enabled / low)" },
  { id: "thinking:enabled|medium", label: "均衡思考 (enabled / medium)" },
  { id: "thinking:enabled|high", label: "深度思考 (enabled / high)" }
]);

const QWEN_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "enable_thinking:false", label: "关闭思考" },
  { id: "enable_thinking:true", label: "开启思考" }
]);

function uniqueNonEmpty(values = []) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const value = `${raw ?? ""}`.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function detectModelFamily(model = "") {
  const normalized = `${model ?? ""}`.trim().toLowerCase();
  if (!normalized) return "empty";
  if (/^(gpt-|o[1-9](-|$)|text-davinci|whisper-)/.test(normalized)) return "openai";
  if (/^claude-/.test(normalized)) return "anthropic";
  if (/^gemini-/.test(normalized)) return "gemini";
  if (/^deepseek-/.test(normalized)) return "deepseek";
  if (/^(doubao-|ep-)/.test(normalized)) return "doubao";
  if (/^(kimi-|moonshot-)/.test(normalized)) return "moonshot";
  if (/^qwen/i.test(normalized)) return "qwen";
  if (/^glm-/.test(normalized)) return "zhipu";
  return "unknown";
}

function providerSupportsModel(provider = "", model = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const normalizedModel = `${model ?? ""}`.trim().toLowerCase();
  if (!normalizedModel) return true;
  if (normalizedProvider === "openrouter") return true;

  switch (normalizedProvider) {
    case "anthropic": return /^claude-/.test(normalizedModel);
    case "openai": return /^(gpt-|o[1-9](-|$)|text-davinci|whisper-)/.test(normalizedModel);
    case "gemini": return /^gemini-/.test(normalizedModel);
    case "deepseek": return /^deepseek-/.test(normalizedModel);
    case "doubao": return /^(doubao-|ep-)/.test(normalizedModel);
    case "moonshot": return /^(kimi-|moonshot-)/.test(normalizedModel);
    case "qwen": return /^qwen/i.test(normalizedModel);
    case "zhipu": return /^glm-/.test(normalizedModel);
    case "siliconflow": return !["openai", "anthropic", "gemini", "doubao", "moonshot"].includes(detectModelFamily(normalizedModel));
    default: return detectModelFamily(normalizedModel) !== "openai";
  }
}

export function modelOptionsForProvider(provider = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  return uniqueNonEmpty([
    PROVIDER_DEFAULT_MODELS[normalizedProvider] ?? "",
    ...(PROVIDER_MODEL_PRESETS[normalizedProvider] ?? [])
  ]);
}

export function reasoningOptionsForProvider(provider = "", model = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const normalizedModel = `${model ?? ""}`.trim().toLowerCase();
  if (normalizedProvider === "doubao") return DOUBAO_REASONING_OPTIONS.map((option) => ({ ...option }));
  if (normalizedProvider === "qwen" && /^qwen3/i.test(normalizedModel)) {
    return QWEN_REASONING_OPTIONS.map((option) => ({ ...option }));
  }
  if (normalizedProvider === "openai" && /^(gpt-5|o[1-9](-|$))/.test(normalizedModel)) {
    return OPENAI_REASONING_OPTIONS.map((option) => ({ ...option }));
  }
  return [];
}

export function normalizeReasoningSelection(provider = "", model = "", value = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const normalizedValue = `${value ?? ""}`.trim().toLowerCase();
  if (!normalizedValue) return "";
  if (normalizedValue === "extra_high" || normalizedValue === "extra-high") return "xhigh";
  if (normalizedProvider === "doubao") {
    if (normalizedValue === "thinking:enabled") return "thinking:enabled|medium";
    if (normalizedValue === "thinking:disabled") return "thinking:disabled|minimal";
    if (normalizedValue === "thinking:enabled|minimal") return "thinking:disabled|minimal";
    if (/^thinking:enabled\|(low|medium|high)$/.test(normalizedValue)) return normalizedValue;
    if (normalizedValue === "thinking:disabled|minimal") return normalizedValue;
    return "";
  }
  if (normalizedProvider === "qwen") {
    if (["enable_thinking:true", "thinking:on", "thinking:enabled", "enabled", "true", "on"].includes(normalizedValue)) {
      return "enable_thinking:true";
    }
    if (["enable_thinking:false", "thinking:off", "thinking:disabled", "disabled", "false", "off"].includes(normalizedValue)) {
      return "enable_thinking:false";
    }
    return reasoningOptionsForProvider(normalizedProvider, model).some((option) => option.id === normalizedValue)
      ? normalizedValue
      : "";
  }
  return reasoningOptionsForProvider(normalizedProvider, model).some((option) => option.id === normalizedValue)
    ? normalizedValue
    : "";
}

export function applyReasoningSelectionToBody(body = {}, { provider = "", model = "", reasoningEffort = "" } = {}) {
  const normalized = normalizeReasoningSelection(provider, model, reasoningEffort);
  if (!normalized) return body;
  if (normalized.startsWith("enable_thinking:")) {
    body.enable_thinking = normalized.endsWith(":true");
    return body;
  }
  if (normalized.startsWith("thinking:")) {
    const [thinkingPart, effortPart = ""] = normalized.split("|");
    const thinkingType = thinkingPart.slice("thinking:".length);
    if (thinkingType) body.thinking = { type: thinkingType };
    if (effortPart) body.reasoning_effort = effortPart;
    return body;
  }
  body.reasoning_effort = normalized;
  return body;
}

export function providerSupportsVision(provider = "", model = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const normalizedModel = `${model ?? ""}`.trim().toLowerCase();
  if (["openai", "gemini", "doubao", "qwen", "zhipu", "mistral", "openrouter", "xai", "anthropic", "siliconflow"].includes(normalizedProvider)) return true;
  if (normalizedProvider === "ollama") {
    return /llava|llama-?3\.2.*vision|qwen.*vl|minicpm.*v|bakllava/.test(normalizedModel);
  }
  return false;
}

export function normalizeStandaloneConfig(config = {}) {
  const provider = `${config?.provider ?? "anthropic"}`.trim() || "anthropic";
  const model = `${config?.model ?? ""}`.trim();
  const resolvedModel = !model || !providerSupportsModel(provider, model)
    ? (PROVIDER_DEFAULT_MODELS[provider] ?? "")
    : model;
  const reasoningEffort = normalizeReasoningSelection(provider, resolvedModel, config?.reasoningEffort ?? "");
  return {
    runtimeUrl: `${config?.runtimeUrl ?? DEFAULT_RUNTIME_URL}`.trim() || DEFAULT_RUNTIME_URL,
    provider,
    apiKey: `${config?.apiKey ?? ""}`,
    model: resolvedModel,
    reasoningEffort
  };
}
