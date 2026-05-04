import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { DESKTOP_ACTOR_HEADER } from "../../src/service/core/http-route-guards.mjs";
import { tryHandleAiStatusRoute } from "../../src/service/core/http-routes/ai-status-routes.mjs";
import { createMcpEnvSecretRef } from "../../src/service/security/secret-store.mjs";

function requestWithJson(body, headers = {}) {
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
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body += chunk ?? "";
    },
    json() {
      return JSON.parse(this.body);
    }
  };
}

function createConfigRuntime(initialConfig = {}, { secretStore = null } = {}) {
  let savedConfig = null;
  return {
    secretStore,
    configStore: {
      load() {
        return savedConfig ?? initialConfig;
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

test("PATCH /ai/mcp/:id/config stores dynamic batch values as secret refs", async () => {
  const stored = new Map();
  const secretStore = {
    setSync(ref, value, metadata) {
      stored.set(ref, { value, metadata });
      return ref;
    }
  };
  const runtime = createConfigRuntime({}, { secretStore });
  const response = createJsonResponse();

  const handled = await tryHandleAiStatusRoute({
    request: requestWithJson({
      values: {
        TOKEN: "token-value",
        ACCOUNT: "account-value"
      },
      references: [
        { envKey: "TOKEN", type: "env", name: "SERVICE_TOKEN" },
        { envKey: "ACCOUNT", type: "secret_ref", name: "secret://lingxy/custom/account" }
      ]
    }),
    response,
    method: "PATCH",
    url: new URL("http://127.0.0.1/ai/mcp/custom%20server/config"),
    runtime
  });

  const generatedRef = createMcpEnvSecretRef("custom server", "TOKEN");
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    serverId: "custom server",
    keys: ["TOKEN", "ACCOUNT"]
  });
  assert.equal(runtime.savedConfig.ai.mcp.envOverrides["custom server"].TOKEN, `\${secret_ref:${generatedRef}}`);
  assert.equal(
    runtime.savedConfig.ai.mcp.envOverrides["custom server"].ACCOUNT,
    "${secret_ref:secret://lingxy/custom/account}"
  );
  assert.equal(stored.get(generatedRef).value, "token-value");
  assert.equal(stored.get("secret://lingxy/custom/account").value, "account-value");
  assert.equal(stored.get(generatedRef).metadata.kind, "mcp_env");
  assert.doesNotMatch(response.body, /token-value|account-value|secret:\/\/lingxy/);
});

test("PATCH /ai/mcp/:id/config preserves single-key literal fallback without secretStore", async () => {
  const runtime = createConfigRuntime({
    ai: {
      mcp: {
        envOverrides: {
          existing: { OLD: "keep" }
        }
      }
    }
  });
  const response = createJsonResponse();

  const handled = await tryHandleAiStatusRoute({
    request: requestWithJson({ key: "BRAVE_API_KEY", value: "plain-value" }),
    response,
    method: "PATCH",
    url: new URL("http://127.0.0.1/ai/mcp/mcp-brave-search/config"),
    runtime
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    serverId: "mcp-brave-search",
    keys: ["BRAVE_API_KEY"]
  });
  assert.equal(runtime.savedConfig.ai.mcp.envOverrides.existing.OLD, "keep");
  assert.equal(runtime.savedConfig.ai.mcp.envOverrides["mcp-brave-search"].BRAVE_API_KEY, "plain-value");
});

test("PATCH /ai/mcp/:id/config requires desktop actor", async () => {
  const runtime = createConfigRuntime({});
  const response = createJsonResponse();

  const handled = await tryHandleAiStatusRoute({
    request: requestWithJson({ key: "TOKEN", value: "x" }, { [DESKTOP_ACTOR_HEADER]: "" }),
    response,
    method: "PATCH",
    url: new URL("http://127.0.0.1/ai/mcp/custom-mcp/config"),
    runtime
  });

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error, "desktop_actor_required");
  assert.equal(runtime.savedConfig, null);
});
