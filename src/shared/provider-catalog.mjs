export const BUILTIN_API_TEMPLATES = Object.freeze([
  { id: "anthropic", label: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-6" },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "doubao", label: "豆包 (火山方舟 Ark)", kind: "openai", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-2-0-lite-260215" },
  { id: "moonshot", label: "Moonshot (Kimi)", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k" },
  { id: "dashscope", label: "Qwen (Dashscope)", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-max" },
  { id: "zhipu", label: "Zhipu (GLM)", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-plus" },
  { id: "minimax", label: "MiniMax", kind: "openai", baseUrl: "https://api.minimax.chat/v1", defaultModel: "abab6.5s-chat" },
  { id: "siliconflow", label: "SiliconFlow", kind: "openai", baseUrl: "https://api.siliconflow.cn/v1", defaultModel: "Qwen/Qwen2.5-72B-Instruct" },
  { id: "xai", label: "xAI (Grok)", kind: "openai", baseUrl: "https://api.x.ai/v1", defaultModel: "grok-2-latest" },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o" },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
  { id: "together", label: "Together AI", kind: "openai", baseUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "fireworks", label: "Fireworks", kind: "openai", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest" },
  { id: "gemini", label: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.0-flash" },
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
  if (/^claude-/.test(normalized)) return "anthropic";
  if (/^gemini-/.test(normalized)) return "gemini";
  if (/^deepseek-/.test(normalized)) return "deepseek";
  if (/^(doubao-|ep-)/.test(normalized)) return "doubao";
  if (/^(kimi-|moonshot-)/.test(normalized)) return "moonshot";
  if (/^qwen-/.test(normalized)) return "dashscope";
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
      return /^(gpt-|o[1-9](-|$)|text-davinci|whisper-)/.test(normalized);
    case "deepseek":
      return /^deepseek-/.test(normalized);
    case "doubao":
      return /^(doubao-|ep-)/.test(normalized);
    case "moonshot":
    case "kimi_cli":
      return /^(kimi-code\/kimi-for-coding|kimi-|moonshot-)/.test(normalized);
    case "dashscope":
      return /^qwen-/.test(normalized);
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
  if (taskType === "vision") {
    if (family === "anthropic") return "claude-sonnet-4-6";
    if (family === "openai") return "gpt-4o";
  }

  switch (family) {
    case "anthropic": return "claude-sonnet-4-6";
    case "openai": return "gpt-4o";
    case "deepseek": return "deepseek-chat";
    case "doubao": return "doubao-seed-2-0-lite-260215";
    case "moonshot": return "moonshot-v1-8k";
    case "dashscope": return "qwen-max";
    case "zhipu": return "glm-4-plus";
    case "minimax": return "abab6.5s-chat";
    case "siliconflow": return "Qwen/Qwen2.5-72B-Instruct";
    case "xai": return "grok-2-latest";
    case "openrouter": return "openai/gpt-4o";
    case "groq": return "llama-3.3-70b-versatile";
    case "together": return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
    case "fireworks": return "accounts/fireworks/models/llama-v3p3-70b-instruct";
    case "mistral": return "mistral-large-latest";
    case "gemini": return "gemini-2.0-flash";
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
      return [cliManaged, ...preferredChoice, { id: "kimi-code/kimi-for-coding", label: "Kimi Code" }, { id: "kimi-k2-0711-preview", label: "K2" }, { id: "moonshot-v1-128k", label: "Moonshot 128K" }];
    case "codex_cli":
      return [cliManaged, ...preferredChoice, { id: "gpt-5.4", label: "GPT-5.4" }, { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" }, { id: "gpt-5.1-codex-max", label: "GPT-5.1-Codex-Max" }, { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" }, { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" }, { id: "gpt-5.2", label: "GPT-5.2" }, { id: "gpt-5.1-codex-mini", label: "GPT-5.1-Codex-Mini" }];
    case "gemini_cli":
      return [cliManaged, ...preferredChoice, { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }, { id: "gemini-2.0-pro", label: "Gemini 2.0 Pro" }, { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (fast)" }];
    case "aider_cli":
      return [cliManaged, ...preferredChoice, { id: "sonnet", label: "Sonnet (shorthand)" }, { id: "opus", label: "Opus (shorthand)" }, { id: "gpt-5", label: "GPT-5" }, { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" }];
    case "opencode_cli":
      return [cliManaged, ...preferredChoice, { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet" }, { id: "openai/gpt-5", label: "GPT-5" }, { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" }];
    case "claude_cli":
      return [cliManaged, ...preferredChoice, { id: "sonnet", label: "Sonnet (shorthand)" }, { id: "opus", label: "Opus (shorthand)" }, { id: "haiku", label: "Haiku (shorthand)" }, { id: "claude-sonnet-4-5", label: "claude-sonnet-4-5 (pinned)" }, { id: "claude-opus-4-5", label: "claude-opus-4-5 (pinned)" }, { id: "claude-haiku-4-5", label: "claude-haiku-4-5 (pinned)" }];
    case "cursor_cli":
      return [cliManaged, ...preferredChoice, { id: "claude-sonnet-4-5", label: "Claude Sonnet" }, { id: "gpt-5", label: "GPT-5" }];
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
    return family === "openai" ? uniqueNonEmpty([preferred, "whisper-1"]) : uniqueNonEmpty([preferred]);
  }

  switch (family) {
    case "anthropic":
      return uniqueNonEmpty([preferred, "claude-sonnet-4-6", "claude-opus-4-5-20250514", "claude-haiku-4-5-20250514"]);
    case "openai":
      return uniqueNonEmpty([preferred, taskType === "vision" ? "gpt-4o" : "", "gpt-4o", "gpt-4o-mini", "gpt-5"]);
    case "deepseek":
      return uniqueNonEmpty([preferred, "deepseek-chat", "deepseek-reasoner"]);
    case "doubao":
      return uniqueNonEmpty([preferred, "doubao-seed-2-0-lite-260215", "doubao-seed-2-0-thinking-1216"]);
    case "moonshot":
      return uniqueNonEmpty([preferred, "kimi-latest", "kimi-k2-0711-preview", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]);
    case "dashscope":
      return uniqueNonEmpty([preferred, "qwen-max", "qwen-plus", "qwen-turbo", "qwen-coder-plus", "qwen-vl-max"]);
    case "zhipu":
      return uniqueNonEmpty([preferred, "glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4v-plus"]);
    case "minimax":
      return uniqueNonEmpty([preferred, "abab6.5s-chat", "abab6.5g-chat", "abab6.5t-chat"]);
    case "siliconflow":
      return uniqueNonEmpty([preferred, "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "meta-llama/Meta-Llama-3.1-405B-Instruct"]);
    case "xai":
      return uniqueNonEmpty([preferred, "grok-2-latest", "grok-2-1212", "grok-vision-beta", "grok-beta"]);
    case "openrouter":
      return uniqueNonEmpty([preferred, "openai/gpt-4o", "anthropic/claude-sonnet-4-5", "google/gemini-2.0-flash", "deepseek/deepseek-chat"]);
    case "groq":
      return uniqueNonEmpty([preferred, "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"]);
    case "together":
      return uniqueNonEmpty([preferred, "meta-llama/Llama-3.3-70B-Instruct-Turbo", "deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct-Turbo"]);
    case "fireworks":
      return uniqueNonEmpty([preferred, "accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3"]);
    case "mistral":
      return uniqueNonEmpty([preferred, "mistral-large-latest", "mistral-small-latest", "codestral-latest", "pixtral-large-latest"]);
    case "gemini":
      return uniqueNonEmpty([preferred, "gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"]);
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
    return [...defaultOption, { id: "chat", label: "Chat", model: "deepseek-chat" }, { id: "reasoner", label: "Reasoner", model: "deepseek-reasoner" }];
  }
  if (family === "anthropic") {
    return [...defaultOption, { id: "balanced", label: "Balanced", model: "claude-sonnet-4-6" }, { id: "deep", label: "Deep", model: "claude-opus-4-5-20250514" }, { id: "fast", label: "Fast", model: "claude-haiku-4-5-20250514" }];
  }
  if (family === "moonshot") {
    return [...defaultOption, { id: "latest", label: "Kimi Latest", model: "kimi-latest" }, { id: "k2", label: "K2", model: "kimi-k2-0711-preview" }, { id: "8k", label: "8K", model: "moonshot-v1-8k" }, { id: "32k", label: "32K", model: "moonshot-v1-32k" }, { id: "128k", label: "128K", model: "moonshot-v1-128k" }];
  }
  if (family === "openai") {
    return [...defaultOption, { id: "balanced", label: "Balanced", model: "gpt-4o" }, { id: "fast", label: "Fast", model: "gpt-4o-mini" }, { id: "latest", label: "Latest", model: "gpt-5" }, { id: "transcribe", label: "Transcribe", model: "whisper-1" }];
  }
  return defaultOption;
}

export function resolveModeModel(provider = {}, baseModel = "", mode = "") {
  const normalizedMode = `${mode ?? ""}`.trim();
  if (!normalizedMode || normalizedMode === "default") return baseModel;
  return modeOptionsForProvider(provider, baseModel).find((option) => option.id === normalizedMode)?.model ?? baseModel;
}

function sanitizeRouteMode(provider = {}, model = "", mode = "") {
  const normalizedMode = `${mode ?? ""}`.trim();
  const options = modeOptionsForProvider(provider, model);
  if (options.some((option) => option.id === normalizedMode)) return normalizedMode;
  const matched = options.find((option) => option.model === model);
  return matched?.id ?? "default";
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
  return {
    ...route,
    model,
    mode
  };
}
