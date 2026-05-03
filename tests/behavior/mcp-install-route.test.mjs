import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { tryHandleMcpInstallRoute } from "../../src/service/core/http-routes/mcp-install-routes.mjs";

function jsonRequest(body, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body), "utf8")]);
  request.headers = headers;
  return request;
}

function captureResponse() {
  const response = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    }
  };
  return response;
}

async function postMcpInstallRun({ body, runtime, headers = { "x-lingxy-desktop-actor": "desktop_console" } }) {
  const response = captureResponse();
  const handled = await tryHandleMcpInstallRoute({
    request: jsonRequest(body, headers),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/config/mcp/install/run"),
    runtime
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: JSON.parse(response.body)
  };
}

test("MCP install run route executes through the runtime sandbox and does not accept body paths", async () => {
  const calls = [];
  let saved = false;
  const runtime = {
    paths: { mcpInstallDir: "E:/linxi/.tmp/mcp-packages" },
    configStore: {
      save() {
        saved = true;
      }
    },
    async mcpInstallExecutor(options) {
      calls.push(options);
      return {
        ok: true,
        source: options.source,
        installRoot: `${options.paths.mcpInstallDir}/demo-mcp`,
        packageDir: `${options.paths.mcpInstallDir}/demo-mcp/node_modules/demo-mcp`,
        server: {
          id: "demo-mcp",
          displayName: "Demo MCP",
          transport: "stdio",
          command: process.execPath,
          args: ["server.js"],
          url: null,
          env: null,
          enabled: true
        }
      };
    }
  };

  const result = await postMcpInstallRun({
    runtime,
    body: {
      source: "demo-mcp",
      id: "demo-mcp",
      allowScripts: true,
      timeoutMs: 321,
      paths: { mcpInstallDir: "C:/malicious" }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.server.id, "demo-mcp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, "demo-mcp");
  assert.equal(calls[0].id, "demo-mcp");
  assert.equal(calls[0].allowScripts, true);
  assert.equal(calls[0].timeoutMs, 321);
  assert.deepEqual(calls[0].paths, { mcpInstallDir: "E:/linxi/.tmp/mcp-packages" });
  assert.equal(saved, false, "MCP install run must not persist config; user review/save remains a separate step.");
});

test("MCP install run route requires a trusted desktop actor before reading the body", async () => {
  let called = false;
  const result = await postMcpInstallRun({
    runtime: {
      paths: { mcpInstallDir: "E:/linxi/.tmp/mcp-packages" },
      async mcpInstallExecutor() {
        called = true;
        return { ok: true };
      }
    },
    headers: {},
    body: {
      source: "demo-mcp"
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.equal(called, false);
});

test("MCP install run route returns structured failures without throwing", async () => {
  const result = await postMcpInstallRun({
    runtime: {
      paths: { mcpInstallDir: "E:/linxi/.tmp/mcp-packages" },
      async mcpInstallExecutor() {
        return {
          ok: false,
          error: "mcp_install_failed",
          stderrTail: "npm failed"
        };
      }
    },
    body: {
      source: "demo-mcp"
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "mcp_install_failed");
  assert.match(result.payload.stderrTail, /npm failed/);
});
