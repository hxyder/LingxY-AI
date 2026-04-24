import {
  codeCliModelChoices,
  detectProviderFamily,
  providerFingerprint,
  providerModelPresets,
  reasoningOptionsForProvider
} from "../../../shared/provider-catalog.mjs";

const DEFAULT_DISCOVERY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const MAX_MODELS_PER_PROVIDER = 1000;
const MAX_MODELS_PER_FAMILY = Object.freeze({
  openrouter: 400
});

function normalizeModelOption(option) {
  if (typeof option === "string") {
    const id = option.trim();
    return id ? { id, label: id } : null;
  }
  const id = `${option?.id ?? option?.name ?? ""}`.trim();
  if (!id) return null;
  const label = `${option?.label ?? option?.display_name ?? id}`.trim() || id;
  return { id, label };
}

function uniqueModelOptions(options = []) {
  const seen = new Set();
  const out = [];
  for (const raw of options) {
    const option = normalizeModelOption(raw);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    out.push(option);
  }
  return out;
}

function modelLimitForProvider(provider = {}) {
  const family = detectProviderFamily(provider);
  return MAX_MODELS_PER_FAMILY[family] ?? MAX_MODELS_PER_PROVIDER;
}

function curatedModelOptions(provider = {}, taskType = "chat") {
  if (provider.kind === "code_cli") {
    return uniqueModelOptions(codeCliModelChoices(provider));
  }
  return uniqueModelOptions(providerModelPresets(provider, taskType));
}

function mergeModelOptions(provider = {}, taskType = "chat", discovered = []) {
  return uniqueModelOptions([
    provider.defaultModel,
    provider.model,
    ...curatedModelOptions(provider, taskType),
    ...discovered
  ]);
}

function withModelLimit(provider = {}, models = []) {
  const limit = modelLimitForProvider(provider);
  if (!Number.isFinite(limit) || limit <= 0 || models.length <= limit) {
    return { models, truncated: false };
  }
  return {
    models: models.slice(0, limit),
    truncated: true
  };
}

function reasoningBaseModel(provider = {}, models = []) {
  return `${provider.defaultModel ?? provider.model ?? models[0]?.id ?? ""}`.trim();
}

function buildResult(provider = {}, taskType = "chat", {
  source = "curated",
  dynamic = false,
  models = [],
  error = null,
  truncated = false,
  fetchedAt = new Date().toISOString(),
  cacheTtlMs = DEFAULT_DISCOVERY_TTL_MS,
  stale = false
} = {}) {
  const merged = mergeModelOptions(provider, taskType, models);
  const baseModel = reasoningBaseModel(provider, merged);
  return {
    providerId: provider.id ?? null,
    family: detectProviderFamily(provider),
    source,
    dynamic,
    stale,
    truncated,
    models: merged,
    reasoningEfforts: reasoningOptionsForProvider(provider, baseModel),
    error,
    fetchedAt,
    expiresAt: new Date(Date.parse(fetchedAt) + cacheTtlMs).toISOString()
  };
}

async function fetchJsonWithTimeout(fetchImpl, url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function discoverViaOllama(provider, fetchImpl) {
  const baseUrl = `${provider.baseUrl ?? "http://127.0.0.1:11434"}`.replace(/\/+$/, "");
  const payload = await fetchJsonWithTimeout(fetchImpl, `${baseUrl}/api/tags`, {}, 2500);
  const models = uniqueModelOptions((payload.models ?? []).map((model) => model?.name));
  return {
    source: "ollama_tags",
    dynamic: models.length > 0,
    models
  };
}

async function discoverViaOpenAICompatible(provider, fetchImpl) {
  const baseUrl = `${provider.baseUrl ?? ""}`.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { source: "curated", dynamic: false, models: [] };
  }
  const headers = {};
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const payload = await fetchJsonWithTimeout(fetchImpl, `${baseUrl}/models`, { headers });
  const rawModels = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const models = uniqueModelOptions(rawModels.map((model) => model?.id ?? model?.name ?? model));
  return {
    source: "provider_models",
    dynamic: models.length > 0,
    models
  };
}

