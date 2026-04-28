/**
 * Resolves the active provider+model for a given task type.
 * Reads from config file (custom providers + task routing) first,
 * then falls back to env vars.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { normalizeCodeCliModel } from "./code-cli-invocation.mjs";
import {
  catalogDefaultModelForProvider,
  resolveModeModel,
  sanitizeProviderConfig,
  sanitizeTaskRouteForProvider
} from "../../../shared/provider-catalog.mjs";

export { sanitizeTaskRouteForProvider } from "../../../shared/provider-catalog.mjs";

function getConfigPath() {
  // Explicit override (used by verify-provider-routing and other tests so
  // they don't clobber the user's real %APPDATA%/UCA/config/runtime.json).
  if (process.env.UCA_CONFIG_PATH) {
    return process.env.UCA_CONFIG_PATH;
  }
  // matches the path used by persistent-runtime.mjs → ensureRuntimePaths
  return path.join(os.homedir(), "AppData", "Roaming", "UCA", "config", "runtime.json");
}

function loadConfig() {
  // Test / integration hatch: UCA_FORCE_BOOT_KIMI_RUNTIME=1 tells the
  // resolver to pretend the user has no provider config so that callers
  // that inject an explicit boot-time kimiRuntime (verify-pdf-ocr,
  // verify-kimi-runtime, etc.) hit the fallback path deterministically.
  if (process.env.UCA_FORCE_BOOT_KIMI_RUNTIME === "1") return {};
  try {
    const p = getConfigPath();
    if (!existsSync(p)) return {};
    // Re-read on every call — no in-memory cache. This is what gives us
    // hot-reload semantics: switching providers in the UI takes effect on
    // the next submitted task without a service restart.
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function readApiKey(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function normalizeReasoningEffort(value = "") {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "extra_high" || normalized === "extra-high") return "xhigh";
  if (["low", "medium", "high", "xhigh"].includes(normalized)) return normalized;
  return "";
}

export function resolveRoutedModel(provider, route, taskType) {
  const sanitizedProvider = sanitizeProviderConfig(provider, taskType);
  const sanitizedRoute = sanitizeTaskRouteForProvider(sanitizedProvider, route, taskType);
  // Order: explicit route.model (if not stale) → provider's own saved model
  // (Console form writes `model`, presets sometimes use `defaultModel`) →
  // hard-coded per-kind default.
  const baseModel = sanitizedRoute?.model
    || sanitizedProvider.model
    || sanitizedProvider.defaultModel
    || catalogDefaultModelForProvider(sanitizedProvider, taskType)
    || getDefaultModelForKind(sanitizedProvider.kind, taskType);
  const mode = sanitizedRoute?.mode ?? "";
  // code_cli providers use CLI-specific model names (e.g. "kimi-code/kimi-for-coding")
  // that differ from API model names — skip mode overrides so the configured model
  // is always passed as-is to the CLI subprocess.
  if (!mode || mode === "default" || sanitizedProvider.kind === "code_cli") return baseModel;

  return resolveModeModel(sanitizedProvider, baseModel, mode);
}

function providerToResolved(provider, route, taskType) {
  // UCA-182 Phase 22b: sanitize the provider + route at resolve time
  // too. Without this, stale taskRouting (e.g. a reasoningEffort in
  // Qwen's "enable_thinking:true" format leaking onto a DeepSeek
  // route) flows straight into applyReasoningSelectionToBody and
  // turns thinking on when the user never asked for it — which in
  // turn makes DeepSeek v4 return reasoning_content that must be
  // echoed back to avoid the 400 "must be passed back" error.
  const sanitizedProvider = sanitizeProviderConfig(provider, taskType);
  const sanitizedRoute = sanitizeTaskRouteForProvider(sanitizedProvider, route ?? null, taskType) ?? {};
  const cleanReasoning = `${sanitizedRoute.reasoningEffort ?? ""}`;

  if (sanitizedProvider.kind === "code_cli") {
    if (!sanitizedProvider.command) return null;
    const reasoningEffort = normalizeReasoningEffort(cleanReasoning);
    const model = normalizeCodeCliModel({
      command: sanitizedProvider.command,
      model: resolveRoutedModel(sanitizedProvider, sanitizedRoute, taskType)
    });
    return {
      id: "code_cli",
      configId: sanitizedProvider.id ?? null,
      kind: "code_cli",
      command: sanitizedProvider.command,
      args: sanitizedProvider.args ?? [],
      env: sanitizedProvider.env ?? null,
      transport: sanitizedProvider.transport ?? "stream_json_print",
      configFile: sanitizedProvider.configFile ?? null,
      mcpConfigFiles: sanitizedProvider.mcpConfigFiles ?? [],
      maxRuntimeSeconds: sanitizedProvider.maxRuntimeSeconds ?? 600,
      model,
      mode: sanitizedRoute.mode ?? "",
      reasoningEffort,
      providerName: sanitizedProvider.name,
      // Codex follow-up: parity with the api-key branch. multi_modal
      // currently ignores supportsVision:false for routed CLI vision
      // providers because this field was being dropped here too.
      // vision_analyze refuses code_cli outright (different concern),
      // but multi_modal needs the flag to honour an explicit opt-out.
      supportsVision: sanitizedProvider.supportsVision
    };
  }
  if (!sanitizedProvider.apiKey && sanitizedProvider.kind !== "ollama") return null;
  return {
    id: sanitizedProvider.kind,
    configId: sanitizedProvider.id ?? sanitizedProvider.kind,
    kind: sanitizedProvider.kind,
    apiKey: sanitizedProvider.apiKey,
    baseUrl: sanitizedProvider.baseUrl,
    model: resolveRoutedModel(sanitizedProvider, sanitizedRoute, taskType),
    embeddingModel: sanitizedRoute.embeddingModel ?? sanitizedProvider.embeddingModel ?? null,
    mode: sanitizedRoute.mode ?? "",
    reasoningEffort: cleanReasoning,
    providerName: sanitizedProvider.name,
    // 架构思路.md §12 (Codex review): preserve the explicit
    // supportsVision flag so callers like the vision_analyze action
    // tool can honour an opt-out without re-reading runtime.json. The
    // multi_modal executor already consumes this field; before this
    // line it was being silently dropped here for every consumer
    // downstream of resolveProviderForTask.
    supportsVision: sanitizedProvider.supportsVision
  };
}

/**
 * Resolve provider for a task type.
 * @param {"chat"|"router"|"vision"|"file_analysis"|"audio_transcription"|"embedding"} taskType
 * @returns provider config or null
 */
