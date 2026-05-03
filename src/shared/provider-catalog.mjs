export const BUILTIN_API_TEMPLATES = Object.freeze([
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-6" },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5.4-mini" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-v4-flash" },
  { id: "doubao", label: "豆包 (火山方舟 Ark)", kind: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-2-0-lite-260215" },
  { id: "moonshot", label: "Moonshot (Kimi)", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.6" },
  { id: "dashscope", label: "Qwen (DashScope)", kind: "openai", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen3.6-plus" },
  { id: "zhipu", label: "Zhipu (GLM)", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-plus" },
  { id: "minimax", label: "MiniMax", kind: "openai", baseUrl: "https://api.minimax.chat/v1", defaultModel: "abab6.5s-chat" },
  { id: "siliconflow", label: "SiliconFlow", kind: "openai", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  { id: "xai", label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-4.3" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openrouter/auto" },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  { id: "together", label: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks", kind: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-medium-3-5" },
  { id: "gemini", label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash" },
  { id: "ollama", label: "Ollama (local)", kind: "ollama", baseUrl: "http://127.0.0.1:11434", defaultModel: "llama3.2" }
]);

export function uniqueNonEmpty(values = []) {
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

function cloneOptionList(options = []) {
  return options.map((option) => ({ ...option }));
}

export function providerFingerprint(provider = {}) {
  return [
    provider.id,
    provider.name,
    provider.kind,
    provider.baseUrl,
    provider.command,
    provider.defaultModel
  ].map((part) => `${part ?? ""}`.toLowerCase()).join(" ");
}

function detectCodeCliFamily(provider = {}) {
  const fp = providerFingerprint(provider);
  if (/codex/.test(fp)) return "codex_cli";
  if (/claude/.test(fp)) return "claude_cli";
  if (/(moonshot|kimi)/.test(fp)) return "kimi_cli";
  if (/gemini/.test(fp)) return "gemini_cli";
  if (/aider/.test(fp)) return "aider_cli";
  if (/opencode/.test(fp)) return "opencode_cli";
  if (/cursor/.test(fp)) return "cursor_cli";
  return "code_cli";
}

export function detectProviderFamily(provider = {}) {
  if (!provider) return "unknown";
  if (provider.kind === "code_cli") return detectCodeCliFamily(provider);
  if (provider.kind === "anthropic") return "anthropic";
  if (provider.kind === "ollama") return "ollama";

  const fp = providerFingerprint(provider);
  if (/openrouter/.test(fp)) return "openrouter";
  if (/deepseek/.test(fp)) return "deepseek";
  if (/volces|doubao|ark/.test(fp)) return "doubao";
  if (/(moonshot|kimi)/.test(fp)) return "moonshot";
  if (/dashscope|aliyun|qwen/.test(fp)) return "dashscope";
  if (/bigmodel|zhipu|glm/.test(fp)) return "zhipu";
  if (/minimax/.test(fp)) return "minimax";
  if (/siliconflow/.test(fp)) return "siliconflow";
  if (/x\.ai|grok/.test(fp)) return "xai";
  if (/groq/.test(fp)) return "groq";
  if (/together/.test(fp)) return "together";
  if (/fireworks/.test(fp)) return "fireworks";
  if (/mistral/.test(fp)) return "mistral";
  if (/generativelanguage|gemini/.test(fp)) return "gemini";
  if (/api\.openai\.com|azure\.com/.test(fp)) return "openai";
  return provider.kind === "openai" ? "openai_compatible" : (provider.kind ?? "unknown");
}

function detectModelFamily(model = "") {
  const normalized = `${model ?? ""}`.trim().toLowerCase();
  if (!normalized) return "empty";
  if (/^(gpt-|o[1-9](-|$)|text-davinci|whisper-)/.test(normalized)) return "openai";
  if (/^text-embedding-/.test(normalized)) return "openai";
  if (/^claude-/.test(normalized)) return "anthropic";
  if (/^gemini-/.test(normalized)) return "gemini";
  if (/^deepseek-/.test(normalized)) return "deepseek";
  if (/^(doubao-|ep-)/.test(normalized)) return "doubao";
  if (/^(kimi-|moonshot-)/.test(normalized)) return "moonshot";
  if (/^qwen/i.test(normalized)) return "dashscope";
  if (/^glm-/.test(normalized)) return "zhipu";
  if (/^abab/.test(normalized)) return "minimax";
  return "unknown";
}

function providerSupportsModel(providerFamily, model = "") {
  const normalized = `${model ?? ""}`.trim().toLowerCase();
  if (!normalized) return true;

  switch (providerFamily) {
    case "openrouter":
    case "aider_cli":
    case "opencode_cli":
    case "cursor_cli":
    case "code_cli":
      return true;
    case "anthropic":
      return /^claude-/.test(normalized);
    case "openai":
      return /^(gpt-|o[1-9](-|$)|text-davinci|whisper-|text-embedding-)/.test(normalized);
    case "deepseek":
      return /^deepseek-/.test(normalized);
    case "doubao":
      return /^(doubao-|ep-)/.test(normalized);
    case "moonshot":
    case "kimi_cli":
      return /^(kimi-code\/kimi-for-coding|kimi-|moonshot-)/.test(normalized);
    case "dashscope":
      return /^qwen/i.test(normalized);
    case "zhipu":
      return /^glm-/.test(normalized);
    case "minimax":
      return /^abab/.test(normalized);
    case "gemini":
    case "gemini_cli":
      return /^gemini-/.test(normalized);
    case "codex_cli":
      return /^gpt-5(?:[.-]|$)|^o[1-9](?:-|$)/.test(normalized);
    case "claude_cli":
      return /^(sonnet|opus|haiku|claude-)/.test(normalized);
    case "siliconflow":
      return !["openai", "anthropic", "gemini", "doubao", "moonshot", "minimax"].includes(detectModelFamily(normalized));
    case "groq":
    case "together":
    case "fireworks":
    case "mistral":
    case "xai":
    case "ollama":
    case "openai_compatible":
      return detectModelFamily(normalized) !== "openai";
    default:
      return true;
  }
}

export function catalogDefaultModelForProvider(provider = {}, taskType = "chat") {
  const family = detectProviderFamily(provider);

  if (taskType === "audio_transcription" && family === "openai") return "whisper-1";
  if (taskType === "audio_transcription" && family !== "openai") return "";
  if (taskType === "embedding" && family === "openai") return "text-embedding-3-small";
  if (taskType === "embedding" && family !== "openai") return "";
  if (taskType === "vision") {
    if (family === "anthropic") return "claude-sonnet-4-6";
    if (family === "openai") return "gpt-5.4-mini";
  }

  switch (family) {
    case "anthropic": return "claude-sonnet-4-6";
    case "openai": return "gpt-5.4-mini";
    case "deepseek": return "deepseek-v4-flash";
    case "doubao": return "doubao-seed-2-0-lite-260215";
    case "moonshot": return "kimi-k2.6";
    case "dashscope": return "qwen3.6-plus";
    case "zhipu": return "glm-4-plus";
    case "minimax": return "abab6.5s-chat";
    case "siliconflow": return "Qwen/Qwen2.5-72B-Instruct";
    case "xai": return "grok-4.3";
    case "openrouter": return "openrouter/auto";
    case "groq": return "llama-3.3-70b-versatile";
    case "together": return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
    case "fireworks": return "accounts/fireworks/models/llama-v3p3-70b-instruct";
    case "mistral": return "mistral-medium-3-5";
    case "gemini": return "gemini-2.5-flash";
    case "ollama": return "llama3.2";
    case "codex_cli":
    case "claude_cli":
    case "kimi_cli":
    case "gemini_cli":
    case "aider_cli":
    case "opencode_cli":
    case "cursor_cli":
    case "code_cli":
      return "";
    default:
      return "";
  }
}

export function modelLooksStaleForProvider(provider = {}, model = "") {
  const normalized = `${model ?? ""}`.trim();
  if (!normalized) return false;
  return !providerSupportsModel(detectProviderFamily(provider), normalized);
}

export function sanitizeProviderConfig(provider = {}, taskType = "chat") {
  if (!provider || typeof provider !== "object") return provider;
  const fallbackModel = catalogDefaultModelForProvider(provider, taskType);
  const defaultModel = `${provider.defaultModel ?? ""}`.trim();
  if (!defaultModel) {
    return fallbackModel ? { ...provider, defaultModel: fallbackModel } : { ...provider };
  }
  if (!modelLooksStaleForProvider(provider, defaultModel)) {
    return { ...provider, defaultModel };
  }
  return { ...provider, defaultModel: fallbackModel };
}

export function codeCliModelChoices(provider = {}) {
  if (!provider || provider.kind !== "code_cli") return [];

  const family = detectProviderFamily(provider);
  const preferred = `${provider.defaultModel ?? ""}`.trim();
  const preferredChoice = preferred ? [{ id: preferred, label: `${preferred} (保存的默认)` }] : [];
  const cliManaged = { id: "", label: "(CLI 自行管理 — 用 /model 切换)" };

  switch (family) {
    case "kimi_cli":
      return [cliManaged, ...preferredChoice, { id: "kimi-code/kimi-for-coding", label: "Kimi Code" }, { id: "kimi-k2.6", label: "Kimi K2.6" }, { id: "kimi-k2.5", label: "Kimi K2.5" }, { id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo" }, { id: "kimi-k2-thinking", label: "Kimi K2 Thinking" }, { id: "moonshot-v1-128k", label: "Moonshot 128K" }];
    case "codex_cli":
      return [cliManaged, ...preferredChoice, { id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-5.4", label: "GPT-5.4" }, { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" }, { id: "gpt-5.4-nano", label: "GPT-5.4 Nano" }, { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" }, { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" }, { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" }];
    case "gemini_cli":
      return [cliManaged, ...preferredChoice, { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" }, { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" }, { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash-Lite Preview" }, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }];
    case "aider_cli":
      return [cliManaged, ...preferredChoice, { id: "sonnet", label: "Sonnet (shorthand)" }, { id: "opus", label: "Opus (shorthand)" }, { id: "gpt-5", label: "GPT-5" }, { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" }];
    case "opencode_cli":
      return [cliManaged, ...preferredChoice, { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" }, { id: "openai/gpt-5.5", label: "GPT-5.5" }, { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" }];
    case "claude_cli":
      return [cliManaged, ...preferredChoice, { id: "sonnet", label: "Sonnet (shorthand)" }, { id: "opus", label: "Opus (shorthand)" }, { id: "haiku", label: "Haiku (shorthand)" }, { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }, { id: "claude-opus-4-7", label: "Claude Opus 4.7" }, { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }];
    case "cursor_cli":
      return [cliManaged, ...preferredChoice, { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }, { id: "gpt-5.5", label: "GPT-5.5" }];
    default:
      return [cliManaged, ...preferredChoice];
  }
}

export function providerModelPresets(provider = {}, taskType = "chat") {
  if (!provider) return [];
  const family = detectProviderFamily(provider);
  const preferred = `${provider.defaultModel ?? ""}`.trim();

  if (provider.kind === "code_cli") {
    return uniqueNonEmpty(codeCliModelChoices(provider).map((choice) => choice.id));
  }

  if (taskType === "audio_transcription") {
    return family === "openai" ? uniqueNonEmpty([preferred, "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"]) : uniqueNonEmpty([preferred]);
  }

  switch (family) {
    case "anthropic":
      return uniqueNonEmpty([preferred, "claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001", "claude-haiku-4-5"]);
    case "openai":
      return uniqueNonEmpty([preferred, "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5", "gpt-4.1", "gpt-4o"]);
    case "deepseek":
      return uniqueNonEmpty([preferred, "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]);
    case "doubao":
      return uniqueNonEmpty([
        preferred,
        "doubao-seed-2-0-lite-260215",
        taskType === "vision" ? "doubao-seed-2-0-pro-260215" : "",
        taskType === "vision" ? "doubao-seed-2-0-mini-260215" : "",
        "doubao-seed-2-0-thinking-1216"
      ]);
    case "moonshot":
      return uniqueNonEmpty([preferred, "kimi-k2.6", "kimi-k2.5", "kimi-k2-turbo-preview", "kimi-k2-thinking", "kimi-latest", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]);
    case "dashscope":
      return uniqueNonEmpty([preferred, "qwen3.6-plus", "qwen-plus", "qwen-turbo", "qwen-coder-plus", "qwen-vl-max"]);
    case "zhipu":
      return uniqueNonEmpty([preferred, "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v-plus"]);
    case "minimax":
      return uniqueNonEmpty([preferred, "abab6.5s-chat", "abab6.5g-chat", "abab6.5t-chat"]);
    case "siliconflow":
      return uniqueNonEmpty([preferred, "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "meta-llama/Meta-Llama-3.1-405B-Instruct"]);
    case "xai":
      return uniqueNonEmpty([preferred, "grok-4.3", "grok-4.3-latest", "grok-4", "grok-4-latest", "grok-3-mini"]);
    case "openrouter":
      return uniqueNonEmpty([preferred, "openrouter/auto", "openai/gpt-5.5", "openai/gpt-5.5-pro", "anthropic/claude-sonnet-4.6", "google/gemini-3.1-pro-preview", "x-ai/grok-4.3", "deepseek/deepseek-v4-flash"]);
    case "groq":
      return uniqueNonEmpty([preferred, "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]);
    case "together":
      return uniqueNonEmpty([preferred, "meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo"]);
    case "fireworks":
      return uniqueNonEmpty([preferred, "accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3"]);
    case "mistral":
      return uniqueNonEmpty([preferred, "mistral-medium-3-5", "mistral-large-2512", "mistral-small-2603", "devstral-2512", "mistral-large-latest", "mistral-small-latest", "codestral-latest"]);
    case "gemini":
      return uniqueNonEmpty([preferred, "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview", "gemini-3.1-flash-live-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    case "ollama":
      return uniqueNonEmpty([preferred, "llama3.2", "qwen2.5", "mistral", "phi3"]);
    default:
      return uniqueNonEmpty([preferred]);
  }
}

export function modeOptionsForProvider(provider = {}, model = "") {
  const baseModel = `${model ?? ""}`.trim();
  const defaultOption = [{ id: "default", label: "Default", model: baseModel }];
  const family = detectProviderFamily(provider);

  if (provider.kind === "code_cli") {
    return [{ id: "default", label: "-", model: baseModel }];
  }
  if (family === "deepseek") {
    return [
      ...defaultOption,
      { id: "flash", label: "V4 Flash", model: "deepseek-v4-flash" },
      { id: "pro", label: "V4 Pro", model: "deepseek-v4-pro" },
      { id: "chat", label: "Chat alias", model: "deepseek-chat" },
      { id: "reasoner", label: "Reasoner alias", model: "deepseek-reasoner" }
    ];
  }
  if (family === "anthropic") {
    return [...defaultOption, { id: "balanced", label: "Balanced", model: "claude-sonnet-4-6" }, { id: "deep", label: "Deep", model: "claude-opus-4-7" }, { id: "fast", label: "Fast", model: "claude-haiku-4-5" }];
  }
  if (family === "moonshot") {
    return [...defaultOption, { id: "latest", label: "Kimi Latest", model: "kimi-latest" }, { id: "k26", label: "Kimi K2.6", model: "kimi-k2.6" }, { id: "k25", label: "Kimi K2.5", model: "kimi-k2.5" }, { id: "thinking", label: "Kimi Thinking", model: "kimi-k2-thinking" }, { id: "8k", label: "8K", model: "moonshot-v1-8k" }, { id: "32k", label: "32K", model: "moonshot-v1-32k" }, { id: "128k", label: "128K", model: "moonshot-v1-128k" }];
  }
  if (family === "openai") {
    return [...defaultOption, { id: "latest", label: "Latest", model: "gpt-5.5" }, { id: "deep", label: "Deep", model: "gpt-5.5" }, { id: "fast", label: "Fast", model: "gpt-5.4-mini" }, { id: "nano", label: "Nano", model: "gpt-5.4-nano" }, { id: "transcribe", label: "Transcribe", model: "gpt-4o-transcribe" }];
  }
  return defaultOption;
}

export function resolveModeModel(provider = {}, baseModel = "", mode = "") {
  const normalizedMode = `${mode ?? ""}`.trim();
  if (!normalizedMode || normalizedMode === "default") return baseModel;
  const family = detectProviderFamily(provider);
  const aliased = family === "deepseek" && normalizedMode === "chat-legacy" ? "chat"
    : family === "deepseek" && normalizedMode === "reasoner-legacy" ? "reasoner"
    : normalizedMode;
  return modeOptionsForProvider(provider, baseModel).find((option) => option.id === aliased)?.model ?? baseModel;
}

const CODEX_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "low", label: "Low (快速)" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High (深思)" },
  { id: "xhigh", label: "Extra High (最深)" }
]);

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

const DEEPSEEK_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "thinking:disabled", label: "关闭思考" },
  { id: "thinking:enabled", label: "开启思考" }
]);

const MOONSHOT_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "thinking:disabled", label: "关闭思考" },
  { id: "thinking:enabled", label: "开启思考" }
]);

const QWEN_REASONING_OPTIONS = Object.freeze([
  { id: "", label: "(不指定)" },
  { id: "enable_thinking:false", label: "关闭思考" },
  { id: "enable_thinking:true", label: "开启思考" }
]);

const OPENAI_REASONING_IDS = new Set(OPENAI_REASONING_OPTIONS.map((option) => option.id).filter(Boolean));
const DOUBAO_REASONING_IDS = new Set(DOUBAO_REASONING_OPTIONS.map((option) => option.id).filter(Boolean));
const DEEPSEEK_REASONING_IDS = new Set(DEEPSEEK_REASONING_OPTIONS.map((option) => option.id).filter(Boolean));
const MOONSHOT_REASONING_IDS = new Set(MOONSHOT_REASONING_OPTIONS.map((option) => option.id).filter(Boolean));
const QWEN_REASONING_IDS = new Set(QWEN_REASONING_OPTIONS.map((option) => option.id).filter(Boolean));

export function reasoningOptionsForProvider(provider = {}, model = "") {
  if (!provider) return [];
  const fp = `${providerFingerprint(provider)} ${model}`.toLowerCase();
  const family = detectProviderFamily(provider);

  if (provider.kind === "code_cli") {
    return /codex/.test(fp) ? cloneOptionList(CODEX_REASONING_OPTIONS) : [];
  }

  if (family === "doubao" || /doubao|volces|ark/.test(fp)) {
    return cloneOptionList(DOUBAO_REASONING_OPTIONS);
  }

  if (family === "deepseek") {
    return cloneOptionList(DEEPSEEK_REASONING_OPTIONS);
  }

  if (family === "moonshot" && /^kimi-k2\.5/i.test(`${model ?? ""}`.trim())) {
    return cloneOptionList(MOONSHOT_REASONING_OPTIONS);
  }

  if (family === "dashscope" && /^qwen3/i.test(`${model ?? ""}`.trim())) {
    return cloneOptionList(QWEN_REASONING_OPTIONS);
  }

  if (provider.kind === "openai" && /(gpt-5|^o[1-9]|\bo\d+-|reasoning)/.test(fp)) {
    return cloneOptionList(OPENAI_REASONING_OPTIONS);
  }

  return [];
}

export function normalizeReasoningSelection(provider = {}, model = "", value = "") {
  const family = detectProviderFamily(provider);
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";

  if (normalized === "extra_high" || normalized === "extra-high") {
    return normalizeReasoningSelection(provider, model, "xhigh");
  }

  if (family === "doubao") {
    if (normalized === "thinking:enabled") return "thinking:enabled|medium";
    if (normalized === "thinking:disabled") return "thinking:disabled|minimal";
    if (normalized.startsWith("thinking:")) {
      const [thinkingPart, effortPart = ""] = normalized.split("|");
      const thinkingType = thinkingPart.slice("thinking:".length).trim();
      const effort = effortPart.trim();
      if (thinkingType === "disabled") return "thinking:disabled|minimal";
      if (thinkingType === "enabled") {
        if (!effort) return "thinking:enabled|medium";
        if (effort === "minimal") return "thinking:disabled|minimal";
        if (["low", "medium", "high"].includes(effort)) return `thinking:enabled|${effort}`;
      }
    }
    return DOUBAO_REASONING_IDS.has(normalized) ? normalized : "";
  }

  if (family === "deepseek") {
    if (["thinking:on", "enabled", "true", "on"].includes(normalized)) return "thinking:enabled";
    if (["thinking:off", "disabled", "false", "off"].includes(normalized)) return "thinking:disabled";
    if (normalized.startsWith("thinking:enabled|")) return "thinking:enabled";
    if (normalized.startsWith("thinking:disabled|")) return "thinking:disabled";
    return DEEPSEEK_REASONING_IDS.has(normalized) ? normalized : "";
  }

  if (family === "moonshot") {
    if (["thinking:on", "enabled", "true", "on"].includes(normalized)) return "thinking:enabled";
    if (["thinking:off", "disabled", "false", "off"].includes(normalized)) return "thinking:disabled";
    if (normalized.startsWith("thinking:enabled|")) return "thinking:enabled";
    if (normalized.startsWith("thinking:disabled|")) return "thinking:disabled";
    return MOONSHOT_REASONING_IDS.has(normalized) ? normalized : "";
  }

  if (family === "dashscope") {
    if (["enable_thinking:true", "thinking:on", "thinking:enabled", "enabled", "true", "on"].includes(normalized)) {
      return "enable_thinking:true";
    }
    if (["enable_thinking:false", "thinking:off", "thinking:disabled", "disabled", "false", "off"].includes(normalized)) {
      return "enable_thinking:false";
    }
    return QWEN_REASONING_IDS.has(normalized) ? normalized : "";
  }

  if (provider.kind === "code_cli") {
    return ["low", "medium", "high", "xhigh"].includes(normalized) ? normalized : "";
  }

  return OPENAI_REASONING_IDS.has(normalized) ? normalized : "";
}

export function applyReasoningSelectionToBody(body = {}, provider = {}, model = "", value = "") {
  const normalized = normalizeReasoningSelection(provider, model, value);

  if (!body || typeof body !== "object") return body;

  if (!normalized) {
    if (detectProviderFamily(provider) === "deepseek" && /^deepseek-v4-/i.test(`${model ?? ""}`.trim())) {
      body.thinking = { type: "disabled" };
    }
    return body;
  }

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

function sanitizeRouteMode(provider = {}, model = "", mode = "") {
  const raw = `${mode ?? ""}`.trim();
  const family = detectProviderFamily(provider);
  const normalizedMode = (family === "deepseek" && raw === "chat-legacy") ? "chat"
    : (family === "deepseek" && raw === "reasoner-legacy") ? "reasoner"
    : raw;
  const options = modeOptionsForProvider(provider, model);
  if (options.some((option) => option.id === normalizedMode)) return normalizedMode;
  const matched = options.find((option) => option.model === model);
  return matched?.id ?? "default";
}

export function officialOpenAIChatModelUsesLatestSchema(provider = {}, model = "") {
  return detectProviderFamily(provider) === "openai"
    && /^(?:gpt-5|o[1-9](?:-|$))/i.test(`${model ?? ""}`.trim());
}

export function normalizeMessagesForOpenAIChat(provider = {}, model = "", messages = []) {
  if (!officialOpenAIChatModelUsesLatestSchema(provider, model)) {
    return Array.isArray(messages) ? messages : [];
  }
  return (Array.isArray(messages) ? messages : []).map((message) => {
    if (message?.role !== "system") return message;
    return { ...message, role: "developer" };
  });
}

export function applyOpenAIChatTokenLimit(body = {}, provider = {}, model = "", maxTokens = 2048) {
  if (!body || typeof body !== "object") return body;
  if (officialOpenAIChatModelUsesLatestSchema(provider, model)) {
    body.max_completion_tokens = maxTokens;
    delete body.max_tokens;
  } else {
    body.max_tokens = maxTokens;
    delete body.max_completion_tokens;
  }
  return body;
}

export function buildOpenAIChatCompletionBody({
  provider = {},
  model = "",
  messages = [],
  maxTokens = 2048,
  stream = false
} = {}) {
  const body = {
    model,
    messages: normalizeMessagesForOpenAIChat(provider, model, messages)
  };
  if (stream) body.stream = true;
  return applyOpenAIChatTokenLimit(body, provider, model, maxTokens);
}

export function sanitizeTaskRouteForProvider(provider = {}, route = null, taskType = "chat") {
  if (!route) return route ?? null;
  if (!provider) return { ...route };

  const sanitizedProvider = sanitizeProviderConfig(provider, taskType);
  const fallbackModel = catalogDefaultModelForProvider(sanitizedProvider, taskType);
  const routeModel = `${route.model ?? ""}`.trim();
  let model = routeModel;
  if (!model || modelLooksStaleForProvider(sanitizedProvider, model)) {
    model = fallbackModel;
  }
  const mode = sanitizeRouteMode(sanitizedProvider, model, route.mode);
  model = resolveModeModel(sanitizedProvider, model, mode);
  const reasoningEffort = normalizeReasoningSelection(sanitizedProvider, model, route.reasoningEffort);
  const nextRoute = {
    ...route,
    model,
    mode
  };
  if (reasoningEffort) nextRoute.reasoningEffort = reasoningEffort;
  else delete nextRoute.reasoningEffort;
  return nextRoute;
}
