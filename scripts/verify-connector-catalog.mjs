import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createConnectorCatalog } from "../src/service/capabilities/connectors/core/catalog.mjs";
import { refreshExternalMcpCatalogEntries } from "../src/service/capabilities/connectors/core/mcp-catalog-bridge.mjs";
import {
  CONNECTOR_CATALOG_GET_TOOL,
  CONNECTOR_CATALOG_SEARCH_TOOL
} from "../src/service/capabilities/connectors/tools/catalog-tools.mjs";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-connector-catalog", crypto.randomUUID());
const read = (p) => readFileSync(path.join(repoRoot, p), "utf8");

const catalog = createConnectorCatalog();

const providers = catalog.listProviders();
assert.ok(providers.some((provider) => provider.provider === "google"), "Google provider contract should be loaded");

const gmailTools = catalog.listTools({ provider: "google", service: "google.gmail" });
assert.ok(gmailTools.some((tool) => tool.id === "google.gmail.create_draft_preview"));
assert.ok(gmailTools.some((tool) => tool.id === "google.gmail.send_email" && tool.requiresConfirmation));

const calendarTools = catalog.listTools({ provider: "google", service: "google.calendar" });
assert.ok(calendarTools.some((tool) => tool.id === "google.calendar.create_event"));

const driveTools = catalog.listTools({ provider: "google", service: "google.drive" });
assert.ok(driveTools.some((tool) => tool.id === "google.drive.list_files"));

const workflows = catalog.listWorkflows({ provider: "google" });
assert.ok(workflows.some((workflow) => workflow.id === "google.gmail.draft_confirm_send"));
assert.ok(workflows.some((workflow) => workflow.id === "google.calendar.create_confirm"));

assert.equal(
  catalog.validateOutput("google.gmail.create_draft_preview", {
    draft_preview: "",
    subject: "",
    body: "",
    pending_confirmation: true
  }).ok,
  false,
  "empty draft preview output must fail validation"
);

assert.equal(
  catalog.validateOutput("google.gmail.create_draft_preview", {
    draft_preview: "To: user@example.com\nSubject: Hello\n\nBody",
    subject: "Hello",
    body: "Body",
    pending_confirmation: true
  }).ok,
  true,
  "non-empty draft preview output should pass validation"
);

const searchResult = await CONNECTOR_CATALOG_SEARCH_TOOL.execute({
  query: "draft",
  provider: "google"
}, { runtime: { connectorCatalog: catalog } });
assert.equal(searchResult.success, true);
assert.ok(searchResult.metadata.workflows.some((workflow) => workflow.id === "google.gmail.draft_confirm_send"));

const getResult = await CONNECTOR_CATALOG_GET_TOOL.execute({
  id: "google.gmail.send_email"
}, { runtime: { connectorCatalog: catalog } });
assert.equal(getResult.success, true);
assert.equal(getResult.metadata.entry.requiresConfirmation, true);

const service = createServiceBootstrap();
assert.ok(service.runtime.connectorCatalog.listTools({ provider: "google" }).length >= 6);
assert.ok(service.runtime.actionToolRegistry.get("connector_catalog_search"));
assert.ok(service.runtime.actionToolRegistry.get("connector_catalog_get"));

const bridgeCatalog = createConnectorCatalog();
bridgeCatalog.registerExternalTools([{
  id: "external.stale_tool",
  name: "stale_tool",
  description: "Stale external MCP tool",
  capability: "external_mcp",
  risk: "low",
  requiresConfirmation: false
}]);
assert.ok(bridgeCatalog.getTool("external.stale_tool"));
await refreshExternalMcpCatalogEntries({
  runtime: {
    connectorCatalog: bridgeCatalog,
    platform: {
      mcpServers: {
        list() {
          return [{
            id: "http-only-mcp",
            displayName: "HTTP Only MCP",
            transport: "http",
            enabled: true
          }];
        }
      }
    }
  }
});
assert.equal(
  bridgeCatalog.getTool("external.stale_tool"),
  null,
  "external MCP catalog refresh must use platform.mcpServers and clear stale entries"
);
assert.match(
  read("src/service/core/http-routes/connector-routes.mjs"),
  /refreshExternalMcpCatalogEntries\(\{\s*runtime\s*\}/,
  "connector catalog route must lazily refresh external MCP catalog entries"
);
assert.match(
  read("src/service/core/http-routes/ai-status-routes.mjs"),
  /refreshExternalMcpCatalogEntries\(\{\s*runtime,\s*refresh:\s*true\s*\}/,
  "MCP enable/config routes must refresh external MCP catalog entries"
);
assert.match(
  read("src/service/core/http-routes/config-provider-routes.mjs"),
  /refreshExternalMcpCatalogEntries\(\{\s*runtime,\s*refresh:\s*true\s*\}/,
  "MCP server save/delete routes must refresh external MCP catalog entries"
);
assert.match(
  read("src/service/core/persistent-runtime.mjs"),
  /disconnectMcpClients\(\)/,
  "persistent runtime shutdown must close cached MCP clients"
);

await rm(runtimeDir, { recursive: true, force: true });
const persistent = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: `\\\\.\\pipe\\uca-helper-connector-catalog-${crypto.randomUUID()}`
});

const listening = await persistent.start();
try {
  const payload = await fetch(`${listening.baseUrl}/connectors/catalog?provider=google&q=gmail`)
    .then((response) => response.json());
  assert.ok(payload.providers.some((provider) => provider.provider === "google"));
  assert.ok(payload.tools.some((tool) => tool.id === "google.gmail.send_email"));
  assert.ok(payload.mcp.tools.some((tool) => tool.name === "gmail_send_email"));

  const toolPayload = await fetch(`${listening.baseUrl}/connectors/catalog/tools/${encodeURIComponent("google.gmail.send_email")}`)
    .then((response) => response.json());
  assert.equal(toolPayload.tool.id, "google.gmail.send_email");
} finally {
  await persistent.stop();
}

console.log("Connector catalog verification passed.");