export function resolveProviderForTask(taskType, env = process.env) {
  const config = loadConfig();
  const customProviders = (config.ai?.customProviders ?? []).map((provider) => sanitizeProviderConfig(provider, taskType));
  const routing = Object.fromEntries(
    Object.entries(config.ai?.taskRouting ?? {}).map(([routeTaskType, route]) => {
      const provider = route?.providerId
        ? customProviders.find((candidate) => candidate.id === route.providerId)
        : null;
      return [routeTaskType, sanitizeTaskRouteForProvider(provider, route, routeTaskType)];
    })
  );

  // 1. Check explicit task routing
  const route = routing[taskType];
  if (route?.providerId) {
    const provider = customProviders.find((p) => p.id === route.providerId);
    if (provider) {
      const resolved = providerToResolved(provider, route, taskType);
      if (resolved) return resolved;
    }
  }

  // 2. First usable custom provider for this task type.
  //
  // When the route points to a provider that no longer exists (user deleted
  // it, typo, or never configured a key), we fall back to "first usable
  // custom provider" — but the borrowed `route.model` must be cleared if
  // the candidate isn't the original route's target. Otherwise we send the
  // old provider's model name (e.g. "gpt-4o") to a different endpoint
  // (e.g. Doubao Ark) and get a 404 InvalidEndpointOrModel.NotFound.
  // The semantic router is optional: when the user has not explicitly
  // configured a routing model, inherit the active chat model. This keeps
  // first-run setup simple while still allowing Settings -> Routing to pin a
  // cheap/fast router model later.
  const inheritedRoute = (taskType === "router" && !route?.providerId)
    ? (routing.chat ?? null)
    : (route ?? routing.chat ?? null);
  const baseRoute = inheritedRoute;
  if (customProviders.length > 0) {
    // for vision tasks, prefer providers that support vision
    const candidates = taskType === "vision"
      ? customProviders.filter((p) => p.kind === "anthropic" || p.kind === "openai")
      : customProviders;
    for (const cand of candidates) {
      const routeForCandidate = (baseRoute && baseRoute.providerId && baseRoute.providerId === cand.id)
        ? baseRoute
        : (baseRoute ? { ...baseRoute, model: undefined, providerId: cand.id } : null);
      const resolved = providerToResolved(cand, routeForCandidate, taskType);
      if (resolved) return resolved;
    }
  }

  // 3. Env var fallback (legacy)
  const anthropicKey = readApiKey(env, "ANTHROPIC_API_KEY", "UCA_ANTHROPIC_API_KEY");
  if (anthropicKey) {
    return {
      id: "anthropic",
      configId: "anthropic",
      kind: "anthropic",
      apiKey: anthropicKey,
      baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      model: (taskType === "vision" ? env.UCA_VISION_MODEL : env.UCA_FAST_MODEL) ?? "claude-sonnet-4-5-20250514",
      providerName: "Anthropic (env)"
    };
  }

  const openaiKey = readApiKey(env, "OPENAI_API_KEY", "UCA_OPENAI_API_KEY");
  if (openaiKey) {
    return {
      id: "openai",
      configId: "openai",
      kind: "openai",
      apiKey: openaiKey,
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: (taskType === "vision" ? env.UCA_VISION_MODEL : env.UCA_FAST_MODEL) ?? "gpt-4o-mini",
      embeddingModel: env.UCA_EMBEDDING_MODEL ?? "text-embedding-3-small",
      providerName: "OpenAI (env)"
    };
  }

  const kimiKey = readApiKey(env, "MOONSHOT_API_KEY", "KIMI_API_KEY", "UCA_KIMI_API_KEY");
  if (kimiKey) {
    return {
      id: "openai",
      configId: "kimi-api",
      kind: "openai",
      apiKey: kimiKey,
      baseUrl: env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
      model: env.UCA_FAST_MODEL ?? "kimi-k2",
      embeddingModel: env.UCA_EMBEDDING_MODEL ?? null,
      providerName: "Kimi (env)"
    };
  }

  if (env.UCA_OLLAMA_BASE_URL || env.OLLAMA_HOST || env.UCA_OLLAMA_MODEL) {
    return {
      id: "ollama",
      configId: "ollama",
      kind: "ollama",
      apiKey: null,
      baseUrl: env.OLLAMA_HOST ?? env.UCA_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      model: env.UCA_OLLAMA_MODEL ?? "llama3.2",
      providerName: "Ollama (env)"
    };
  }

  return null;
}

