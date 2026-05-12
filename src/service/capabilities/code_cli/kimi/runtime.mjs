import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;

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

function normalizeStringArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry != null && `${entry}`.trim().length > 0)
      .map((entry) => `${entry}`);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizeStringArray(parsed);
      }
    } catch {
      return [trimmed];
    }
  }
  return [];
}

function normalizeEnvPatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === "string" && key.trim().length > 0)
      .map(([key, entry]) => [key, entry == null ? undefined : `${entry}`])
  );
}

function splitPathList(value) {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveKimiHome(env) {
  return firstNonEmpty(
    env.UCA_KIMI_HOME,
    env.KIMI_HOME,
    path.join(os.homedir(), ".kimi")
  );
}

function resolveCredentialPath({ config = {}, env = process.env } = {}) {
  const kimiHome = resolveKimiHome(env);
  const explicitPath = firstNonEmpty(
    config.credentialPath,
    env.UCA_KIMI_CREDENTIAL_PATH
  );
  const candidate = explicitPath ?? path.join(kimiHome, "credentials", "kimi-code.json");
  return existsSync(candidate) ? candidate : null;
}

function resolveConfigFile({ config = {}, env = process.env } = {}) {
  const kimiHome = resolveKimiHome(env);
  const explicitPath = firstNonEmpty(
    config.configFile,
    env.UCA_KIMI_CONFIG_FILE
  );
  const candidate = explicitPath ?? path.join(kimiHome, "config.toml");
  return existsSync(candidate) ? candidate : null;
}

function resolveMcpConfigFiles({ config = {}, env = process.env } = {}) {
  const configured = normalizeStringArray(config.mcpConfigFiles);
  if (configured.length > 0) {
    return configured.filter((entry) => existsSync(entry));
  }
  return splitPathList(env.UCA_KIMI_MCP_CONFIG_FILES).filter((entry) => existsSync(entry));
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

function probeVersion(command, env) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: DEFAULT_TIMEOUT_MS,
    env
  });
  const stdout = `${result.stdout ?? ""}`.trim();
  const stderr = `${result.stderr ?? ""}`.trim();
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  const versionMatch = combined.match(/version\s+([0-9][0-9A-Za-z._-]+)/i);

  return {
    ok: result.status === 0,
    version: versionMatch?.[1] ?? null,
    detail: combined || `exit_${result.status ?? "unknown"}`
  };
}

function buildMergedEnv({ baseEnv = process.env, envPatch = {} } = {}) {
  const merged = {
    ...baseEnv,
    ...normalizeEnvPatch(envPatch)
  };

  if (process.platform === "win32") {
    merged.PYTHONIOENCODING ??= "utf-8";
    merged.PYTHONUTF8 ??= "1";
    merged.LANG ??= "C.UTF-8";
    merged.LC_ALL ??= "C.UTF-8";
  }

  return merged;
}

export function getKimiRuntimeStatus({
  explicitRuntime = null,
  config = {},
  env = process.env
} = {}) {
  const mergedEnv = buildMergedEnv({
    baseEnv: env,
    envPatch: explicitRuntime?.env ?? config.env
  });
  const command = firstNonEmpty(
    explicitRuntime?.command,
    config.command,
    env.UCA_KIMI_COMMAND,
    env.KIMI_COMMAND,
    commandOnPath("kimi")
  );
  const args = normalizeStringArray(
    firstNonEmpty(
      explicitRuntime?.args,
      config.args,
      env.UCA_KIMI_ARGS_JSON
    )
  );
  const transport = firstNonEmpty(
    explicitRuntime?.transport,
    config.transport,
    env.UCA_KIMI_TRANSPORT,
    explicitRuntime?.command ? "jsonl_task_package" : "stream_json_print"
  );
  const model = firstNonEmpty(
    explicitRuntime?.model,
    config.model,
    env.UCA_KIMI_MODEL
  );
  const maxRuntimeSeconds = Number(
    firstNonEmpty(
      explicitRuntime?.maxRuntimeSeconds,
      config.maxRuntimeSeconds,
      env.UCA_KIMI_MAX_RUNTIME_SECONDS,
      600
    )
  );
  const credentialPath = resolveCredentialPath({ config, env: mergedEnv });
  const configFile = resolveConfigFile({ config, env: mergedEnv });
  const mcpConfigFiles = resolveMcpConfigFiles({ config, env: mergedEnv });

  if (!command) {
    return {
      id: "kimi-code-cli",
      displayName: "Kimi Code CLI",
      available: false,
      configured: Boolean(credentialPath || configFile),
      transport,
      command: null,
      args,
      model,
      maxRuntimeSeconds,
      credentialPath,
      configFile,
      mcpConfigFiles,
      version: null,
      detail: "command_not_found"
    };
  }

  const versionProbe = probeVersion(command, mergedEnv);
  return {
    id: "kimi-code-cli",
    displayName: "Kimi Code CLI",
    available: versionProbe.ok,
    configured: Boolean(
      mergedEnv.KIMI_API_KEY
      || mergedEnv.MOONSHOT_API_KEY
      || credentialPath
      || configFile
    ),
    transport,
    command,
    args,
    model,
    maxRuntimeSeconds,
    credentialPath,
    configFile,
    mcpConfigFiles,
    version: versionProbe.version,
    detail: versionProbe.detail
  };
}

export function resolveKimiRuntime({
  explicitRuntime = null,
  config = {},
  env = process.env
} = {}) {
  if (explicitRuntime?.command && !explicitRuntime.transport) {
    return {
      ...explicitRuntime,
      transport: "jsonl_task_package",
      maxRuntimeSeconds: explicitRuntime.maxRuntimeSeconds ?? 600,
      env: buildMergedEnv({
        baseEnv: env,
        envPatch: explicitRuntime.env
      })
    };
  }

  const status = getKimiRuntimeStatus({
    explicitRuntime,
    config,
    env
  });

  if (!status.available) {
    return null;
  }

  return {
    command: status.command,
    args: status.args,
    env: buildMergedEnv({
      baseEnv: env,
      envPatch: explicitRuntime?.env ?? config.env
    }),
    transport: status.transport,
    model: status.model,
    maxRuntimeSeconds: status.maxRuntimeSeconds,
    configFile: status.configFile,
    credentialPath: status.credentialPath,
    mcpConfigFiles: status.mcpConfigFiles,
    availability: status
  };
}