async function discoverViaAnthropic(provider, fetchImpl) {
  const baseUrl = `${provider.baseUrl ?? "https://api.anthropic.com"}`.trim().replace(/\/+$/, "");
  if (!provider.apiKey) {
    return { source: "curated", dynamic: false, models: [] };
  }
  const headers = {
    "x-api-key": provider.apiKey,
    "anthropic-version": DEFAULT_ANTHROPIC_VERSION
  };
  const models = [];
  let afterId = "";
  let hasMore = true;
  while (hasMore && models.length < MAX_MODELS_PER_PROVIDER) {
    const query = new URLSearchParams({ limit: "100" });
    if (afterId) query.set("after_id", afterId);
    const payload = await fetchJsonWithTimeout(fetchImpl, `${baseUrl}/v1/models?${query.toString()}`, { headers });
    models.push(...uniqueModelOptions((payload.data ?? []).map((model) => ({
      id: model?.id,
      label: `${model?.display_name ?? model?.id ?? ""}`.trim() || model?.id
    }))));
    hasMore = Boolean(payload.has_more);
    afterId = `${payload.last_id ?? ""}`.trim();
    if (!afterId) break;
  }
  return {
    source: "anthropic_models",
    dynamic: models.length > 0,
    models: uniqueModelOptions(models)
  };
}

async function discoverProviderModels(provider = {}, fetchImpl) {
  if (!provider || provider.kind === "code_cli") {
    return { source: "curated", dynamic: false, models: [] };
  }
  if (provider.kind === "ollama") {
    return discoverViaOllama(provider, fetchImpl);
  }
  if (provider.kind === "anthropic") {
    return discoverViaAnthropic(provider, fetchImpl);
  }
  return discoverViaOpenAICompatible(provider, fetchImpl);
}

function discoveryCacheKey(provider = {}, taskType = "chat") {
  const secretMarker = provider.apiKey ? `${provider.apiKey.length}:${provider.apiKey.slice(-4)}` : "";
  return `${taskType}|${providerFingerprint(provider)}|${secretMarker}`;
}

export function createProviderModelDiscovery({
  fetchImpl = fetch,
  cacheTtlMs = DEFAULT_DISCOVERY_TTL_MS
} = {}) {
  const cache = new Map();

  async function getProviderModelOptions(provider = {}, {
    taskType = "chat",
    forceRefresh = false
  } = {}) {
    const key = discoveryCacheKey(provider, taskType);
    const cached = cache.get(key);
    const now = Date.now();
    if (!forceRefresh && cached?.value && cached.expiresAt > now) {
      return cached.value;
    }
    if (cached?.promise) {
      return cached.promise;
    }

    const pending = (async () => {
      try {
        const fetchedAt = new Date().toISOString();
        const discovery = await discoverProviderModels(provider, fetchImpl);
        const limited = withModelLimit(provider, discovery.models);
        const result = buildResult(provider, taskType, {
          source: discovery.source,
          dynamic: discovery.dynamic && limited.models.length > 0,
          models: limited.models,
          truncated: limited.truncated,
          fetchedAt,
          cacheTtlMs
        });
        cache.set(key, {
          providerId: provider.id ?? null,
          taskType,
          value: result,
          expiresAt: now + cacheTtlMs
        });
        return result;
      } catch (error) {
        const message = error?.name === "AbortError"
          ? "model_list_timeout"
          : `${error?.message ?? error}`.slice(0, 240);
        if (cached?.value) {
          const staleResult = {
            ...cached.value,
            stale: true,
            error: message
          };
          cache.set(key, {
            providerId: provider.id ?? null,
            taskType,
            value: staleResult,
            expiresAt: now + Math.min(cacheTtlMs, 60_000)
          });
          return staleResult;
        }
        const fallback = buildResult(provider, taskType, {
          error: message,
          cacheTtlMs
        });
        cache.set(key, {
          providerId: provider.id ?? null,
          taskType,
          value: fallback,
          expiresAt: now + Math.min(cacheTtlMs, 60_000)
        });
        return fallback;
      }
    })();

    cache.set(key, {
      value: cached?.value ?? null,
      expiresAt: cached?.expiresAt ?? 0,
      promise: pending
    });

    try {
      return await pending;
    } finally {
      const latest = cache.get(key);
      if (latest?.promise === pending) {
        if (latest.value) {
          cache.set(key, {
            providerId: latest.providerId ?? provider.id ?? null,
            taskType: latest.taskType ?? taskType,
            value: latest.value,
            expiresAt: latest.expiresAt ?? (Date.now() + cacheTtlMs)
          });
        } else {
          cache.delete(key);
        }
      }
    }
  }

  function invalidate(provider = null, taskType = null) {
    if (!provider && !taskType) {
      cache.clear();
      return;
    }
    for (const [key, entry] of cache.entries()) {
      if (taskType && entry?.taskType !== taskType) continue;
      if (provider?.id && entry?.providerId !== provider.id) continue;
      if (!provider?.id && provider && !key.includes(providerFingerprint(provider))) continue;
      cache.delete(key);
    }
  }

  return {
    getProviderModelOptions,
    invalidate
  };
}
