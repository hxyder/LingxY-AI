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
      { id: "qwen", label: "通义千问 (DashScope)", defaultModel: "qwen-turbo" },
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
  qwen: { label: "通义千问 (DashScope)", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: PROVIDER_DEFAULT_MODELS.qwen, authStyle: "bearer" },
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

function detectModelFamily(model = "") {
  const normalized = `${model ?? ""}`.trim().toLowerCase();
  if (!normalized) return "empty";
  if (/^(gpt-|o[1-9](-|$)|text-davinci|whisper-)/.test(normalized)) return "openai";
  if (/^claude-/.test(normalized)) return "anthropic";
  if (/^gemini-/.test(normalized)) return "gemini";
  if (/^deepseek-/.test(normalized)) return "deepseek";
  if (/^(doubao-|ep-)/.test(normalized)) return "doubao";
  if (/^(kimi-|moonshot-)/.test(normalized)) return "moonshot";
  if (/^qwen-/.test(normalized)) return "qwen";
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
    case "qwen": return /^qwen-/.test(normalizedModel);
    case "zhipu": return /^glm-/.test(normalizedModel);
    case "siliconflow": return !["openai", "anthropic", "gemini", "doubao", "moonshot"].includes(detectModelFamily(normalizedModel));
    default: return detectModelFamily(normalizedModel) !== "openai";
  }
}

export function normalizeStandaloneConfig(config = {}) {
  const provider = `${config?.provider ?? "anthropic"}`.trim() || "anthropic";
  const model = `${config?.model ?? ""}`.trim();
  return {
    runtimeUrl: `${config?.runtimeUrl ?? DEFAULT_RUNTIME_URL}`.trim() || DEFAULT_RUNTIME_URL,
    provider,
    apiKey: `${config?.apiKey ?? ""}`,
    model: !model || !providerSupportsModel(provider, model)
      ? (PROVIDER_DEFAULT_MODELS[provider] ?? "")
      : model
  };
}
