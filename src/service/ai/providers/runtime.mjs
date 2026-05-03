import { spawnSync } from "node:child_process";
import { getKimiRuntimeStatus } from "../code_cli/kimi/runtime.mjs";

const DEFAULT_TIMEOUT_MS = 3_000;

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return null;
}

function commandOnPath(executable) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [executable], {
    encoding: "utf8",
    windowsHide: true,
    timeout: DEFAULT_TIMEOUT_MS
  });

  if (result.status !== 0) {
    return null;
  }

  return `${result.stdout ?? ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function readEnvKey(env, ...keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        key,
        value
      };
    }
  }
  return null;
}

function normalizeBaseUrl(url) {
  if (!url) {
    return null;
  }
  if (/^https?:\/\//i.test(url)) {
    return url.replace(/\/+$/, "");
  }
  return `http://${url.replace(/\/+$/, "")}`;
}

async function probeJson(baseUrl, pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(pathname, `${baseUrl}/`), {
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.name === "AbortError" ? "timeout" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildCloudStatus({
  id,
  displayName,
  env,
  config = {},
  apiKeyNames = [],
  defaultBaseUrl,
  model = null
}) {
  const envKey = readEnvKey(env, ...apiKeyNames);
  const configured = Boolean(config.apiKey || envKey);
  const baseUrl = firstNonEmpty(config.baseUrl, defaultBaseUrl);

  return {
    id,
    displayName,
    kind: "cloud",
    available: configured,
    configured,
    authSource: config.apiKey ? "runtime_config" : envKey ? `env:${envKey.key}` : null,
    baseUrl,
    model: firstNonEmpty(config.model, model),
    detail: configured ? "api_key_present" : "api_key_missing"
  };
}

async function buildOllamaStatus({ config = {}, env = process.env } = {}) {
  const command = firstNonEmpty(
    config.command,
    env.UCA_OLLAMA_COMMAND,
    commandOnPath("ollama")
  );
  const baseUrl = normalizeBaseUrl(firstNonEmpty(
    config.baseUrl,
    env.UCA_OLLAMA_BASE_URL,
    env.OLLAMA_HOST,
    "http://127.0.0.1:11434"
  ));
  const probe = await probeJson(baseUrl, "/api/tags");
  const models = Array.isArray(probe.json?.models)
    ? probe.json.models
        .map((entry) => entry?.name)
        .filter((entry) => typeof entry === "string" && entry.length > 0)
    : [];

  return {
    id: "ollama.local",
    displayName: "Ollama Local",
    kind: "local",
    available: probe.ok,
    configured: Boolean(command || baseUrl),
    command,
    baseUrl,
    model: firstNonEmpty(config.model, env.UCA_OLLAMA_MODEL, models[0] ?? null),
    models,
    detail: probe.ok
      ? `reachable:${probe.status}`
      : probe.error
        ? `unreachable:${probe.error}`
        : `unreachable:${probe.status}`
  };
}

async function buildKimiProviderStatus({ config = {}, env = process.env } = {}) {
  const envKey = readEnvKey(env, "MOONSHOT_API_KEY", "KIMI_API_KEY", "UCA_KIMI_API_KEY");
  const kimiCodeCli = getKimiRuntimeStatus({ config: config.codeCli ?? {}, env });
  const configured = Boolean(config.apiKey || envKey);

  return {
    id: "kimi.k2",
    displayName: "Kimi K2.6",
    kind: "cloud",
    available: configured,
    configured,
    authSource: config.apiKey ? "runtime_config" : envKey ? `env:${envKey.key}` : null,
    baseUrl: firstNonEmpty(config.baseUrl, "https://api.moonshot.cn/v1"),
    model: firstNonEmpty(config.model, "kimi-k2.6"),
    detail: configured ? "api_key_present" : "api_key_missing",
    codeCliLinked: kimiCodeCli.available
  };
}

export async function getBuiltinProviderStatus(providerId, {
  config = {},
  env = process.env
} = {}) {
  if (providerId === "anthropic.claude-sonnet") {
    return buildCloudStatus({
      id: providerId,
      displayName: "Claude Sonnet",
      env,
      config,
      apiKeyNames: ["ANTHROPIC_API_KEY", "UCA_ANTHROPIC_API_KEY"],
      defaultBaseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514"
    });
  }

  if (providerId === "openai.gpt-5-mini") {
    return buildCloudStatus({
      id: providerId,
      displayName: "OpenAI GPT-5 Mini",
      env,
      config,
      apiKeyNames: ["OPENAI_API_KEY", "UCA_OPENAI_API_KEY"],
      defaultBaseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini"
    });
  }

  if (providerId === "kimi.k2") {
    return buildKimiProviderStatus({ config, env });
  }

  if (providerId === "ollama.local") {
    return buildOllamaStatus({ config, env });
  }

  return {
    id: providerId,
    available: false,
    configured: false,
    detail: "provider_not_supported"
  };
}
