import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimePreflightClient } from "../../src/desktop/renderer/shared/runtime-preflight-client.mjs";

test("runtime preflight client owns MCP, skill, and DAG validation mutations", async () => {
  const calls = [];
  const client = createRuntimePreflightClient({
    actor: "desktop_console",
    httpClient: {
      async fetchJson(pathname, options) {
        calls.push({ pathname, options });
        return { ok: true };
      }
    }
  });

  await client.testMcpServerConfig({ id: "mcp" });
  await client.planMcpInstall({ source: "https://example.test/mcp.json" });
  await client.testSkillRegistryConfig({ rootPath: "skills" });
  await client.previewDag({ nodes: [] });

  assert.deepEqual(calls.map((call) => call.pathname), [
    "/config/mcp/test",
    "/config/mcp/install/plan",
    "/config/skills/test",
    "/dag/preview"
  ]);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["X-Lingxy-Desktop-Actor"], "desktop_console");
  assert.deepEqual(JSON.parse(calls[3].options.body), { graph: { nodes: [] } });
});
