import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectorCatalog } from "../src/service/connectors/core/catalog.mjs";
import { createPluginRegistry } from "../src/service/connectors/core/plugin-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmp = path.join(repoRoot, ".tmp", "verify-plugin-registry");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const pluginsDir = path.join(tmp, "plugins");
mkdirSync(pluginsDir, { recursive: true });

// Build a fake plugin on disk.
const sourceDir = path.join(tmp, "source", "demo");
mkdirSync(path.join(sourceDir, "contracts"), { recursive: true });
mkdirSync(path.join(sourceDir, "workflows"), { recursive: true });
writeFileSync(
  path.join(sourceDir, "plugin.json"),
  JSON.stringify({
    schema_version: "1.0",
    id: "demo",
    displayName: "Demo Plugin",
    version: "0.1.0",
    provider: "demo",
    contracts: ["contracts/demo.connector.json", "contracts/demo.tools.json"],
    workflows: ["workflows/demo.ping.json"]
  }, null, 2)
);
writeFileSync(
  path.join(sourceDir, "contracts", "demo.connector.json"),
  JSON.stringify({
    schema_version: "1.0",
    kind: "connector",
    provider: "demo",
    displayName: "Demo",
    services: ["demo.app"]
  })
);
writeFileSync(
  path.join(sourceDir, "contracts", "demo.tools.json"),
  JSON.stringify({
    schema_version: "1.0",
    kind: "tools",
    provider: "demo",
    service: "demo.app",
    tools: [{
      id: "demo.app.ping",
      name: "Demo Ping",
      description: "Ping tool for verification",
      capability: "ping",
      risk: "low",
      source: "plugin",
      execution: { actionTool: "notify", provider: "demo" },
      inputSchema: { type: "object", properties: {}, required: [] }
    }]
  })
);
writeFileSync(
  path.join(sourceDir, "workflows", "demo.ping.json"),
  JSON.stringify({
    schema_version: "1.0",
    provider: "demo",
    service: "demo.app",
    workflows: [{
      id: "demo.app.ping_flow",
      name: "Demo Ping Flow",
      description: "Trigger the ping tool",
      intent: "demo.ping",
      risk: "low",
      triggerPatterns: ["demo ping"],
      steps: [{ id: "ping", tool: "demo.app.ping" }]
    }]
  })
);

const runtime = {
  mcpRegistry: null
};
runtime.connectorCatalog = createConnectorCatalog({
  pluginRootsProvider: () => runtime.pluginRegistry?.pluginRootsProvider?.() ?? []
});
runtime.pluginRegistry = createPluginRegistry({ runtime, pluginsDir });
runtime.connectorCatalog.reload();

// Initial list has no "demo" plugin, only the built-in providers.
let list = runtime.pluginRegistry.list();
assert.ok(list.some((plugin) => plugin.id === "google"));
assert.ok(list.some((plugin) => plugin.id === "microsoft"));
assert.ok(!list.some((plugin) => plugin.id === "demo"));

// Install.
const installed = await runtime.pluginRegistry.install({ sourcePath: sourceDir });
assert.equal(installed.id, "demo");
assert.equal(installed.enabled, true);
assert.ok(existsSync(path.join(pluginsDir, "demo", "plugin.json")));

list = runtime.pluginRegistry.list();
assert.ok(list.some((plugin) => plugin.id === "demo" && plugin.source === "installed"));

// Catalog now exposes the plugin's tools + workflows.
const toolAfterInstall = runtime.connectorCatalog.getTool("demo.app.ping");
assert.ok(toolAfterInstall, "plugin tool must appear in catalog after install");
const workflowAfterInstall = runtime.connectorCatalog.getWorkflow("demo.app.ping_flow");
assert.ok(workflowAfterInstall, "plugin workflow must appear in catalog after install");

// Disable.
runtime.pluginRegistry.setEnabled("demo", false);
assert.equal(runtime.connectorCatalog.getTool("demo.app.ping"), null, "disabled plugin tool must disappear");

// Re-enable, then uninstall.
runtime.pluginRegistry.setEnabled("demo", true);
assert.ok(runtime.connectorCatalog.getTool("demo.app.ping"), "re-enabled plugin tool must reappear");
const removed = await runtime.pluginRegistry.uninstall("demo");
assert.equal(removed.id, "demo");
assert.equal(runtime.connectorCatalog.getTool("demo.app.ping"), null, "uninstalled plugin tool must disappear");
assert.ok(!existsSync(path.join(pluginsDir, "demo")));

// Built-in plugins cannot be uninstalled.
await assert.rejects(async () => {
  await runtime.pluginRegistry.uninstall("google");
}, /built-in plugins cannot be uninstalled/);

// But can be disabled.
runtime.pluginRegistry.setEnabled("google", false);
runtime.pluginRegistry.setEnabled("google", true);

console.log("Plugin registry verification passed.");
