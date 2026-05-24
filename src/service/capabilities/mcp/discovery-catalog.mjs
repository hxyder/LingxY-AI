const DEFAULT_REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 3500;
const CACHE_TTL_MS = 5 * 60 * 1000;

const discoveryCache = new Map();

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_LIMIT);
}

function normalizeId(value, fallback = "mcp-server") {
  const raw = asString(value) || fallback;
  const normalized = raw
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function titleFromName(name) {
  const raw = asString(name);
  if (!raw) return "MCP Server";
  const last = raw.split(/[/:]/).filter(Boolean).at(-1) ?? raw;
  return last
    .replace(/^mcp[-_]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function normalizeTransportType(value) {
  const transport = asString(value).toLowerCase();
  if (transport === "http" || transport === "sse" || transport === "streamable-http") return "http";
  if (transport === "ws" || transport === "websocket") return "ws";
  return "stdio";
}

function argumentValues(args) {
  if (!Array.isArray(args)) return [];
  return args
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return asString(entry?.value);
    })
    .filter(Boolean);
}

function normalizeEnvRequirement(entry) {
  const name = asString(entry?.name ?? entry?.envKey);
  if (!name) return null;
  return {
    envKey: name,
    name,
    required: entry?.isRequired === true || entry?.required === true,
    secret: entry?.isSecret === true || entry?.secret === true,
    description: asString(entry?.description),
    defaultValue: entry?.default == null ? null : `${entry.default}`
  };
}

function uniqueEnvRequirements(entries = []) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const normalized = normalizeEnvRequirement(entry);
    if (!normalized || seen.has(normalized.envKey)) continue;
    seen.add(normalized.envKey);
    out.push(normalized);
  }
  return out;
}

function buildRequiredEnvPlaceholders(requirements = []) {
  const env = {};
  for (const entry of requirements) {
    if (!entry?.required || !entry.envKey) continue;
    env[entry.envKey] = `\${env:${entry.name || entry.envKey}}`;
  }
  return Object.keys(env).length ? env : null;
}

function firstNpmPackage(packages = []) {
  return (Array.isArray(packages) ? packages : [])
    .find((entry) => asString(entry?.registryType).toLowerCase() === "npm" && asString(entry?.identifier))
    ?? null;
}

function firstRemote(remotes = []) {
  return (Array.isArray(remotes) ? remotes : [])
    .find((entry) => asString(entry?.url))
    ?? null;
}

function repositoryUrl(repository) {
  if (typeof repository === "string") return repository;
  return asString(repository?.url);
}

function buildPackageDraft({ id, title, pkg, envRequirements }) {
  if (!pkg) return null;
  const transport = normalizeTransportType(pkg.transport?.type ?? pkg.transport);
  const packageSource = asString(pkg.identifier);
  const runtimeHint = asString(pkg.runtimeHint).toLowerCase();
  const runtimeArgs = argumentValues(pkg.runtimeArguments);
  const packageArgs = argumentValues(pkg.packageArguments);
  const env = buildRequiredEnvPlaceholders(envRequirements);

  if (transport !== "stdio") {
    return null;
  }

  const command = runtimeHint && runtimeHint !== "npx" ? runtimeHint : "npx";
  const args = command === "npx"
    ? [
        ...(runtimeArgs.length ? runtimeArgs : ["-y"]),
        packageSource,
        ...packageArgs
      ]
    : [...runtimeArgs, packageSource, ...packageArgs];

  return {
    id,
    displayName: title,
    transport: "stdio",
    command,
    args,
    url: null,
    env,
    enabled: false
  };
}

function buildRemoteDraft({ id, title, remote, envRequirements }) {
  if (!remote) return null;
  const url = asString(remote.url);
  if (!url) return null;
  return {
    id,
    displayName: title,
    transport: normalizeTransportType(remote.type ?? remote.transport),
    command: null,
    args: [],
    url,
    env: buildRequiredEnvPlaceholders(envRequirements),
    enabled: false
  };
}

