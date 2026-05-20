#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function walk(dir, files = []) {
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  if (!existsSync(absoluteDir)) return files;
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(mjs|js|md)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function importModule(rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

function assertFunction(moduleNamespace, rel, name) {
  assert.equal(typeof moduleNamespace[name], "function", `${rel} must export function ${name}`);
}

function assertConst(moduleNamespace, rel, name) {
  assert(Object.hasOwn(moduleNamespace, name), `${rel} must export ${name}`);
}

// CAP-4C: lock the moved connector runtime surface under
// capabilities/connectors.

const ownerDir = "src/service/capabilities/connectors";
const oldOwnerDir = "src/service/connectors";
const expectedFiles = [
  "account-connectors.mjs",
  "core/account-registry.mjs",
  "core/account-router.mjs",
  "core/capability-mapper.mjs",
  "core/catalog.mjs",
  "core/connector-intent.mjs",
  "core/contract-loader.mjs",
  "core/mcp-catalog-bridge.mjs",
  "core/plugin-registry.mjs",
  "core/reauth-manager.mjs",
  "core/token-manager.mjs",
  "core/types.mjs",
  "core/validators.mjs",
  "core/workflow-dispatcher.mjs",
  "core/workflow-submission.mjs",
  "google/google-connector.mjs",
  "google/contracts/calendar.tools.json",
  "google/contracts/drive.tools.json",
  "google/contracts/gmail.tools.json",
  "google/contracts/google.connector.json",
  "google/workflows/calendar.create-confirm.json",
  "google/workflows/gmail.draft-confirm-send.json",
  "microsoft/microsoft-connector.mjs",
  "microsoft/contracts/microsoft.connector.json",
  "microsoft/contracts/onedrive.tools.json",
  "microsoft/contracts/outlook-calendar.tools.json",
  "microsoft/contracts/outlook.tools.json",
  "microsoft/workflows/outlook-calendar.create-confirm.json",
  "microsoft/workflows/outlook.draft-confirm-send.json",
  "tools/action-tool-aggregator.mjs",
  "tools/catalog-tools.mjs",
  "tools/plugin-tools.mjs",
  "tools/read-tools.mjs",
  "tools/write-tools.mjs"
];

assert(existsSync(path.join(root, ownerDir)), `connector owner dir missing: ${ownerDir}`);
assert(!existsSync(path.join(root, oldOwnerDir)),
  `${oldOwnerDir} must not exist after CAP-4C physical move`);
for (const file of expectedFiles) {
  assert(existsSync(path.join(root, ownerDir, file)), `connector owner file missing: ${ownerDir}/${file}`);
}

const accountConnectors = await importModule(`${ownerDir}/account-connectors.mjs`);
for (const name of [
  "loadConnectorConfig",
  "saveConnectorConfig",
  "getValidAccessToken",
  "startMicrosoftAuth",
  "startGoogleAuth",
  "completeOAuthCallback",
  "disconnectAccount",
  "getConnectorStatus",
  "listFiles",
  "listEmails",
  "listCalendarEvents"
]) {
  assertFunction(accountConnectors, `${ownerDir}/account-connectors.mjs`, name);
}

const accountRegistry = await importModule(`${ownerDir}/core/account-registry.mjs`);
for (const name of [
  "listUserAccounts",
  "getAccountById",
  "findAccountByProviderAccountId",
  "upsertConnectedAccount",
  "deleteConnectedAccount",
  "markAccountTokenStatus",
  "updateAccountLastUsed",
  "setDefaultAccount",
  "saveOAuthTokenRecord",
  "getOAuthTokenRecord",
  "deleteOAuthTokenRecord",
  "upsertReauthRequest",
  "getReauthRequest",
  "listReauthRequests"
]) {
  assertFunction(accountRegistry, `${ownerDir}/core/account-registry.mjs`, name);
}

const capabilityMapper = await importModule(`${ownerDir}/core/capability-mapper.mjs`);
for (const name of ["googleScopesToCapabilities", "microsoftScopesToCapabilities", "scopesToCapabilities"]) {
  assertFunction(capabilityMapper, `${ownerDir}/core/capability-mapper.mjs`, name);
}

const accountRouter = await importModule(`${ownerDir}/core/account-router.mjs`);
for (const name of ["inferPreferredProvider", "capabilityToPurpose", "resolveAccount"]) {
  assertFunction(accountRouter, `${ownerDir}/core/account-router.mjs`, name);
}

const catalog = await importModule(`${ownerDir}/core/catalog.mjs`);
assertFunction(catalog, `${ownerDir}/core/catalog.mjs`, "createConnectorCatalog");

const intent = await importModule(`${ownerDir}/core/connector-intent.mjs`);
for (const name of [
  "detectConnectorCapabilityIntent",
  "inferCalendarTimeWindow",
  "isConnectorDomainRequest",
  "isConnectorAccountIdentityRequest",
  "inferConnectorProvider",
  "inferConnectorLimit",
  "matchWorkflowByTrigger",
  "extractWorkflowInput"
]) {
  assertFunction(intent, `${ownerDir}/core/connector-intent.mjs`, name);
}

const contractLoader = await importModule(`${ownerDir}/core/contract-loader.mjs`);
assertConst(contractLoader, `${ownerDir}/core/contract-loader.mjs`, "DEFAULT_CONNECTORS_ROOT");
assertFunction(contractLoader, `${ownerDir}/core/contract-loader.mjs`, "loadConnectorContractFiles");

const pluginRegistry = await importModule(`${ownerDir}/core/plugin-registry.mjs`);
assertFunction(pluginRegistry, `${ownerDir}/core/plugin-registry.mjs`, "createPluginRegistry");

const mcpCatalogBridge = await importModule(`${ownerDir}/core/mcp-catalog-bridge.mjs`);
for (const name of ["discoverExternalMcpCatalogEntries", "refreshExternalMcpCatalogEntries"]) {
  assertFunction(mcpCatalogBridge, `${ownerDir}/core/mcp-catalog-bridge.mjs`, name);
}

const tokenManager = await importModule(`${ownerDir}/core/token-manager.mjs`);
for (const name of ["refreshTokenIfNeeded", "getValidAccessToken", "migrateLegacyConnectorTokens"]) {
  assertFunction(tokenManager, `${ownerDir}/core/token-manager.mjs`, name);
}

const workflowDispatcher = await importModule(`${ownerDir}/core/workflow-dispatcher.mjs`);
assertFunction(workflowDispatcher, `${ownerDir}/core/workflow-dispatcher.mjs`, "runConnectorWorkflow");
const workflowSubmission = await importModule(`${ownerDir}/core/workflow-submission.mjs`);
for (const name of ["submitConnectorWorkflowTask", "resumeConnectorWorkflowTask"]) {
  assertFunction(workflowSubmission, `${ownerDir}/core/workflow-submission.mjs`, name);
}

const types = await importModule(`${ownerDir}/core/types.mjs`);
for (const name of [
  "CONNECTOR_PROVIDERS",
  "CONNECTOR_CAPABILITIES",
  "TOKEN_STATUSES",
  "EMPTY_CAPABILITY_MAP",
  "createCapabilityMap",
  "isConnectorProvider",
  "isConnectorCapability",
  "normalizeConnectedAccount"
]) {
  assertConst(types, `${ownerDir}/core/types.mjs`, name);
}

const google = await importModule(`${ownerDir}/google/google-connector.mjs`);
for (const name of [
  "listGoogleEmails",
  "getGoogleMessage",
  "listGoogleFiles",
  "listGoogleEvents",
  "sendGoogleEmail",
  "downloadGoogleFile",
  "uploadGoogleFile",
  "createGoogleEvent"
]) {
  assertFunction(google, `${ownerDir}/google/google-connector.mjs`, name);
}

const microsoft = await importModule(`${ownerDir}/microsoft/microsoft-connector.mjs`);
for (const name of [
  "listMicrosoftEmails",
  "getMicrosoftMessage",
  "listMicrosoftFiles",
  "listMicrosoftEvents",
  "sendMicrosoftEmail",
  "downloadMicrosoftFile",
  "uploadMicrosoftFile",
  "createMicrosoftEvent"
]) {
  assertFunction(microsoft, `${ownerDir}/microsoft/microsoft-connector.mjs`, name);
}

const readTools = await importModule(`${ownerDir}/tools/read-tools.mjs`);
for (const name of [
  "ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL",
  "ACCOUNT_LIST_EMAILS_TOOL",
  "ACCOUNT_LIST_FILES_TOOL",
  "ACCOUNT_DOWNLOAD_FILE_TOOL",
  "ACCOUNT_LIST_EVENTS_TOOL"
]) {
  assertConst(readTools, `${ownerDir}/tools/read-tools.mjs`, name);
}

const writeTools = await importModule(`${ownerDir}/tools/write-tools.mjs`);
for (const name of ["ACCOUNT_SEND_EMAIL_TOOL", "ACCOUNT_UPLOAD_FILE_TOOL", "ACCOUNT_CREATE_EVENT_TOOL"]) {
  assertConst(writeTools, `${ownerDir}/tools/write-tools.mjs`, name);
}

const catalogTools = await importModule(`${ownerDir}/tools/catalog-tools.mjs`);
for (const name of ["CONNECTOR_CATALOG_SEARCH_TOOL", "CONNECTOR_CATALOG_GET_TOOL", "CONNECTOR_WORKFLOW_RUN_TOOL"]) {
  assertConst(catalogTools, `${ownerDir}/tools/catalog-tools.mjs`, name);
}

const pluginTools = await importModule(`${ownerDir}/tools/plugin-tools.mjs`);
assertConst(pluginTools, `${ownerDir}/tools/plugin-tools.mjs`, "CONNECTOR_PLUGIN_MANAGE_TOOL");

const actionToolAggregator = await importModule(`${ownerDir}/tools/action-tool-aggregator.mjs`);
assert(Array.isArray(actionToolAggregator.CONNECTOR_ACTION_TOOLS),
  "action-tool-aggregator.mjs must export CONNECTOR_ACTION_TOOLS array");
assert(actionToolAggregator.CONNECTOR_ACTION_TOOLS.length >= 12,
  "CONNECTOR_ACTION_TOOLS must include catalog, plugin, read, and write tools");
for (const toolId of [
  "connector_catalog_search",
  "connector_catalog_get",
  "connector_workflow_run",
  "connector_plugin_manage",
  "account_list_connected_accounts",
  "account_send_email"
]) {
  assert(actionToolAggregator.CONNECTOR_ACTION_TOOLS.some((tool) => tool?.id === toolId),
    `CONNECTOR_ACTION_TOOLS missing ${toolId}`);
}

const mapped = capabilityMapper.googleScopesToCapabilities([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events"
]);
assert.equal(mapped.emailRead, true, "Google email read capability mapping changed");
assert.equal(mapped.emailWrite, true, "Google email write capability mapping changed");
assert.equal(mapped.fileWrite, true, "Google file write capability mapping changed");
assert.equal(mapped.calendarWrite, true, "Google calendar write capability mapping changed");

const account = types.normalizeConnectedAccount({
  provider: "google",
  providerAccountId: "g-1",
  email: "demo@example.com",
  capabilities: mapped
});
assert.equal(account.provider, "google", "normalizeConnectedAccount provider changed");
assert.equal(account.email, "demo@example.com", "normalizeConnectedAccount email changed");

for (const rel of [
  "src/service/capabilities/connectors/google/contracts/calendar.tools.json",
  "src/service/capabilities/connectors/microsoft/contracts/outlook-calendar.tools.json"
]) {
  const contract = JSON.parse(read(rel));
  const createTool = contract.tools.find((tool) => /calendar\.create_event$/.test(tool.id));
  assert(createTool, `${rel} must include a create_event tool`);
  assert(Object.hasOwn(createTool.inputSchema?.properties ?? {}, "recurrence"),
    `${rel} create_event input schema must expose recurrence`);
  assert((createTool.outputValidators ?? []).some((rule) =>
    rule.kind === "present_when_input_present"
    && rule.path === "event.recurrence"
    && rule.inputPath === "recurrence"
  ), `${rel} create_event must validate recurrence preservation when recurrence is requested`);
}

// Connector owners must stay service/runtime code. They must not reach into
// desktop, Electron, renderer, or preload modules.
for (const file of walk(ownerDir)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!rel.endsWith(".mjs")) continue;
  const source = read(rel);
  for (const needle of ["src/desktop/", "electron", "renderer/", "preload/"]) {
    assert(!source.includes(needle),
      `${rel} must not import forbidden connector owner dependency ${needle}`);
  }
}

