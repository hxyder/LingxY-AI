import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createAIProviderRegistry } from "../providers/registry.mjs";
import { BUILTIN_AI_PROVIDERS } from "../providers/builtin.mjs";
import { createConfiguredAIProvider } from "../providers/configured.mjs";
import { createCodeCliRegistry } from "../code_cli/registry.mjs";
import { BUILTIN_CODE_CLI_ADAPTERS } from "../code_cli/builtin.mjs";
import { createConfiguredCodeCliAdapter } from "../code_cli/configured.mjs";
import { createMCPRegistry } from "../mcp/registry.mjs";
import { BUILTIN_MCP_SERVERS } from "../mcp/builtin.mjs";
import { createConfiguredMCPServer } from "../mcp/configured.mjs";
import { createSkillRegistry } from "../skills/registry.mjs";
import { BUILTIN_SKILL_REGISTRIES, createConfiguredSkillRegistry } from "../skills/builtin.mjs";

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
    ...(config.ai?.skills?.registries ?? []),
    ...readJsonDeclarations(paths?.skillsDir, "registries")
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

  const mcpServers = createMCPRegistry(BUILTIN_MCP_SERVERS);
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
      skillsDir: paths?.skillsDir ?? null,
      codeCliDir: paths?.codeCliDir ?? null
    }
  };
}
