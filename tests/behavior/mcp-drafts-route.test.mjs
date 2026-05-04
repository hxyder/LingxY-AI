import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { DESKTOP_ACTOR_HEADER } from "../../src/service/core/http-route-guards.mjs";
import { tryHandleConfigProviderRoute } from "../../src/service/core/http-routes/config-provider-routes.mjs";
import { listMcpDrafts } from "../../src/service/ai/mcp/drafts.mjs";

function requestWithJson(body = {}, headers = {}) {
  const request = Readable.from([`${JSON.stringify(body)}\n`]);
  request.headers = {
    [DESKTOP_ACTOR_HEADER]: "desktop_console",
    ...headers
  };
  return request;
}

function createJsonResponse() {
  return {
    statusCode: null,
    body: "",
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(chunk) {
      this.body += chunk ?? "";
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

async function createDraftRuntime() {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "linxi-mcp-drafts-"));
  const draftsDir = path.join(baseDir, "data", "mcp-drafts");
  await mkdir(draftsDir, { recursive: true });
  let savedConfig = null;
  return {
    paths: { baseDir, mcpDraftsDir: draftsDir },
    configStore: {
      load() {
        return savedConfig ?? {};
      },
      save(nextConfig) {
        savedConfig = nextConfig;
      }
    },
    platform: {
      mcpServers: {
        listStatus: async () => []
      }
    },
    get savedConfig() {
      return savedConfig;
    }
  };
}

async function writeDraft(runtime, overrides = {}) {
  const payload = {
    kind: "mcp",
    status: "draft",
    id: "draft-mcp",
    name: "Draft MCP",
    purpose: "Test draft import",
    saved_at: "2026-05-04T00:00:00.000Z",
    descriptor: {
      id: "draft-mcp",
      displayName: "Draft MCP",
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
      env: { TOKEN: "${secret_ref:secret://lingxy/mcp/draft/env/TOKEN}" },
      enabled: true
    },
    ...overrides
  };
  const file = "draft-mcp.json";
  const filePath = path.join(runtime.paths.mcpDraftsDir, file);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { file, filePath, payload };
}

test("listMcpDrafts summarizes draft files without leaking descriptor env", async () => {
  const runtime = await createDraftRuntime();
  await writeDraft(runtime);

  const drafts = await listMcpDrafts(runtime);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, "draft-mcp");
  assert.equal(drafts[0].descriptor.enabled, false);
  assert.equal(drafts[0].validation.ok, true);
  assert.equal(Object.hasOwn(drafts[0], "path"), false);
  assert.doesNotMatch(JSON.stringify(drafts), /secret:\/\/lingxy\/mcp\/draft/);
});

test("POST /config/mcp/drafts/import imports a draft as a disabled MCP server", async () => {
  const runtime = await createDraftRuntime();
  const { file } = await writeDraft(runtime);
  const response = createJsonResponse();

  const handled = await tryHandleConfigProviderRoute({
    request: requestWithJson({ file }),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/config/mcp/drafts/import"),
    runtime
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().server.enabled, false);
  assert.doesNotMatch(JSON.stringify(response.json()), /secret:\/\/lingxy\/mcp\/draft/);
  assert.equal(Object.hasOwn(response.json().server, "env"), false);
  assert.equal(Object.hasOwn(response.json().draft, "path"), false);
  assert.equal(runtime.savedConfig.ai.mcp.servers[0].id, "draft-mcp");
  assert.equal(runtime.savedConfig.ai.mcp.servers[0].enabled, false);
  assert.match(JSON.stringify(runtime.savedConfig), /secret:\/\/lingxy\/mcp\/draft/);
});

test("POST /config/mcp/drafts/import rejects path traversal", async () => {
  const runtime = await createDraftRuntime();
  const response = createJsonResponse();

  const handled = await tryHandleConfigProviderRoute({
    request: requestWithJson({ file: "../outside.json" }),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/config/mcp/drafts/import"),
    runtime
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "mcp_draft_path_not_allowed");
  assert.equal(runtime.savedConfig, null);
});
