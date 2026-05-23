import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 3_000;

const CAPABILITIES_BY_KIND = Object.freeze({
  anthropic: {
    supportsStreaming: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsEmbeddings: false
  },
  openai: {
    supportsStreaming: true,
    supportsToolUse: true,
    supportsVision: true,
    supportsEmbeddings: true
  },
  ollama: {
    supportsStreaming: true,
    supportsToolUse: false,
    supportsVision: false,
    supportsEmbeddings: true
  },
  code_cli: {
    supportsStreaming: true,
    supportsToolUse: true,
    supportsVision: false,
    supportsEmbeddings: false
  }
});

function commandOnPath(executable) {
  if (!executable) {
    return null;
  }
  if (path.isAbsolute(executable) || executable.includes(path.sep)) {
    return existsSync(executable) ? executable : null;
  }

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

function defaultCapabilities(kind) {
  return CAPABILITIES_BY_KIND[kind] ?? {
    supportsStreaming: false,
    supportsToolUse: false,
    supportsVision: false,
    supportsEmbeddings: false
  };
}

function providerDisplayName(provider) {
  return provider.displayName ?? provider.name ?? provider.id;
}

function normalizeProviderKind(kind) {
  if (kind === "anthropic" || kind === "openai" || kind === "ollama" || kind === "code_cli") {
    return kind;
  }
  return "openai";
}

function providerHasApiCredential(provider = {}) {
  return Boolean(provider.apiKey || provider.apiKeyRef || provider.apiKeyConfigured);
}

export function createConfiguredAIProvider(provider = {}) {
  const id = provider.id;
  const kind = normalizeProviderKind(provider.kind);
  const displayName = providerDisplayName(provider);
  const capabilities = {
    ...defaultCapabilities(kind),
    ...(provider.capabilities ?? {})
  };

  return {
    id,
    kind,
    displayName,
    capabilities,
    source: provider.source ?? "runtime_config",
    async isConfigured() {
      if (kind === "code_cli") {
        return Boolean(provider.command);
      }
      return kind === "ollama" || providerHasApiCredential(provider);
    },
    async validateConfig() {
      const configured = await this.isConfigured();
      if (!configured) {
        throw new Error(`${id}: provider_missing_required_configuration`);
      }
    },
    async getStatus() {
      if (kind === "code_cli") {
        const executable = provider.command ?? "";
        const resolvedCommand = commandOnPath(executable);
        return {
          id,
          displayName,
          kind: "code_cli",
          configured: Boolean(executable),
          available: Boolean(resolvedCommand),
          command: executable || null,
          resolvedCommand,
          model: provider.defaultModel ?? provider.model ?? null,
          transport: provider.transport ?? "stream_json_print",
          mcpConfigFiles: provider.mcpConfigFiles ?? [],
          capabilities,
          detail: resolvedCommand ? "command_found" : executable ? "command_not_found" : "command_missing",
          source: provider.source ?? "runtime_config"
        };
      }

      const configured = kind === "ollama" || providerHasApiCredential(provider);
      return {
        id,
        displayName,
        kind,
        configured,
        available: configured,
        baseUrl: provider.baseUrl ?? null,
        model: provider.defaultModel ?? provider.model ?? null,
        capabilities,
        detail: configured ? "configured" : "api_key_missing",
        source: provider.source ?? "runtime_config"
      };
    }
  };
}
