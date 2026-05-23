import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_FILENAMES = ["mcp.json", "mcp-manifest.json"];

async function readJsonIfExists(filePath, field = "packageDir") {
  if (!existsSync(filePath)) {
    return { found: false, value: null, error: null };
  }
  try {
    return { found: true, value: JSON.parse(await readFile(filePath, "utf8")), error: null };
  } catch (error) {
    return {
      found: true,
      value: null,
      error: {
        field,
        message: `Invalid JSON in ${path.basename(filePath)}: ${error.message}`
      }
    };
  }
}

function firstArrayValue(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === "object") return value;
  return null;
}

function firstObjectValue(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return Object.values(value).find((entry) => entry && typeof entry === "object") ?? null;
}

function normalizeManifestDescriptor(raw, { id, displayName, manifestSource }) {
  const descriptor = firstArrayValue(raw?.servers)
    ?? firstObjectValue(raw?.mcpServers)
    ?? firstArrayValue(raw?.mcpServers)
    ?? raw?.server
    ?? raw;
  if (!descriptor || typeof descriptor !== "object") {
    return null;
  }
  const transport = descriptor.transport ?? (descriptor.url ? "http" : "stdio");
  return {
    id: descriptor.id ?? id,
    displayName: descriptor.displayName ?? descriptor.name ?? displayName ?? descriptor.id ?? id,
    transport,
    command: transport === "stdio" ? (descriptor.command ?? null) : null,
    args: transport === "stdio" && Array.isArray(descriptor.args) ? descriptor.args : [],
    url: transport !== "stdio" ? (descriptor.url ?? null) : null,
    env: descriptor.env && typeof descriptor.env === "object" && !Array.isArray(descriptor.env)
      ? descriptor.env
      : null,
    enabled: descriptor.enabled !== false,
    manifestSource,
    sourceOfArgs: "manifest"
  };
}

function normalizePackageBin(bin, packageDir) {
  if (!bin) return null;
  if (typeof bin === "string") {
    const resolved = path.resolve(packageDir, bin);
    return existsSync(resolved) ? resolved : null;
  }
  if (typeof bin === "object" && !Array.isArray(bin)) {
    const first = Object.values(bin).find((entry) => typeof entry === "string");
    if (!first) return null;
    const resolved = path.resolve(packageDir, first);
    return existsSync(resolved) ? resolved : null;
  }
  return null;
}

export async function detectMcpInstallCandidate({ packageDir, packageName = "", id = "" } = {}) {
  if (!packageDir) {
    return { ok: false, errors: [{ field: "packageDir", message: "Package directory is required for MCP manifest detection." }] };
  }

  const packageJsonPath = path.join(packageDir, "package.json");
  const packageJsonRead = await readJsonIfExists(packageJsonPath);
  if (packageJsonRead.error) {
    return { ok: false, errors: [packageJsonRead.error] };
  }
  if (!packageJsonRead.found) {
    return { ok: false, errors: [{ field: "packageDir", message: "package.json was not found in the package directory." }] };
  }
  const packageJson = packageJsonRead.value;

  const resolvedId = id || packageJson.name || packageName || path.basename(packageDir);
  const displayName = packageJson.displayName ?? packageJson.name ?? resolvedId;
  const packageManifest = packageJson.mcp ?? packageJson.mcpServer;
  if (packageManifest) {
    const detected = normalizeManifestDescriptor(packageManifest, {
      id: resolvedId,
      displayName,
      manifestSource: "package_json"
    });
    if (detected) {
      return { ok: true, detected, source: "package_json_mcp" };
    }
  }

  for (const fileName of MANIFEST_FILENAMES) {
    const manifestPath = path.join(packageDir, fileName);
    const manifestRead = await readJsonIfExists(manifestPath);
    if (manifestRead.error) {
      return { ok: false, errors: [manifestRead.error] };
    }
    const detected = normalizeManifestDescriptor(manifestRead.value, {
      id: resolvedId,
      displayName,
      manifestSource: fileName
    });
    if (detected) {
      return { ok: true, detected, source: "mcp_manifest" };
    }
  }

  const binPath = normalizePackageBin(packageJson.bin, packageDir);
  if (binPath) {
    return {
      ok: true,
      detected: {
        id: resolvedId,
        displayName,
        transport: "stdio",
        command: process.execPath,
        args: [binPath],
        url: null,
        env: null,
        enabled: true,
        manifestSource: "package_json_bin",
        sourceOfArgs: "bin"
      },
      source: "package_bin"
    };
  }

  return {
    ok: false,
    errors: [{
      field: "packageDir",
      message: "No MCP manifest or package.json bin entry was found. README text is not used as executable truth."
    }]
  };
}
