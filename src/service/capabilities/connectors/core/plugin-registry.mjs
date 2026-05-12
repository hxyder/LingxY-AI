import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  archiveMarketplaceInstallDirectory,
  normalizeMarketplaceDistribution
} from "../../marketplace/distribution-policy.mjs";
import { buildMarketplaceTrustPreview } from "../../marketplace/trust-model.mjs";

const STATE_FILE = ".state.json";
const MANIFEST_FILE = "plugin.json";

function defaultPluginsDir() {
  const base = process.env.LINGXY_PLUGINS_DIR
    ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "LingxY", "plugins");
  return base;
}

function readManifest(directory) {
  const manifestPath = path.join(directory, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`plugin.json not found in ${directory}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.id) {
    throw new Error("plugin.json missing required field: id");
  }
  if (!Array.isArray(manifest.contracts) && !Array.isArray(manifest.workflows)) {
    throw new Error("plugin.json must declare at least one of contracts[] or workflows[]");
  }
  return manifest;
}

function readStateFile(pluginsDir) {
  const file = path.join(pluginsDir, STATE_FILE);
  if (!existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeStateFile(pluginsDir, state) {
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }
  writeFileSync(path.join(pluginsDir, STATE_FILE), JSON.stringify(state, null, 2));
}

function listInstalledDirectories(pluginsDir) {
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      directory: path.join(pluginsDir, entry.name)
    }))
    .filter(({ directory }) => existsSync(path.join(directory, MANIFEST_FILE)));
}

function attachMarketplaceMetadata(plugin, manifest = {}) {
  const withSignature = {
    ...plugin,
    signature: manifest.signature ?? plugin.signature ?? null,
    shareable: manifest.shareable === true || plugin.shareable === true
  };
  const distribution = normalizeMarketplaceDistribution(withSignature, { kind: "plugin" });
  const next = {
    ...withSignature,
    distribution,
    signatureVerified: distribution.signature.state === "verified",
    shareable: distribution.shareable
  };
  return {
    ...next,
    trustPreview: buildMarketplaceTrustPreview(next, { kind: "plugin" })
  };
}

function describeBuiltInPlugins(rootConnectorsDir) {
  if (!existsSync(rootConnectorsDir)) return [];
  return readdirSync(rootConnectorsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !["core", "tools"].includes(entry.name))
    .map((entry) => {
      const plugin = {
        id: entry.name,
        displayName: entry.name,
        version: "built-in",
        provider: entry.name,
        source: "builtin",
        enabled: true,
        directory: path.join(rootConnectorsDir, entry.name),
        mcpServers: []
      };
      return attachMarketplaceMetadata(plugin);
    });
}

/**
 * Build the plugin registry. `runtime.pluginRegistry` is the canonical CRUD
 * surface for connector plugins (both internal providers and installed
 * external packages).
 */
export function createPluginRegistry({ runtime, pluginsDir = null, builtInsDir = null } = {}) {
  if (!runtime) {
    throw new Error("runtime is required");
  }
  const dir = pluginsDir ?? defaultPluginsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const builtInRoot = builtInsDir ?? path.resolve(fileURLToPath(new URL("..", import.meta.url)));

  function readPluginRecord(id, directory) {
    try {
      const manifest = readManifest(directory);
      const state = readStateFile(dir)[id] ?? { enabled: true };
      const plugin = {
        id: manifest.id ?? id,
        displayName: manifest.displayName ?? manifest.id ?? id,
        description: manifest.description ?? "",
        version: manifest.version ?? "0.0.0",
        provider: manifest.provider ?? manifest.id ?? id,
        source: "installed",
        enabled: state.enabled !== false,
        installedAt: state.installedAt ?? null,
        directory,
        mcpServers: Array.isArray(manifest.mcpServers) ? manifest.mcpServers : []
      };
      return attachMarketplaceMetadata(plugin, manifest);
    } catch (error) {
      const plugin = {
        id,
        source: "installed",
        enabled: false,
        directory,
        status: "broken",
        error: error.message,
        mcpServers: []
      };
      return attachMarketplaceMetadata(plugin);
    }
  }

  function snapshot() {
    const builtIns = describeBuiltInPlugins(builtInRoot);
    const state = readStateFile(dir);
    const builtInsWithState = builtIns.map((plugin) => {
      const next = {
        ...plugin,
        enabled: state[plugin.id]?.enabled !== false
      };
      return attachMarketplaceMetadata(next);
    });
    const installed = listInstalledDirectories(dir).map(({ id, directory }) => readPluginRecord(id, directory));
    return [...builtInsWithState, ...installed];
  }

  function activePluginRoots() {
    return snapshot()
      .filter((plugin) => plugin.enabled && plugin.status !== "broken" && plugin.source === "installed")
      .map((plugin) => ({
        pluginId: plugin.id,
        provider: plugin.provider,
        directory: plugin.directory
      }));
  }

  function disabledBuiltInProviders() {
    return new Set(
      snapshot()
        .filter((plugin) => plugin.source === "builtin" && !plugin.enabled)
        .map((plugin) => plugin.provider)
    );
  }

  function reload() {
    runtime.connectorCatalog?.reload?.();
  }

  function setEnabled(pluginId, enabled) {
    const plugins = snapshot();
    const plugin = plugins.find((entry) => entry.id === pluginId);
    if (!plugin) {
      throw new Error(`plugin_not_found: ${pluginId}`);
    }
    const state = readStateFile(dir);
    state[pluginId] = {
      ...(state[pluginId] ?? {}),
      enabled: Boolean(enabled)
    };
    writeStateFile(dir, state);
    reload();
    return snapshot().find((entry) => entry.id === pluginId) ?? null;
  }

  function previewInstall({ sourcePath } = {}) {
    if (!sourcePath || typeof sourcePath !== "string") {
      throw new Error("sourcePath is required");
    }
    const resolved = path.resolve(sourcePath);
    if (!existsSync(resolved)) {
      throw new Error(`source_not_found: ${resolved}`);
    }
    const stats = statSync(resolved);
    if (!stats.isDirectory()) {
      throw new Error("only directory sources are supported in this release");
    }
    const manifest = readManifest(resolved);
    const plugin = {
      id: manifest.id,
      displayName: manifest.displayName ?? manifest.id,
      description: manifest.description ?? "",
      version: manifest.version ?? "0.0.0",
      provider: manifest.provider ?? manifest.id,
      source: "installed",
      enabled: false,
      directory: resolved,
      mcpServers: Array.isArray(manifest.mcpServers) ? manifest.mcpServers : []
    };
    const withMarketplace = attachMarketplaceMetadata(plugin, manifest);
    return {
      plugin: withMarketplace,
      trustPreview: withMarketplace.trustPreview,
      distribution: withMarketplace.distribution
    };
  }

  async function install({ sourcePath } = {}) {
    if (!sourcePath || typeof sourcePath !== "string") {
      throw new Error("sourcePath is required");
    }
    const resolved = path.resolve(sourcePath);
    if (!existsSync(resolved)) {
      throw new Error(`source_not_found: ${resolved}`);
    }
    const stats = statSync(resolved);
    if (!stats.isDirectory()) {
      throw new Error("only directory sources are supported in this release");
    }
    const manifest = readManifest(resolved);
    const targetDir = path.join(dir, manifest.id);
    if (existsSync(targetDir)) {
      throw new Error(`plugin_already_installed: ${manifest.id}`);
    }
    cpSync(resolved, targetDir, { recursive: true });

    const state = readStateFile(dir);
    state[manifest.id] = {
      enabled: true,
      installedAt: new Date().toISOString(),
      version: manifest.version ?? "0.0.0",
      signatureState: normalizeMarketplaceDistribution({
        signature: manifest.signature ?? null,
        shareable: manifest.shareable === true
      }, { kind: "plugin" }).signature.state
    };
    writeStateFile(dir, state);

    // Register declared MCP servers (disabled by default so the user still
    // has to enable them explicitly in Console).
    if (Array.isArray(manifest.mcpServers) && runtime.mcpRegistry) {
      for (const entry of manifest.mcpServers) {
        const resolvedArgs = (entry.args ?? []).map((arg) =>
          typeof arg === "string" ? arg.replace("${PLUGIN_DIR}", targetDir) : arg
        );
        runtime.mcpRegistry.register({
          ...entry,
          id: entry.id,
          displayName: entry.displayName ?? entry.id,
          transport: entry.transport ?? "stdio",
          command: entry.command,
          args: resolvedArgs,
          env: entry.env ?? null,
          enabled: false,
          source: `plugin:${manifest.id}`,
          async isAvailable() { return false; },
          async getStatus() {
            return {
              id: entry.id,
              displayName: entry.displayName ?? entry.id,
              transport: entry.transport ?? "stdio",
              enabled: false,
              available: false,
              detail: `plugin_declared_mcp_server:${manifest.id}`,
              command: entry.command,
              args: resolvedArgs,
              env: entry.env ?? null
            };
          },
          async listResources() { return []; }
        });
      }
    }

    reload();
    return snapshot().find((entry) => entry.id === manifest.id) ?? null;
  }

  async function uninstall(pluginId) {
    const plugins = snapshot();
    const plugin = plugins.find((entry) => entry.id === pluginId);
    if (!plugin) {
      throw new Error(`plugin_not_found: ${pluginId}`);
    }
    if (plugin.source === "builtin") {
      throw new Error("built-in plugins cannot be uninstalled; disable instead");
    }
    const archive = archiveMarketplaceInstallDirectory({
      sourceDir: plugin.directory,
      archiveRoot: path.join(dir, ".archive"),
      id: plugin.id
    });
    const state = readStateFile(dir);
    delete state[pluginId];
    writeStateFile(dir, state);
    reload();
    return attachMarketplaceMetadata({
      ...plugin,
      ...archive,
      enabled: false,
      status: "archived"
    });
  }

  return {
    directory: dir,
    list() {
      return snapshot();
    },
    pluginRootsProvider() {
      return activePluginRoots();
    },
    disabledBuiltInProviders,
    reload,
    setEnabled,
    previewInstall,
    install,
    uninstall
  };
}
