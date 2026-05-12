import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describeMcpEnvRequirements, resolveMcpEnv } from "./env-resolver.mjs";
import { buildMarketplaceTrustPreview } from "../marketplace/trust-model.mjs";

const DEFAULT_TIMEOUT_MS = 3_000;
const COMMAND_EXISTS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRANSPORTS = new Set(["stdio", "http", "ws"]);
const commandExistsCache = new Map();

export function clearMcpCommandExistsCacheForTests() {
  commandExistsCache.clear();
}

export function commandExists(command, {
  now = Date.now(),
  lookup = spawnSync,
  fileExists = existsSync
} = {}) {
  if (!command) {
    return false;
  }
  const cacheKey = `${process.platform}:${command}`;
  const cached = commandExistsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.exists;
  }
  let exists;
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    exists = fileExists(command);
  } else {
    const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
    const result = lookup(lookupCommand, [command], {
      encoding: "utf8",
      windowsHide: true,
      timeout: DEFAULT_TIMEOUT_MS
    });
    exists = result.status === 0;
  }
  commandExistsCache.set(cacheKey, {
    exists,
    expiresAt: now + COMMAND_EXISTS_CACHE_TTL_MS
  });
  return exists;
}

function normalizeTransport(transport) {
  return TRANSPORTS.has(transport) ? transport : "stdio";
}

function resolveSourcePath(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(".json")
    ? source
    : null;
}

function resolveContext(context = {}) {
  return {
    processEnv: context.processEnv ?? process.env,
    secretStore: context.secretStore ?? null
  };
}

export function createConfiguredMCPServer(server = {}) {
  const id = server.id;
  const transport = normalizeTransport(server.transport);
  const displayName = server.displayName ?? server.name ?? id;
  const source = server.source ?? "runtime_config";
  const sourcePath = resolveSourcePath(source);

  return {
    id,
    displayName,
    transport,
    command: server.command ?? null,
    args: Array.isArray(server.args) ? server.args : [],
    url: server.url ?? null,
    env: server.env ?? null,
    enabled: server.enabled !== false,
    source,
    async isAvailable(context = {}) {
      if (server.enabled === false) {
        return false;
      }
      const { processEnv, secretStore } = resolveContext(context);
      const envCheck = resolveMcpEnv(server.env, { processEnv, secretStore });
      if (!envCheck.ok) {
        return false;
      }
      if (transport === "stdio") {
        return commandExists(server.command);
      }
      return Boolean(server.url);
    },
    async getStatus(context = {}) {
      const { processEnv, secretStore } = resolveContext(context);
      const envCheck = resolveMcpEnv(server.env, { processEnv, secretStore });
      const requirements = describeMcpEnvRequirements(server.env);
      const baseAvailable = transport === "stdio"
        ? commandExists(server.command)
        : Boolean(server.url);
      const enabled = server.enabled !== false;
      const available = enabled && envCheck.ok && baseAvailable;
      let detail;
      if (!enabled) {
        detail = "disabled";
      } else if (!envCheck.ok) {
        detail = "missing_config";
      } else if (!baseAvailable) {
        detail = "not_available";
      } else {
        detail = "ready";
      }
      const status = {
        id,
        displayName,
        transport,
        enabled,
        available,
        configured: transport === "stdio" ? Boolean(server.command) : Boolean(server.url),
        command: server.command ?? null,
        args: Array.isArray(server.args) ? server.args : [],
        url: server.url ?? null,
        source,
        ...(sourcePath ? { sourcePath } : {}),
        detail,
        ...(requirements.hasReferences
          ? { envRequirements: requirements.references }
          : {}),
        ...(envCheck.missing.length > 0
          ? { missingEnv: envCheck.missing }
          : {})
      };
      return {
        ...status,
        trustPreview: buildMarketplaceTrustPreview(status, { kind: "mcp_server" })
      };
    },
    async listResources() {
      return [];
    }
  };
}
