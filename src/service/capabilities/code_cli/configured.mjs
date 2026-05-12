import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;

function findCommand(command) {
  if (!command) {
    return null;
  }
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return existsSync(command) ? command : null;
  }

  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [command], {
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

function normalizeStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => entry != null && `${entry}`.trim().length > 0).map((entry) => `${entry}`);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

export function createConfiguredCodeCliAdapter(config = {}) {
  const id = config.id;
  const displayName = config.displayName ?? config.name ?? id;
  const command = config.command ?? config.executable ?? "";

  return {
    id,
    displayName,
    executable: command,
    supportsCheckpointResume: Boolean(config.supportsCheckpointResume),
    source: config.source ?? "runtime_config",
    transport: config.transport ?? "stream_json_print",
    async isAvailable() {
      return Boolean(findCommand(command));
    },
    async getStatus() {
      const resolvedCommand = findCommand(command);
      return {
        id,
        displayName,
        executable: command || null,
        resolvedCommand,
        supportsCheckpointResume: Boolean(config.supportsCheckpointResume),
        available: Boolean(resolvedCommand),
        configured: Boolean(command),
        args: normalizeStringArray(config.args),
        model: config.defaultModel ?? config.model ?? null,
        transport: config.transport ?? "stream_json_print",
        configFile: config.configFile ?? null,
        mcpConfigFiles: normalizeStringArray(config.mcpConfigFiles),
        detail: resolvedCommand ? "command_found" : command ? "command_not_found" : "command_missing",
        source: config.source ?? "runtime_config"
      };
    }
  };
}