// Desktop UI/view-model files must not import connector runtime internals.
for (const uiRoot of ["src/desktop/renderer", "src/desktop/console", "src/desktop/overlay"]) {
  for (const file of walk(uiRoot)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = read(rel);
    assert(!source.includes("src/service/connectors") && !source.includes("/service/connectors/"),
      `${rel} must not import connector runtime internals`);
    assert(!source.includes("src/service/capabilities/connectors") && !source.includes("/capabilities/connectors/"),
      `${rel} must not import connector capability internals`);
  }
}

const actionTools = read("src/service/action_tools/tools/index.mjs");
assert(actionTools.includes("../../capabilities/connectors/tools/action-tool-aggregator.mjs"),
  "action tool registry must delegate connector tools to action-tool-aggregator.mjs");
for (const tool of [
  "ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL",
  "ACCOUNT_LIST_EMAILS_TOOL",
  "ACCOUNT_SEND_EMAIL_TOOL",
  "CONNECTOR_WORKFLOW_RUN_TOOL"
]) {
  assert(!actionTools.includes(`export const ${tool} = {`),
    `action_tools/tools/index.mjs must not inline connector tool ${tool}`);
}

const connectorRoutes = read("src/service/core/http-routes/connector-routes.mjs");
for (const needle of [
  "../../capabilities/connectors/tools/read-tools.mjs",
  "../../capabilities/connectors/google/google-connector.mjs",
  "../../capabilities/connectors/microsoft/microsoft-connector.mjs",
  "../../capabilities/connectors/account-connectors.mjs",
  "../../capabilities/connectors/core/account-registry.mjs",
  "../../capabilities/connectors/core/workflow-submission.mjs",
  "../../capabilities/connectors/core/mcp-catalog-bridge.mjs",
  'url.pathname === "/connectors/catalog"',
  'url.pathname === "/connectors/connected-accounts"',
  'url.pathname === "/plugins"',
  'url.pathname === "/auth/callback"'
]) {
  assert(connectorRoutes.includes(needle), `connector-routes.mjs must retain connector contract ${needle}`);
}

