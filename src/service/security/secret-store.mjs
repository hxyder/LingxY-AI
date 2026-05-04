import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE_VERSION = 1;
const REF_PREFIX = "secret://lingxy/";

function defaultRuntimeBaseDir() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "UCA");
  return path.join(os.homedir(), "AppData", "Roaming", "UCA");
}

export function resolveSecretStorePath({
  paths = null,
  configPath = null,
  baseDir = null,
  filePath = null
} = {}) {
  if (filePath) return path.resolve(filePath);
  if (process.env.UCA_SECRET_STORE_PATH) return path.resolve(process.env.UCA_SECRET_STORE_PATH);
  if (paths?.secretsPath) return path.resolve(paths.secretsPath);
  if (baseDir) return path.join(path.resolve(baseDir), "data", "secrets.json");
  if (configPath) {
    const resolvedConfigPath = path.resolve(configPath);
    const configDir = path.dirname(resolvedConfigPath);
    if (path.basename(configDir).toLowerCase() === "config") {
      return path.join(path.dirname(configDir), "data", "secrets.json");
    }
    return path.join(configDir, "secrets.json");
  }
  return path.join(defaultRuntimeBaseDir(), "data", "secrets.json");
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    secrets: {}
  };
}

function normalizeStore(parsed = {}) {
  const secrets = parsed?.secrets && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)
    ? parsed.secrets
    : {};
  return {
    version: STORE_VERSION,
    secrets
  };
}

function readStoreSync(filePath) {
  try {
    if (!filePath || !existsSync(filePath)) return emptyStore();
    return normalizeStore(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return emptyStore();
  }
}

function writeStoreSync(filePath, store) {
  if (!filePath) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, "utf8");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod is best-effort on Windows. The important boundary is that
    // runtime.json no longer carries plaintext provider keys.
  }
}

function encodeRefPart(value) {
  return encodeURIComponent(`${value ?? ""}`.trim());
}

export function createProviderApiKeySecretRef(providerId) {
  return `${REF_PREFIX}provider/${encodeRefPart(providerId)}/apiKey`;
}

export function createMcpEnvSecretRef(serverId, envKey) {
  return `${REF_PREFIX}mcp/${encodeRefPart(serverId)}/env/${encodeRefPart(envKey)}`;
}

export function createLocalSecretStore(options = {}) {
  const filePath = resolveSecretStorePath(options);
  return {
    filePath,
    getSync(ref) {
      if (!ref) return null;
      const entry = readStoreSync(filePath).secrets[ref];
      const value = entry?.value;
      return typeof value === "string" && value.length > 0 ? value : null;
    },
    setSync(ref, value, metadata = {}) {
      const secret = `${value ?? ""}`.trim();
      if (!ref || !secret) return null;
      const store = readStoreSync(filePath);
      store.secrets[ref] = {
        value: secret,
        updatedAt: new Date().toISOString(),
        ...metadata
      };
      writeStoreSync(filePath, store);
      return ref;
    },
    deleteSync(ref) {
      if (!ref) return false;
      const store = readStoreSync(filePath);
      const existed = Object.prototype.hasOwnProperty.call(store.secrets, ref);
      if (existed) {
        delete store.secrets[ref];
        writeStoreSync(filePath, store);
      }
      return existed;
    }
  };
}

function storeFromOptions(options = {}) {
  if (options.secretStore) return options.secretStore;
  return createLocalSecretStore(options);
}

export function providerHasConfiguredApiKey(provider = {}, options = {}) {
  if (!provider || provider.kind === "code_cli" || provider.kind === "ollama") return false;
  const inlineKey = `${provider.apiKey ?? ""}`.trim();
  if (inlineKey) return true;
  const ref = `${provider.apiKeyRef ?? ""}`.trim();
  if (!ref) return false;
  if (options.requireReadable === false) return true;
  return Boolean(storeFromOptions(options).getSync(ref));
}

export function hydrateProviderApiKeySecretSync(provider = {}, options = {}) {
  if (!provider || provider.kind === "code_cli" || provider.kind === "ollama") {
    return provider;
  }
  const inlineKey = `${provider.apiKey ?? ""}`.trim();
  if (inlineKey) return provider;
  const ref = `${provider.apiKeyRef ?? ""}`.trim();
  if (!ref) return provider;
  const secret = storeFromOptions(options).getSync(ref);
  return secret ? { ...provider, apiKey: secret } : provider;
}

export function migrateProviderApiKeySecretSync(provider = {}, options = {}) {
  if (!provider || provider.kind === "code_cli" || provider.kind === "ollama") {
    return provider ? { ...provider } : provider;
  }
  const inlineKey = `${provider.apiKey ?? ""}`.trim();
  const existingRef = `${provider.apiKeyRef ?? ""}`.trim();
  const ref = existingRef || createProviderApiKeySecretRef(provider.id);
  const next = { ...provider };
  if (inlineKey) {
    storeFromOptions(options).setSync(ref, inlineKey, {
      kind: "provider_api_key",
      providerId: provider.id ?? null
    });
    next.apiKeyRef = ref;
  } else if (existingRef) {
    next.apiKeyRef = existingRef;
  }
  delete next.apiKey;
  return next;
}

export function migrateProviderApiKeySecretsSync(providers = [], options = {}) {
  return (providers ?? []).map((provider) => migrateProviderApiKeySecretSync(provider, options));
}

export function deleteProviderApiKeySecretSync(provider = {}, options = {}) {
  const ref = `${provider?.apiKeyRef ?? ""}`.trim() || createProviderApiKeySecretRef(provider?.id);
  return storeFromOptions(options).deleteSync(ref);
}

export function redactProviderSecret(provider = {}, options = {}) {
  if (!provider || typeof provider !== "object") return provider;
  const next = { ...provider };
  const configured = providerHasConfiguredApiKey(provider, {
    ...options,
    requireReadable: false
  });
  delete next.apiKey;
  if (provider.kind !== "code_cli" && provider.kind !== "ollama") {
    next.apiKeyConfigured = configured;
  }
  return next;
}