function getDefaultModelForKind(kind, taskType) {
  if (kind === "anthropic") return "claude-sonnet-4-5-20250514";
  if (kind === "openai") return taskType === "vision" ? "gpt-4o" : "gpt-4o-mini";
  if (kind === "ollama") return "llama3.2";
  return "";
}

/**
 * Build a Kimi-runtime-shaped object from a code_cli provider
 * so that executeKimiTask() can run any user-configured CLI subprocess.
 *
 * Accepts either a raw custom-provider config (shape: {id, kind, command, args, ...})
 * OR a resolved provider object produced by providerToResolved().
 */
export function buildKimiRuntimeFromProvider(provider, fallbackRuntime = null) {
  if (!provider || provider.kind !== "code_cli") return fallbackRuntime;
  return {
    command: provider.command,
    args: provider.args ?? [],
    env: provider.env ?? process.env,
    transport: provider.transport ?? "stream_json_print",
    model: provider.model || null,
    reasoningEffort: provider.reasoningEffort ?? "",
    configFile: provider.configFile ?? null,
    mcpConfigFiles: provider.mcpConfigFiles ?? [],
    maxRuntimeSeconds: provider.maxRuntimeSeconds ?? 600,
    providerName: provider.providerName ?? provider.name ?? null,
    configId: provider.configId ?? provider.id ?? null
  };
}

/**
 * Resolve a code_cli-style runtime for a given task type. Per-task resolution
 * means provider switches in the UI take effect on the next submitted task
 * without requiring a service restart.
 *
 * Semantics:
 *   - If the user has routed this task type to a code_cli provider → return
 *     a runtime built from that provider's config.
 *   - If the user has routed this task type to a non-code_cli provider
 *     (DeepSeek, Claude API, Ollama, etc.) → return null. This is the key
 *     fix for the "切到 DeepSeek 后还在跑 Kimi CLI" bug: we must NOT fall back
 *     to the boot-time kimiRuntime when the user has explicitly chosen an API.
 *   - If no provider is configured at all → return the boot-time fallback as
 *     a last resort so a fresh install still works.
 *
 * This replaces the old `resolveKimiRuntimeForTask` name, which is kept as
 * an alias for backwards compatibility.
 */
