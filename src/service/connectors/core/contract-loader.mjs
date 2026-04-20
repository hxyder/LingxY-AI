import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONNECTORS_ROOT = path.resolve(__dirname, "..");

function readJsonFile(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return {
    ...parsed,
    sourcePath: filePath
  };
}

function listJsonFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

function listProviderDirectories(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }
  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "core" && entry.name !== "tools")
    .map((entry) => ({
      provider: entry.name,
      directory: path.join(rootDir, entry.name)
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

function loadDirectoryAsProvider(providerDir) {
  const contractsDir = path.join(providerDir.directory, "contracts");
  const workflowsDir = path.join(providerDir.directory, "workflows");

  const contracts = listJsonFiles(contractsDir).map(readJsonFile);
  const workflows = listJsonFiles(workflowsDir).map(readJsonFile);

  if (contracts.length === 0 && workflows.length === 0) {
    return null;
  }

  return {
    provider: providerDir.provider,
    directory: providerDir.directory,
    contracts,
    workflows
  };
}

/**
 * Load every provider contract under `rootDir` (built-in providers) plus any
 * plugin directories passed in via `pluginRoots`. Each plugin root is a
 * single plugin directory:
 *   `<pluginsDir>/<pluginId>/contracts/*.json`
 *   `<pluginsDir>/<pluginId>/workflows/*.json`
 *
 * The provider name for a plugin is read from `plugin.json#provider` when
 * present; otherwise it falls back to the directory name. Used by the plugin
 * registry to merge installed plugins into the catalog at reload time.
 */
export function loadConnectorContractFiles({ rootDir = DEFAULT_CONNECTORS_ROOT, pluginRoots = [] } = {}) {
  const providers = [];

  for (const providerDir of listProviderDirectories(rootDir)) {
    const record = loadDirectoryAsProvider(providerDir);
    if (record) {
      providers.push(record);
    }
  }

  for (const pluginRoot of pluginRoots) {
    if (!pluginRoot?.directory || !existsSync(pluginRoot.directory)) continue;
    let providerName = pluginRoot.provider;
    const manifestPath = path.join(pluginRoot.directory, "plugin.json");
    if (!providerName && existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        providerName = manifest.provider ?? manifest.id;
      } catch { /* ignore */ }
    }
    if (!providerName) {
      providerName = path.basename(pluginRoot.directory);
    }
    const record = loadDirectoryAsProvider({ provider: providerName, directory: pluginRoot.directory });
    if (record) {
      record.source = "plugin";
      record.pluginId = pluginRoot.pluginId ?? providerName;
      providers.push(record);
    }
  }

  return {
    rootDir,
    providers
  };
}
