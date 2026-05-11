import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectorCatalog } from "../src/service/connectors/core/catalog.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createConnectorMcpServer } from "../src/service/ai/mcp/internal-server/connector-mcp-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runtime = {
  connectorCatalog: createConnectorCatalog(),
  actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
  pendingApprovals: {
    create() {
      return { approval_id: "ap_stub" };
    }
  }
};

const { currentTools, currentResources } = await createConnectorMcpServer({
  runtime,
  providers: ["google"]
});

const tools = currentTools();
assert.ok(tools.length > 0, "internal MCP server must expose at least one tool");
assert.ok(
  tools.some((tool) => tool.name === "workflow_google_gmail_draft_confirm_send"),
  "Google draft-confirm-send workflow must be exposed as an MCP tool"
);
assert.ok(
  tools.some((tool) => tool.name === "gmail_create_draft_preview"),
  "gmail_create_draft_preview direct tool must be exposed"
);

// Microsoft provider must be filtered out because we passed providers=["google"].
assert.ok(
  !tools.some((tool) => tool.annotations?.provider === "microsoft"),
  "microsoft tools must not appear when providers=['google']"
);

const resources = currentResources();
assert.ok(resources.length > 0, "internal MCP server must expose at least one resource");
assert.ok(
  resources.every((resource) => resource.uri.startsWith("connector://google")),
  "all exposed resources must belong to the google provider"
);

// With providers=[] we see everything.
const { currentTools: allTools } = await createConnectorMcpServer({
  runtime,
  providers: []
});
const all = allTools();
assert.ok(all.some((tool) => tool.annotations?.provider === "google"));
assert.ok(all.some((tool) => tool.annotations?.provider === "microsoft"));

// Sanity: annotations carry provider/service/risk so external clients can
// surface risk and confirmation requirements.
const mcpGmailSend = all.find((tool) => tool.name === "gmail_send_email");
assert.ok(mcpGmailSend, "gmail_send_email must be in the merged list");
assert.equal(mcpGmailSend.annotations.risk, "high");
assert.equal(mcpGmailSend.annotations.requiresConfirmation, true);

console.log("Internal MCP server verification passed.");