export function resolveCodeCliRuntimeForTask(taskType, fallbackRuntime = null) {
  if (process.env.UCA_FORCE_BOOT_KIMI_RUNTIME === "1") {
    return fallbackRuntime;
  }

  const provider = resolveProviderForTask(taskType);
  if (provider?.kind === "code_cli") {
    return buildKimiRuntimeFromProvider(provider, fallbackRuntime);
  }
  if (provider) {
    // User explicitly chose an API provider; honour it by returning null so
    // the submission layer skips the code_cli branch entirely.
    return null;
  }
  return fallbackRuntime;
}

// Backwards-compatible alias.
export function resolveKimiRuntimeForTask(taskType, fallbackRuntime = null) {
  return resolveCodeCliRuntimeForTask(taskType, fallbackRuntime);
}

/**
 * Build a descriptor for task events and UI display from a resolved provider
 * or a code_cli runtime. Returns null when neither is available.
 *
 * Shape: { provider_id, provider_kind, provider_name, model, transport }.
 * - provider_id:   the user-defined custom provider id ("deepseek"), or the
 *                  kind fallback when no custom id exists.
 * - provider_kind: the adapter family ("anthropic" | "openai" | "ollama" | "code_cli").
 * - transport:     "subprocess" for code_cli, "https" for remote API providers.
 */
export function describeResolvedProvider(resolved) {
  if (!resolved) return null;
  const kind = resolved.kind || resolved.id || null;
  const isCodeCli = kind === "code_cli";
  return {
    provider_id: resolved.configId || resolved.id || kind || null,
    provider_kind: kind,
    provider_name: resolved.providerName || resolved.provider_name || null,
    model: resolved.model || null,
    transport: isCodeCli ? "subprocess" : "https"
  };
}

/**
 * Build the same descriptor from a code_cli runtime object (produced by
 * buildKimiRuntimeFromProvider or the boot-time kimiRuntime). Used by paths
 * that only have the runtime, not the resolved provider.
 */
export function describeCodeCliRuntime(runtime, { providerName = null, configId = null } = {}) {
  if (!runtime) return null;
  return {
    provider_id: runtime.configId || configId || "code_cli",
    provider_kind: "code_cli",
    provider_name: runtime.providerName || providerName || null,
    model: runtime.model || null,
    transport: "subprocess"
  };
}

/**
 * One-shot helper for diagnostic endpoints. Returns both the descriptor and
 * the code_cli runtime if the active provider is a code_cli; callers use this
 * for `/ai/active-provider-for-task` without having to juggle two functions.
 */
export function resolveActiveProviderForTask(taskType, fallbackRuntime = null) {
  if (process.env.UCA_FORCE_BOOT_KIMI_RUNTIME !== "1") {
    const provider = resolveProviderForTask(taskType);
    if (provider) {
      if (provider.kind === "code_cli") {
        const runtime = buildKimiRuntimeFromProvider(provider, fallbackRuntime);
        return {
          descriptor: describeResolvedProvider(provider),
          runtime,
          provider
        };
      }
      return {
        descriptor: describeResolvedProvider(provider),
        runtime: null,
        provider
      };
    }
  }

  if (fallbackRuntime) {
    return {
      descriptor: describeCodeCliRuntime(fallbackRuntime, {
        providerName: fallbackRuntime.providerName ?? "Kimi CLI (boot)",
        configId: fallbackRuntime.configId ?? "kimi-cli-boot"
      }),
      runtime: fallbackRuntime,
      provider: null
    };
  }

  return { descriptor: null, runtime: null, provider: null };
}

export function hasAnyConfiguredProvider() {
  const config = loadConfig();
  const customProviders = config.ai?.customProviders ?? [];
  if (customProviders.some((p) => (p.kind === "code_cli" ? p.command : p.apiKey))) return true;

  const env = process.env;
  return Boolean(
    env.ANTHROPIC_API_KEY || env.UCA_ANTHROPIC_API_KEY ||
    env.OPENAI_API_KEY || env.UCA_OPENAI_API_KEY ||
    env.MOONSHOT_API_KEY || env.KIMI_API_KEY || env.UCA_KIMI_API_KEY ||
    env.UCA_OLLAMA_BASE_URL || env.OLLAMA_HOST || env.UCA_OLLAMA_MODEL
  );
}
