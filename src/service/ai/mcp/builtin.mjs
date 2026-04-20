import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const _require = createRequire(import.meta.url);

function resolvePackageBin(packageName, binFile) {
  try {
    const pkgJsonPath = _require.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(pkgJsonPath), binFile);
  } catch {
    return null;
  }
}

function makeStdioServer({ id, displayName, packageName, binFile, args = [], env = null, enabled = true, source = "builtin" }) {
  const binPath = resolvePackageBin(packageName, binFile);
  const available = Boolean(binPath && existsSync(binPath));

  return {
    id,
    displayName,
    transport: "stdio",
    command: "node",
    args: binPath ? [binPath, ...args] : args,
    env,
    enabled,
    source,
    async isAvailable() {
      return enabled && available;
    },
    async getStatus() {
      return {
        id,
        displayName,
        transport: "stdio",
        enabled,
        available: enabled && available,
        configured: available,
        command: "node",
        args: binPath ? [binPath, ...args] : args,
        env,
        source,
        detail: !available ? "package_not_found" : !enabled ? "disabled" : "ready"
      };
    },
    async listResources() {
      return [];
    }
  };
}

export const BUILTIN_MCP_SERVERS = Object.freeze([
  // ── Legacy descriptors kept only for migration/status clarity ─────────────
  {
    id: "local-fs",
    displayName: "Local Filesystem MCP (legacy)",
    transport: "stdio",
    enabled: false,
    source: "builtin",
    async isAvailable() { return false; },
    async getStatus() {
      return { id: "local-fs", displayName: "Local Filesystem MCP (legacy)", transport: "stdio", enabled: false, available: false, detail: "legacy_stub_use_mcp_filesystem" };
    },
    async listResources() { return []; }
  },
  {
    id: "figma",
    displayName: "Figma MCP (external plugin)",
    transport: "http",
    enabled: false,
    source: "builtin",
    async isAvailable() { return false; },
    async getStatus() {
      return { id: "figma", displayName: "Figma MCP (external plugin)", transport: "http", enabled: false, available: false, detail: "external_plugin_required" };
    },
    async listResources() { return []; }
  },

  // ── MIT-licensed MCP servers (UCA-067) ────────────────────────────────────

  // filesystem: read/write local files; enabled by default, roots = home dir + workspace.
  makeStdioServer({
    id: "mcp-filesystem",
    displayName: "Filesystem (MIT)",
    packageName: "@modelcontextprotocol/server-filesystem",
    binFile: "dist/index.js",
    args: Array.from(new Set([process.cwd(), os.homedir()].filter(Boolean))),
    enabled: true,
    source: "builtin_mit"
  }),

  // memory: cross-session key-value memory store; enabled by default
  makeStdioServer({
    id: "mcp-memory",
    displayName: "Memory Store (MIT)",
    packageName: "@modelcontextprotocol/server-memory",
    binFile: "dist/index.js",
    args: [],
    enabled: true,
    source: "builtin_mit"
  }),

  // brave-search: web search; disabled until user sets BRAVE_API_KEY
  makeStdioServer({
    id: "mcp-brave-search",
    displayName: "Brave Search (MIT)",
    packageName: "@modelcontextprotocol/server-brave-search",
    binFile: "dist/index.js",
    args: [],
    env: null, // user must set BRAVE_API_KEY in their env or Connectors UI
    enabled: false,
    source: "builtin_mit"
  }),

  // puppeteer: browser automation; disabled until user explicitly enables
  makeStdioServer({
    id: "mcp-puppeteer",
    displayName: "Puppeteer Browser (MIT)",
    packageName: "@modelcontextprotocol/server-puppeteer",
    binFile: "dist/index.js",
    args: [],
    enabled: false,
    source: "builtin_mit"
  }),

  // lingxy-google: internal MCP server re-exporting the Google connector
  // catalog to external MCP clients (Claude Desktop, Codex, MCP Inspector).
  // Disabled by default; enable it from Console → Connectors → MCP and use
  // the printed command as a stdio server config on the client side.
  {
    id: "lingxy-google",
    displayName: "LingxY Google (internal)",
    transport: "stdio",
    command: "node",
    args: ["scripts/start-lingxy-mcp-server.mjs", "--providers=google"],
    env: null,
    enabled: false,
    source: "lingxy_internal",
    async isAvailable() { return false; },
    async getStatus() {
      return {
        id: "lingxy-google",
        displayName: "LingxY Google (internal)",
        transport: "stdio",
        enabled: false,
        available: false,
        detail: "internal_mcp_server_descriptor",
        command: "node",
        args: ["scripts/start-lingxy-mcp-server.mjs", "--providers=google"]
      };
    },
    async listResources() { return []; }
  }
]);