function normalizeRegistryServerEntry(entry) {
  const server = entry?.server ?? entry;
  if (!server || typeof server !== "object") return null;
  const registryName = asString(server.name);
  const title = asString(server.title) || titleFromName(registryName);
  const id = normalizeId(registryName || title);
  const npmPackage = firstNpmPackage(server.packages);
  const remote = firstRemote(server.remotes);
  const packageEnv = uniqueEnvRequirements(npmPackage?.environmentVariables ?? []);
  const remoteEnv = uniqueEnvRequirements(remote?.environmentVariables ?? []);
  const envRequirements = packageEnv.length ? packageEnv : remoteEnv;
  const serverDraft = buildPackageDraft({ id, title, pkg: npmPackage, envRequirements })
    ?? buildRemoteDraft({ id, title, remote, envRequirements });
  const official = entry?._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
  const packageSource = asString(npmPackage?.identifier);
  const remoteUrl = asString(remote?.url);

  return {
    id,
    title,
    description: asString(server.description),
    registryName,
    version: asString(server.version),
    source: "official_registry",
    sourceLabel: "Official MCP Registry",
    status: asString(official.status) || "listed",
    isLatest: official.isLatest !== false,
    packageSource: packageSource || null,
    remoteUrl: remoteUrl || null,
    transport: serverDraft?.transport ?? normalizeTransportType(npmPackage?.transport?.type ?? remote?.type),
    runtimeHint: asString(npmPackage?.runtimeHint),
    repositoryUrl: repositoryUrl(server.repository) || null,
    envRequirements,
    requiredEnv: envRequirements.filter((item) => item.required),
    installable: Boolean(packageSource || remoteUrl),
    serverDraft
  };
}

export function normalizeMcpRegistrySearchPayload(payload = {}, { limit = DEFAULT_LIMIT } = {}) {
  const capped = normalizeLimit(limit);
  const rawServers = Array.isArray(payload?.servers)
    ? payload.servers
    : Array.isArray(payload)
      ? payload
      : [];
  const results = rawServers
    .map(normalizeRegistryServerEntry)
    .filter(Boolean)
    .slice(0, capped);
  return {
    ok: true,
    source: "official_registry",
    results,
    metadata: {
      count: Number(payload?.metadata?.count ?? results.length),
      nextCursor: asString(payload?.metadata?.nextCursor) || null
    }
  };
}

function curatedEntry(entry) {
  const id = normalizeId(entry.id);
  const envRequirements = uniqueEnvRequirements(entry.envRequirements ?? []);
  const requiredEnv = envRequirements.filter((item) => item.required);
  return {
    id,
    title: entry.title,
    description: entry.description,
    registryName: entry.registryName ?? id,
    version: "",
    source: "curated",
    sourceLabel: "LingxY curated",
    status: "curated",
    isLatest: true,
    packageSource: entry.packageSource ?? null,
    remoteUrl: entry.remoteUrl ?? null,
    transport: entry.transport ?? "stdio",
    runtimeHint: entry.runtimeHint ?? "npx",
    repositoryUrl: entry.repositoryUrl ?? null,
    envRequirements,
    requiredEnv,
    installable: Boolean(entry.packageSource ?? entry.remoteUrl),
    serverDraft: {
      id,
      displayName: entry.title,
      transport: entry.transport ?? "stdio",
      command: entry.transport === "http" ? null : "npx",
      args: entry.transport === "http" ? [] : ["-y", entry.packageSource],
      url: entry.transport === "http" ? entry.remoteUrl : null,
      env: buildRequiredEnvPlaceholders(envRequirements),
      enabled: false
    }
  };
}

export const CURATED_MCP_DISCOVERY = Object.freeze([
  curatedEntry({
    id: "mcp-filesystem",
    title: "Filesystem",
    description: "Read and write files in allowed local directories.",
    packageSource: "@modelcontextprotocol/server-filesystem",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  }),
  curatedEntry({
    id: "mcp-memory",
    title: "Memory Store",
    description: "Persistent graph memory for agentic tasks.",
    packageSource: "@modelcontextprotocol/server-memory",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  }),
  curatedEntry({
    id: "mcp-brave-search",
    title: "Brave Search",
    description: "Web search through the Brave Search API.",
    packageSource: "@modelcontextprotocol/server-brave-search",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    envRequirements: [{ name: "BRAVE_API_KEY", isRequired: true, isSecret: true }]
  }),
  curatedEntry({
    id: "mcp-puppeteer",
    title: "Puppeteer Browser",
    description: "Browser automation through Puppeteer.",
    packageSource: "@modelcontextprotocol/server-puppeteer",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  }),
  curatedEntry({
    id: "mcp-sequential-thinking",
    title: "Sequential Thinking",
    description: "Structured step-by-step reasoning as an MCP tool.",
    packageSource: "@modelcontextprotocol/server-sequential-thinking",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers"
  })
]);

