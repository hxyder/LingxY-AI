import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  clearMcpDiscoveryCacheForTests,
  normalizeMcpRegistrySearchPayload,
  searchMcpDiscovery
} from "../../src/service/capabilities/mcp/discovery-catalog.mjs";
import { tryHandleMcpInstallRoute } from "../../src/service/core/http-routes/mcp-install-routes.mjs";

function captureResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

async function getMcpRegistrySearch({ query = "filesystem", runtime = {} } = {}) {
  const response = captureResponse();
  const handled = await tryHandleMcpInstallRoute({
    request: Readable.from([]),
    response,
    method: "GET",
    url: new URL(`http://127.0.0.1/config/mcp/registry/search?q=${encodeURIComponent(query)}&limit=10`),
    runtime
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: response.json()
  };
}

const registryPayload = {
  servers: [{
    server: {
      name: "com.example/remote-filesystem",
      title: "Remote Filesystem",
      description: "Cloud filesystem operations.",
      version: "0.1.2",
      repository: { url: "https://github.com/example/remote-filesystem" },
      packages: [{
        registryType: "npm",
        identifier: "remote-filesystem-mcp-server",
        runtimeHint: "npx",
        transport: { type: "stdio" },
        runtimeArguments: [{ value: "-y", type: "positional" }],
        environmentVariables: [
          { name: "GCS_BUCKET", description: "Bucket", isRequired: true },
          { name: "GCS_PRIVATE_KEY", description: "Private key", isSecret: true }
        ]
      }]
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: "active",
        isLatest: true
      }
    }
  }],
  metadata: { count: 1 }
};

test("MCP discovery normalizes official registry package results into disabled drafts", () => {
  const normalized = normalizeMcpRegistrySearchPayload(registryPayload, { limit: 5 });
  const entry = normalized.results[0];

  assert.equal(normalized.ok, true);
  assert.equal(entry.source, "official_registry");
  assert.equal(entry.packageSource, "remote-filesystem-mcp-server");
  assert.equal(entry.installable, true);
  assert.equal(entry.serverDraft.enabled, false);
  assert.equal(entry.serverDraft.transport, "stdio");
  assert.deepEqual(entry.serverDraft.args, ["-y", "remote-filesystem-mcp-server"]);
  assert.deepEqual(entry.serverDraft.env, { GCS_BUCKET: "${env:GCS_BUCKET}" });
  assert.equal(entry.requiredEnv.length, 1);
  assert.equal(entry.envRequirements.find((item) => item.envKey === "GCS_PRIVATE_KEY")?.secret, true);
});

test("GET /config/mcp/registry/search returns registry results through the MCP route group", async () => {
  clearMcpDiscoveryCacheForTests();
  const requested = [];
  const runtime = {
    async mcpRegistrySearchFetch(url, init = {}) {
      requested.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return registryPayload;
        }
      };
    }
  };

  const result = await getMcpRegistrySearch({ query: "filesystem", runtime });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.source, "official_registry");
  assert.equal(result.payload.results[0].packageSource, "remote-filesystem-mcp-server");
  assert.match(requested[0].url, /\/v0\.1\/servers\?/);
  assert.match(requested[0].url, /search=filesystem/);
  assert.equal(requested[0].init.headers.Accept, "application/json");
});

test("MCP discovery falls back to the curated catalog when registry fetch fails", async () => {
  clearMcpDiscoveryCacheForTests();
  const result = await searchMcpDiscovery({
    query: "brave",
    limit: 5,
    async fetchImpl() {
      throw new Error("network unavailable");
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "curated");
  assert.equal(result.warning, "mcp_registry_unavailable");
  assert.equal(result.results[0].id, "mcp-brave-search");
  assert.deepEqual(result.results[0].serverDraft.env, { BRAVE_API_KEY: "${env:BRAVE_API_KEY}" });
});