const bootstrap = read("src/service/core/service-bootstrap.mjs");
for (const needle of [
  "../capabilities/connectors/core/catalog.mjs",
  "../capabilities/connectors/core/plugin-registry.mjs"
]) {
  assert(bootstrap.includes(needle), `service-bootstrap.mjs must retain connector owner wiring ${needle}`);
}

assert(read("src/service/capabilities/mcp/internal-server/connector-mcp-server.mjs")
  .includes("../../connectors/core/workflow-dispatcher.mjs"),
  "internal MCP server must delegate workflow execution to connector dispatcher");
assert(read(`${ownerDir}/core/mcp-catalog-bridge.mjs`).includes("../../mcp/client-bridge.mjs"),
  "MCP catalog bridge must delegate to MCP client bridge");
assert(read(`${ownerDir}/core/workflow-dispatcher.mjs`).includes("../../mcp/client-bridge.mjs"),
  "connector workflow dispatcher must execute external MCP via client bridge");

const boundaryDoc = "docs/architecture/connector-surface-boundary.md";
assert(existsSync(path.join(root, boundaryDoc)), "connector surface boundary doc missing");
const boundarySource = read(boundaryDoc);
assert(boundarySource.includes("Connector Surface Boundary"), "connector surface boundary doc title missing");
assert(boundarySource.includes("src/service/capabilities/connectors/"),
  "connector surface boundary doc must name target connector capability root");

if (!process.exitCode) {
  console.log("[connector-surface] connector surface contract verified");
}