function entryMatchesQuery(entry, query) {
  const q = asString(query).toLowerCase();
  if (!q) return true;
  const haystack = [
    entry.id,
    entry.title,
    entry.description,
    entry.packageSource,
    entry.remoteUrl,
    entry.registryName
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

export function searchLocalMcpDiscovery({ query = "", limit = DEFAULT_LIMIT } = {}) {
  const capped = normalizeLimit(limit);
  const results = CURATED_MCP_DISCOVERY
    .filter((entry) => entryMatchesQuery(entry, query))
    .slice(0, capped);
  return {
    ok: true,
    source: "curated",
    results,
    metadata: {
      count: results.length,
      nextCursor: null
    }
  };
}

function dedupeResults(entries = [], limit = DEFAULT_LIMIT) {
  const capped = normalizeLimit(limit);
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const key = entry.packageSource || entry.remoteUrl || entry.registryName || entry.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= capped) break;
  }
  return out;
}

async function fetchRegistryPayload({
  query,
  limit,
  fetchImpl,
  registryBaseUrl,
  timeoutMs
}) {
  const endpoint = new URL("/v0.1/servers", registryBaseUrl || DEFAULT_REGISTRY_BASE_URL);
  const q = asString(query);
  if (q) endpoint.searchParams.set("search", q);
  endpoint.searchParams.set("limit", String(normalizeLimit(limit)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint.href, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response?.ok) {
      throw new Error(`mcp_registry_http_${response?.status ?? "error"}`);
    }
    if (typeof response.json === "function") {
      return await response.json();
    }
    const text = typeof response.text === "function" ? await response.text() : "";
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function cacheKey({ query, limit, registryBaseUrl }) {
  return JSON.stringify({
    query: asString(query).toLowerCase(),
    limit: normalizeLimit(limit),
    registryBaseUrl: registryBaseUrl || DEFAULT_REGISTRY_BASE_URL
  });
}

export function clearMcpDiscoveryCacheForTests() {
  discoveryCache.clear();
}

export async function searchMcpDiscovery({
  query = "",
  limit = DEFAULT_LIMIT,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  registryBaseUrl = DEFAULT_REGISTRY_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now
} = {}) {
  const capped = normalizeLimit(limit);
  const local = searchLocalMcpDiscovery({ query, limit: capped });
  if (typeof fetchImpl !== "function") {
    return {
      ok: true,
      query: asString(query),
      source: "curated",
      warning: "mcp_registry_fetch_unavailable",
      results: local.results,
      metadata: local.metadata
    };
  }

  const key = cacheKey({ query, limit: capped, registryBaseUrl });
  const stamp = now();
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > stamp) {
    return cached.value;
  }

  let value;
  try {
    const payload = await fetchRegistryPayload({
      query,
      limit: capped,
      fetchImpl,
      registryBaseUrl,
      timeoutMs
    });
    const remote = normalizeMcpRegistrySearchPayload(payload, { limit: capped });
    const results = dedupeResults([...remote.results, ...local.results], capped);
    value = {
      ok: true,
      query: asString(query),
      source: "official_registry",
      results,
      metadata: {
        ...remote.metadata,
        count: results.length
      }
    };
  } catch (error) {
    value = {
      ok: true,
      query: asString(query),
      source: "curated",
      warning: "mcp_registry_unavailable",
      message: error?.message ?? String(error),
      results: local.results,
      metadata: local.metadata
    };
  }

  discoveryCache.set(key, {
    expiresAt: stamp + CACHE_TTL_MS,
    value
  });
  return value;
}
