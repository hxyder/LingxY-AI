import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAIProviderRegistry } from "../providers/registry.mjs";
import { BUILTIN_AI_PROVIDERS } from "../providers/builtin.mjs";
import { createConfiguredAIProvider } from "../providers/configured.mjs";
import { createCodeCliRegistry } from "../code_cli/registry.mjs";
import { BUILTIN_CODE_CLI_ADAPTERS } from "../code_cli/builtin.mjs";
import { createConfiguredCodeCliAdapter } from "../code_cli/configured.mjs";
import { createMCPRegistry } from "../../capabilities/mcp/registry.mjs";
import { BUILTIN_MCP_SERVERS } from "../../capabilities/mcp/builtin.mjs";
import { createConfiguredMCPServer } from "../../capabilities/mcp/configured.mjs";
import { describeMcpEnvRequirements, resolveMcpEnv } from "../../capabilities/mcp/env-resolver.mjs";
import { createSkillRegistry } from "../../capabilities/skills/registry.mjs";
import { BUILTIN_SKILL_REGISTRIES, createConfiguredSkillRegistry } from "../../capabilities/skills/builtin.mjs";
import { deriveSkillRegistryId, resolveSkillRootPath } from "../../capabilities/skills/discovery.mjs";

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readJsonDeclarations(directory, key) {
  if (!directory || !existsSync(directory)) {
    return [];
  }

  const declarations = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const values = parsed?.[key] ?? parsed;
    for (const value of asArray(values)) {
      declarations.push({
        ...value,
        source: value.source ?? filePath
      });
    }
  }
  return declarations;
}

function validEntries(entries) {
  return entries.filter((entry) => entry && typeof entry.id === "string" && entry.id.trim().length > 0);
}

function uniqueById(entries) {
  const indexed = new Map();
  for (const entry of validEntries(entries)) {
    indexed.set(entry.id, entry);
  }
  return [...indexed.values()];
}

function normalizeSkillRegistryEntry(entry = {}) {
  if (!entry || typeof entry !== "object") return null;
  const rootPath = resolveSkillRootPath(entry.rootPath ?? entry.path);
  if (!rootPath) return null;
  const source = entry.source ?? "runtime_config";
  return {
    ...entry,
    id: typeof entry.id === "string" && entry.id.trim()
      ? entry.id.trim()
      : deriveSkillRegistryId(rootPath, { source }),
    rootPath,
    source
  };
}

function normalizeSkillRegistryEntries(entries = []) {
  return entries.map(normalizeSkillRegistryEntry).filter(Boolean);
}

function customProviderEntries(config) {
  return validEntries([
    ...(config.ai?.customProviders ?? []),
    ...(config.ai?.providers?.custom ?? [])
  ]);
}

function codeCliEntries(config, paths) {
  return uniqueById([
    ...customProviderEntries(config).filter((provider) => provider.kind === "code_cli"),
    ...(config.ai?.codeCli?.adapters ?? []),
    ...readJsonDeclarations(paths?.codeCliDir, "adapters")
  ]);
}

function providerEntries(config) {
  return customProviderEntries(config);
}

function mcpEntries(config, paths) {
  return uniqueById([
    ...(config.ai?.mcp?.servers ?? []),
    ...readJsonDeclarations(paths?.mcpDir, "servers")
  ]);
}

function skillRegistryEntries(config, paths) {
  const runtimeSkillRegistry = paths?.skillsDir
    ? [{
        id: "user-runtime-skills",
        displayName: "User Runtime Skills",
        rootPath: paths.skillsDir,
        source: "runtime_paths"
      }]
    : [];

  return uniqueById([
    ...runtimeSkillRegistry,
    ...normalizeSkillRegistryEntries(config.ai?.skills?.registries ?? []),
    ...normalizeSkillRegistryEntries(readJsonDeclarations(paths?.skillsDir, "registries"))
  ]);
}

