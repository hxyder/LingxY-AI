import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;
const TRANSPORTS = new Set(["stdio", "http", "ws"]);

function commandExists(command) {
  if (!command) {
    return false;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return existsSync(command);
  }

  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: DEFAULT_TIMEOUT_MS
  });
  return result.status === 0;
}

function normalizeTransport(transport) {
  return TRANSPORTS.has(transport) ? transport : "stdio";
}

function resolveSourcePath(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(".json")
    ? source
    : null;
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
    async isAvailable() {
      if (server.enabled === false) {
        return false;
      }
      if (transport === "stdio") {
        return commandExists(server.command);
      }
      return Boolean(server.url);
    },
    async getStatus() {
      const available = await this.isAvailable();
      return {
        id,
        displayName,
        transport,
        enabled: server.enabled !== false,
        available,
        configured: transport === "stdio" ? Boolean(server.command) : Boolean(server.url),
        command: server.command ?? null,
        args: Array.isArray(server.args) ? server.args : [],
        url: server.url ?? null,
        source,
        ...(sourcePath ? { sourcePath } : {}),
        detail: available ? "ready" : server.enabled === false ? "disabled" : "not_available"
      };
    },
    async listResources() {
      return [];
    }
  };
}
