import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const RELEASE_OAUTH_CLIENTS_RESOURCE = "oauth-clients.json";
export const RELEASE_OAUTH_CLIENTS_PATH_ENV = "LINGXY_OAUTH_CLIENTS_PATH";

const CONNECTOR_PROVIDERS = Object.freeze(["google", "microsoft"]);

const CLIENT_ID_ENV_KEYS = Object.freeze({
  google: Object.freeze([
    "LINGXY_RELEASE_GOOGLE_OAUTH_CLIENT_ID",
    "LINGXY_GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_ID"
  ]),
  microsoft: Object.freeze([
    "LINGXY_RELEASE_MICROSOFT_OAUTH_CLIENT_ID",
    "LINGXY_MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_ID"
  ])
});

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProvider(value) {
  const provider = cleanString(value).toLowerCase();
  return CONNECTOR_PROVIDERS.includes(provider) ? provider : "";
}

function clientIdFromEnv(provider, env = process.env) {
  for (const key of CLIENT_ID_ENV_KEYS[provider] ?? []) {
    const value = cleanString(env?.[key]);
    if (value) return value;
  }
  return "";
}

function packagedDefaultCandidates({ env = process.env } = {}) {
  const candidates = [];
  const explicit = cleanString(env?.[RELEASE_OAUTH_CLIENTS_PATH_ENV]);
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, RELEASE_OAUTH_CLIENTS_RESOURCE));
    candidates.push(path.join(process.resourcesPath, "app", RELEASE_OAUTH_CLIENTS_RESOURCE));
  }
  candidates.push(path.join(process.cwd(), ".tmp", "release", RELEASE_OAUTH_CLIENTS_RESOURCE));
  return [...new Set(candidates)];
}

export function normalizeConnectorOAuthDefaults(payload = {}) {
  const source = payload?.connectors && typeof payload.connectors === "object"
    ? payload.connectors
    : payload;
  const connectors = {};
  for (const provider of CONNECTOR_PROVIDERS) {
    const entry = source?.[provider];
    const clientId = cleanString(entry?.clientId ?? entry?.client_id);
    if (!clientId) continue;
    connectors[provider] = { clientId };
  }
  return { connectors };
}

export function loadPackagedConnectorOAuthDefaults(options = {}) {
  for (const candidate of packagedDefaultCandidates(options)) {
    try {
      if (!existsSync(candidate)) continue;
      const parsed = JSON.parse(readFileSync(candidate, "utf8"));
      const normalized = normalizeConnectorOAuthDefaults(parsed);
      if (Object.keys(normalized.connectors).length > 0) return normalized;
    } catch {
      // A malformed optional release defaults file must not break startup.
    }
  }
  return { connectors: {} };
}

export function getConnectorUserConfig(runtime, provider) {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return {};
  const config = runtime?.configStore?.load?.() ?? {};
  return config.connectors?.[normalizedProvider] ?? {};
}

export function resolveConnectorOAuthConfig(runtime, provider, options = {}) {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return {};
  const env = options.env ?? process.env;
  const userConfig = getConnectorUserConfig(runtime, normalizedProvider);
  const userClientId = cleanString(userConfig.clientId ?? userConfig.client_id);
  const defaultClientId = clientIdFromEnv(normalizedProvider, env)
    || cleanString(loadPackagedConnectorOAuthDefaults({ env }).connectors?.[normalizedProvider]?.clientId);
  const clientId = userClientId || defaultClientId;

  // Desktop/native OAuth clients cannot keep a client secret confidential.
  // Only use a user-entered secret when the user also supplied the matching
  // client id; release defaults intentionally provide public client ids only.
  const clientSecret = userClientId ? cleanString(userConfig.clientSecret ?? userConfig.client_secret) : "";

  return {
    ...userConfig,
    clientId,
    clientSecret,
    userClientId,
    hasUserClientId: Boolean(userClientId),
    hasDefaultClientId: Boolean(defaultClientId),
    source: userClientId ? "user" : (defaultClientId ? "release_default" : "missing")
  };
}

export function serializeConnectorConfigForClient(runtime, provider, options = {}) {
  const effective = resolveConnectorOAuthConfig(runtime, provider, options);
  return {
    clientId: effective.hasUserClientId ? effective.clientId : "",
    configured: Boolean(effective.clientId),
    usingDefaultClientId: !effective.hasUserClientId && Boolean(effective.clientId),
    defaultClientIdAvailable: Boolean(effective.hasDefaultClientId),
    hasClientSecret: Boolean(effective.hasUserClientId && effective.clientSecret),
    source: effective.source ?? "missing"
  };
}