export function buildAIIntegrationRegistries({ config = {}, paths = null, manual = {} } = {}) {
  const aiProviders = createAIProviderRegistry(BUILTIN_AI_PROVIDERS);
  for (const provider of providerEntries(config)) {
    aiProviders.register(createConfiguredAIProvider(provider));
  }
  for (const provider of manual.providers ?? []) {
    aiProviders.register(provider);
  }

  const codeCliAdapters = createCodeCliRegistry(BUILTIN_CODE_CLI_ADAPTERS);
  for (const adapter of codeCliEntries(config, paths)) {
    codeCliAdapters.register(createConfiguredCodeCliAdapter(adapter));
  }
  for (const adapter of manual.codeCliAdapters ?? []) {
    codeCliAdapters.register(adapter);
  }

  // Apply per-server toggles and env overrides from config (set via Console → Connectors)
  const builtinToggles = config.ai?.mcp?.builtinToggles ?? {};
  const envOverrides = config.ai?.mcp?.envOverrides ?? {};
  const patchedBuiltins = BUILTIN_MCP_SERVERS.map((server) => {
    const toggle = builtinToggles[server.id];
    const envPatch = envOverrides[server.id];
    if (!toggle && !envPatch) return server;
    const patchedEnabled = toggle ? toggle.enabled : server.enabled;
    const patchedEnv = envPatch ? { ...(server.env ?? {}), ...envPatch } : server.env;
    // Shallow-clone the server object with patched enabled / env fields
    return {
      ...server,
      enabled: patchedEnabled,
      env: patchedEnv,
      // Re-bind async methods that read from `enabled` / `env` closure to use
      // the patched values from runtime config.
      async isAvailable(context = {}) {
        const envCheck = resolveMcpEnv(patchedEnv, {
          processEnv: context.processEnv ?? process.env,
          secretStore: context.secretStore ?? null
        });
        if (!patchedEnabled || !envCheck.ok) return false;
        const orig = await server.isAvailable?.(context);
        return orig !== false;
      },
      async getStatus(context = {}) {
        const base = await server.getStatus?.(context) ?? {};
        const envCheck = resolveMcpEnv(patchedEnv, {
          processEnv: context.processEnv ?? process.env,
          secretStore: context.secretStore ?? null
        });
        const requirements = describeMcpEnvRequirements(patchedEnv);
        const baseAvailable = base.available !== false;
        const available = patchedEnabled && envCheck.ok && baseAvailable;
        let detail = base.detail ?? (baseAvailable ? "ready" : "not_available");
        if (!patchedEnabled) {
          detail = "disabled";
        } else if (!envCheck.ok) {
          detail = "missing_config";
        }
        return {
          ...base,
          enabled: patchedEnabled,
          env: patchedEnv,
          available,
          detail,
          ...(requirements.hasReferences ? { envRequirements: requirements.references } : {}),
          ...(envCheck.missing.length > 0 ? { missingEnv: envCheck.missing } : {})
        };
      }
    };
  });

  const mcpServers = createMCPRegistry(patchedBuiltins);
  for (const server of mcpEntries(config, paths)) {
    mcpServers.register(createConfiguredMCPServer(server));
  }
  for (const server of manual.mcpServers ?? []) {
    mcpServers.register(server);
  }

  const skillRegistries = createSkillRegistry(BUILTIN_SKILL_REGISTRIES);
  for (const registry of skillRegistryEntries(config, paths)) {
    skillRegistries.register(createConfiguredSkillRegistry(registry));
  }
  for (const registry of manual.skillRegistries ?? []) {
    skillRegistries.register(registry);
  }

  return {
    aiProviders,
    codeCliAdapters,
    mcpServers,
    skillRegistries
  };
}

function createReloadingRegistry({ key, build, manual, manualKey }) {
  const current = () => build()[key];

  return {
    register(entry) {
      manual[manualKey].push(entry);
      return entry;
    },
    list(...args) {
      return current().list(...args);
    },
    get(...args) {
      return current().get?.(...args) ?? null;
    },
    listStatus(...args) {
      return current().listStatus?.(...args) ?? [];
    },
    getStatus(...args) {
      return current().getStatus?.(...args) ?? null;
    },
    listResources(...args) {
      return current().listResources?.(...args) ?? [];
    },
    listSkills(...args) {
      return current().listSkills?.(...args) ?? [];
    }
  };
}

export function createAIIntegrationRuntime({ configStore = null, paths = null } = {}) {
  const manual = {
    providers: [],
    codeCliAdapters: [],
    mcpServers: [],
    skillRegistries: []
  };
  const loadConfig = () => configStore?.load?.() ?? {};
  const build = () => buildAIIntegrationRegistries({
    config: loadConfig(),
    paths,
    manual
  });

  return {
    aiProviders: createReloadingRegistry({
      key: "aiProviders",
      build,
      manual,
      manualKey: "providers"
    }),
    codeCliAdapters: createReloadingRegistry({
      key: "codeCliAdapters",
      build,
      manual,
      manualKey: "codeCliAdapters"
    }),
    mcpServers: createReloadingRegistry({
      key: "mcpServers",
      build,
      manual,
      manualKey: "mcpServers"
    }),
    skillRegistries: createReloadingRegistry({
      key: "skillRegistries",
      build,
      manual,
      manualKey: "skillRegistries"
    }),
    integrationPaths: {
      baseDir: paths?.integrationsDir ?? null,
      mcpDir: paths?.mcpDir ?? null,
      mcpInstallDir: paths?.mcpInstallDir ?? null,
      skillsDir: paths?.skillsDir ?? null,
      codeCliDir: paths?.codeCliDir ?? null
    }
  };
}
