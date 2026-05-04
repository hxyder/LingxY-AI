export const DEFAULT_RUNTIME_URL = "http://127.0.0.1:4310";

export const PROVIDER_GROUPS = Object.freeze([
  {
    label: "国际",
    providers: [
      { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", endpoint: "https://api.anthropic.com/v1/messages", defaultModel: "claude-sonnet-4-6" },
      { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-5.4-mini" },
      { id: "gemini", label: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", defaultModel: "gemini-2.5-flash" },
      { id: "xai", label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", endpoint: "https://api.x.ai/v1/chat/completions", defaultModel: "grok-4.3" },
      { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-medium-3.5" },
      { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "llama-3.3-70b-versatile" },
      { id: "perplexity", label: "Perplexity", kind: "openai", baseUrl: "https://api.perplexity.ai", endpoint: "https://api.perplexity.ai/chat/completions", defaultModel: "sonar" },
      { id: "openrouter", label: "OpenRouter（聚合）", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "anthropic/claude-sonnet-4.6" }
    ]
  },
  {
    label: "国内",
    providers: [
      { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", endpoint: "https://api.deepseek.com/chat/completions", defaultModel: "deepseek-v4-flash" },
      { id: "doubao", label: "豆包（火山方舟 Ark）", kind: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions", defaultModel: "doubao-seed-2-0-lite-260215" },
      { id: "moonshot", label: "Moonshot (Kimi)", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", endpoint: "https://api.moonshot.cn/v1/chat/completions", defaultModel: "kimi-k2.6" },
      { id: "qwen", label: "通义千问 (DashScope)", kind: "openai", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1", endpoint: "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: "qwen3.6-plus" },
      { id: "zhipu", label: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions", defaultModel: "glm-4-plus" },
      { id: "siliconflow", label: "硅基流动 SiliconFlow", kind: "openai", baseUrl: "https://api.siliconflow.cn/v1", endpoint: "https://api.siliconflow.cn/v1/chat/completions", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
      { id: "yi", label: "零一万物 Yi", kind: "openai", baseUrl: "https://api.lingyiwanwu.com/v1", endpoint: "https://api.lingyiwanwu.com/v1/chat/completions", defaultModel: "yi-large" }
    ]
  },
  {
    label: "本地",
    providers: [
      { id: "ollama", label: "Ollama（本地，无需 Key）", kind: "ollama", baseUrl: "http://127.0.0.1:11434", endpoint: "http://127.0.0.1:11434/v1/chat/completions", defaultModel: "llama3.2" }
    ]
  }
]);

export const PROVIDER_DEFAULT_MODELS = Object.freeze(
  Object.fromEntries(
    PROVIDER_GROUPS.flatMap((group) => group.providers.map((provider) => [provider.id, provider.defaultModel]))
  )
);

export const PROVIDER_CONFIGS = Object.freeze(
  Object.fromEntries(
    PROVIDER_GROUPS.flatMap((group) => group.providers.map((provider) => [provider.id, {
      ...provider,
      authStyle: provider.id === "ollama" ? "none" : "bearer"
    }]))
  )
);

export function providerRequiresApiKey(provider = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const config = PROVIDER_CONFIGS[normalizedProvider];
  return !config || config.authStyle !== "none";
}

export function isStandaloneProviderConfigured(config = {}) {
  const normalizedConfig = normalizeStandaloneConfig(config);
  if (!normalizedConfig.provider) return false;
  if (!providerRequiresApiKey(normalizedConfig.provider)) return true;
  return Boolean(`${normalizedConfig.apiKey ?? ""}`.trim());
}

export function standaloneProviderSetupReason(config = {}) {
  const normalizedConfig = normalizeStandaloneConfig(config);
  if (!PROVIDER_CONFIGS[normalizedConfig.provider]) return "unknown_provider";
  if (!providerRequiresApiKey(normalizedConfig.provider)) return "";
  return `${normalizedConfig.apiKey ?? ""}`.trim() ? "" : "missing_api_key";
}

export const PROVIDER_MODEL_PRESETS = Object.freeze({
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-haiku-4-5"],
  openai: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-4.1"],
  gemini: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  xai: ["grok-4.3", "grok-4.3-latest", "grok-4", "grok-4-latest"],
  mistral: ["mistral-medium-3.5", "mistral-large-2512", "mistral-small-2603", "mistral-large-latest", "mistral-small-latest"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  perplexity: ["sonar", "sonar-pro"],
  openrouter: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro-preview", "x-ai/grok-4.3"],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
  doubao: ["doubao-seed-2-0-lite-260215", "doubao-seed-2-0-pro-260215", "doubao-seed-2-0-mini-260215"],
  moonshot: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-thinking", "kimi-k2-thinking-turbo", "moonshot-v1-128k"],
  qwen: ["qwen3.6-plus", "qwen-plus", "qwen-turbo", "qwen-vl-max"],
  zhipu: ["glm-4-plus", "glm-4-flash", "glm-4v-plus"],
  siliconflow: ["Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V2.5"],
  yi: ["yi-large", "yi-medium"],
  ollama: ["llama3.2", "llama3.1", "qwen2.5", "llava"]
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

export const STALE_MODEL_IDS_BY_FAMILY = Object.freeze({
  moonshot: Object.freeze(["kimi-latest", "kimi-thinking-preview"]),
  mistral: Object.freeze(["mistral-medium-3-5"])
});

function isKnownStaleModelForProvider(provider = "", model = "") {
  const normalizedProvider = `${provider ?? ""}`.trim();
  const normalizedModel = `${model ?? ""}`.trim().toLowerCase();
  if (!normalizedProvider || !normalizedModel) return false;
  return (STALE_MODEL_IDS_BY_FAMILY[normalizedProvider] ?? []).includes(normalizedModel);
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
    case "deepseek":
      if (normalizedModel === "deepseek-chat" || normalizedModel === "deepseek-reasoner") return false;
      return /^deepseek-/.test(normalizedModel);
    case "doubao": return /^(doubao-|ep-)/.test(normalizedModel);
    case "moonshot":
      if (isKnownStaleModelForProvider(normalizedProvider, normalizedModel)) return false;
      return /^(kimi-|moonshot-)/.test(normalizedModel);
    case "qwen": return /^qwen/i.test(normalizedModel);
    case "zhipu": return /^glm-/.test(normalizedModel);
    case "siliconflow": return !["openai", "anthropic", "gemini", "doubao", "moonshot"].includes(detectModelFamily(normalizedModel));
    case "mistral":
      if (isKnownStaleModelForProvider(normalizedProvider, normalizedModel)) return false;
      return /^(mistral-|magistral-|ministral-|codestral-|devstral-|voxtral-|pixtral-)/.test(normalizedModel);
    default: return detectModelFamily(normalizedModel) !== "openai";
  }
}

export function modelOptionsForProvider(provider = "", discovered = []) {
  const normalizedProvider = `${provider ?? ""}`.trim();
  return uniqueNonEmpty([
    PROVIDER_DEFAULT_MODELS[normalizedProvider] ?? "",
    ...(PROVIDER_MODEL_PRESETS[normalizedProvider] ?? []),
    ...discovered
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
