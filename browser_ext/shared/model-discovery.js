import {
  PROVIDER_CONFIGS,
  modelOptionsForProvider
} from "./provider-catalog.js";

const DISCOVERY_TIMEOUT_MS = 3500;
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

const cache = new Map();

function cacheKey(providerId, apiKey = "") {
  const suffix = apiKey ? `${apiKey.length}:${apiKey.slice(-4)}` : "";
  return `${providerId}|${suffix}`;
}

function withTimeout(timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear() { clearTimeout(timer); }
  };
}

async function fetchJson(url, init = {}, timeoutMs = DISCOVERY_TIMEOUT_MS) {
  const scoped = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: scoped.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 200)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    scoped.clear();
  }
}

function uniqueModelOptions(models = []) {
  const seen = new Set();
  const out = [];
  for (const raw of models) {
    const id = `${raw?.id ?? raw?.name ?? raw ?? ""}`.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function discoverOpenAICompatible(provider, apiKey) {
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/models`, { headers });
  const models = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : [];
  return uniqueModelOptions(models);
}

async function discoverAnthropic(provider, apiKey) {
  if (!apiKey) return [];
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/v1/models?limit=100`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    }
  });
  return uniqueModelOptions((payload?.data ?? []).map((model) => ({
    id: model?.id,
    name: model?.display_name ?? model?.id
  })));
}

async function discoverOllama(provider) {
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/+$/, "")}/api/tags`, {}, 2500);
  return uniqueModelOptions((payload?.models ?? []).map((model) => model?.name));
}

async function discoverProviderModels(providerId, { apiKey = "", forceRefresh = false } = {}) {
  const provider = PROVIDER_CONFIGS[providerId];
  if (!provider) {
    return { models: [], source: "unknown_provider", dynamic: false, error: "unknown_provider" };
  }
  if (provider.authStyle !== "none" && !apiKey) {
    return {
      models: modelOptionsForProvider(providerId, []),
      source: "curated",
      dynamic: false,
      error: null,
      fetchedAt: new Date().toISOString()
    };
  }

  const key = cacheKey(providerId, apiKey);
  const now = Date.now();
  const cached = cache.get(key);
  if (!forceRefresh && cached?.expiresAt > now) return cached.value;

  try {
    let discovered = [];
    if (provider.kind === "anthropic") {
      discovered = await discoverAnthropic(provider, apiKey);
    } else if (provider.kind === "ollama") {
      discovered = await discoverOllama(provider);
    } else if (provider.kind === "gemini") {
      discovered = [];
    } else {
      discovered = await discoverOpenAICompatible(provider, apiKey);
    }

    const value = {
      models: modelOptionsForProvider(providerId, discovered),
      source: discovered.length > 0 ? "provider_models" : "curated",
      dynamic: discovered.length > 0,
      error: null,
      fetchedAt: new Date().toISOString()
    };
    cache.set(key, { value, expiresAt: now + DISCOVERY_TTL_MS });
    return value;
  } catch (error) {
    const value = {
      models: modelOptionsForProvider(providerId, []),
      source: "curated",
      dynamic: false,
      error: `${error?.name === "AbortError" ? "timeout" : (error?.message ?? error)}`.slice(0, 240),
      fetchedAt: new Date().toISOString()
    };
    cache.set(key, { value, expiresAt: now + 60_000 });
    return value;
  }
}

function invalidateProviderModelCache(providerId = "", apiKey = "") {
  if (!providerId) {
    cache.clear();
    return;
  }
  const key = cacheKey(providerId, apiKey);
  cache.delete(key);
}

export {
  discoverProviderModels,
  invalidateProviderModelCache
};
