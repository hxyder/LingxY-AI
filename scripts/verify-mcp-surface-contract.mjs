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

// CAP-4B: lock the moved MCP runtime surface under capabilities/mcp.

const ownerDir = "src/service/capabilities/mcp";
const oldOwnerDir = "src/service/ai/mcp";
const expectedFiles = [
  "auto-install.mjs",
  "builtin.mjs",
  "client-bridge.mjs",
  "configured.mjs",
  "descriptor-validation.mjs",
  "drafts.mjs",
  "env-resolver.mjs",
  "install-detection.mjs",
  "install-execution.mjs",
  "install-sandbox.mjs",
  "registry.mjs",
  "README.md",
  "internal-server/connector-mcp-server.mjs"
];

assert(existsSync(path.join(root, ownerDir)), `MCP owner dir missing: ${ownerDir}`);
assert(!existsSync(path.join(root, oldOwnerDir)),
  `${oldOwnerDir} must not exist after CAP-4B physical move`);
for (const file of expectedFiles) {
  assert(existsSync(path.join(root, ownerDir, file)), `MCP owner file missing: ${ownerDir}/${file}`);
}

const registry = await importModule(`${ownerDir}/registry.mjs`);
assertFunction(registry, `${ownerDir}/registry.mjs`, "createMCPRegistry");

const configured = await importModule(`${ownerDir}/configured.mjs`);
for (const name of ["clearMcpCommandExistsCacheForTests", "commandExists", "createConfiguredMCPServer"]) {
  assertFunction(configured, `${ownerDir}/configured.mjs`, name);
}

const envResolver = await importModule(`${ownerDir}/env-resolver.mjs`);
assertFunction(envResolver, `${ownerDir}/env-resolver.mjs`, "resolveMcpEnv");
assertFunction(envResolver, `${ownerDir}/env-resolver.mjs`, "describeMcpEnvRequirements");

const descriptorValidation = await importModule(`${ownerDir}/descriptor-validation.mjs`);
assertFunction(descriptorValidation, `${ownerDir}/descriptor-validation.mjs`, "validateMcpServerDescriptor");

const drafts = await importModule(`${ownerDir}/drafts.mjs`);
for (const name of ["resolveMcpDraftsDir", "listMcpDrafts", "readMcpDraft"]) {
  assertFunction(drafts, `${ownerDir}/drafts.mjs`, name);
}

const installDetection = await importModule(`${ownerDir}/install-detection.mjs`);
assertFunction(installDetection, `${ownerDir}/install-detection.mjs`, "detectMcpInstallCandidate");

const installExecution = await importModule(`${ownerDir}/install-execution.mjs`);
assertFunction(installExecution, `${ownerDir}/install-execution.mjs`, "executeMcpInstall");

const installSandbox = await importModule(`${ownerDir}/install-sandbox.mjs`);
assertFunction(installSandbox, `${ownerDir}/install-sandbox.mjs`, "classifyMcpInstallSource");
assertFunction(installSandbox, `${ownerDir}/install-sandbox.mjs`, "createMcpInstallSandboxPlan");

const autoInstall = await importModule(`${ownerDir}/auto-install.mjs`);
assertFunction(autoInstall, `${ownerDir}/auto-install.mjs`, "runMcpAutoInstall");

const clientBridge = await importModule(`${ownerDir}/client-bridge.mjs`);
for (const name of ["getMcpSkipReason", "connectMcpServer", "disconnectAll", "getMcpClient", "getMcpActionTools"]) {
  assertFunction(clientBridge, `${ownerDir}/client-bridge.mjs`, name);
}

const builtin = await importModule(`${ownerDir}/builtin.mjs`);
assert(Array.isArray(builtin.BUILTIN_MCP_SERVERS), "builtin.mjs must export BUILTIN_MCP_SERVERS array");

const internalServer = await importModule(`${ownerDir}/internal-server/connector-mcp-server.mjs`);
assertFunction(internalServer, `${ownerDir}/internal-server/connector-mcp-server.mjs`, "createConnectorMcpServer");

const mcpRegistry = registry.createMCPRegistry([
  {
    id: "demo",
    displayName: "Demo MCP",
    transport: "stdio",
    async listResources() {
      return [{ uri: "demo://one" }];
    }
  }
]);
assert.equal(mcpRegistry.get("demo")?.displayName, "Demo MCP", "MCP registry get changed");
assert.equal((await mcpRegistry.listStatus())[0].available, true, "MCP registry status changed");
assert.equal((await mcpRegistry.listResources())[0].server, "demo", "MCP resource server stamping changed");

const validDescriptor = descriptorValidation.validateMcpServerDescriptor({
  id: "demo-mcp",
  transport: "stdio",
  command: "node",
  args: ["server.mjs"],
  env: { TOKEN: "${env:TOKEN}" }
});
assert.equal(validDescriptor.ok, true, "valid stdio MCP descriptor should pass");
const invalidDescriptor = descriptorValidation.validateMcpServerDescriptor({
  id: "bad",
  transport: "stdio"
});
assert.equal(invalidDescriptor.ok, false, "stdio MCP descriptor without command should fail");

const resolvedEnv = envResolver.resolveMcpEnv(
  { TOKEN: "${env:TOKEN}", SECRET: "${secret_ref:secret://lingxy/mcp/demo/env/SECRET}" },
  {
    processEnv: { TOKEN: "env-token" },
    secretStore: { getSync: (ref) => ref.endsWith("/SECRET") ? "secret-token" : null }
  }
);
assert.equal(resolvedEnv.ok, true, "MCP env refs should resolve from env and secret store");
assert.equal(resolvedEnv.env.TOKEN, "env-token", "MCP env token resolution changed");
assert.equal(resolvedEnv.env.SECRET, "secret-token", "MCP secret ref resolution changed");
assert.equal(envResolver.describeMcpEnvRequirements({ TOKEN: "${env:TOKEN}" }).hasReferences, true,
  "MCP env requirement description changed");

assert.equal(installSandbox.classifyMcpInstallSource("@scope/demo-mcp").ok, true,
  "MCP npm install source classification changed");
assert.equal(installSandbox.classifyMcpInstallSource("https://github.com/example/demo-mcp").ok, true,
  "MCP GitHub install source classification changed");

// MCP owners must stay service/runtime code. They must not reach into desktop,
// Electron, or renderer modules. Internal-server may depend on connector
// dispatcher because it is a connector-catalog adapter.
for (const file of walk(ownerDir)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!rel.endsWith(".mjs")) continue;
  const source = read(rel);
  for (const needle of ["src/desktop/", "electron", "src/desktop", "renderer/"]) {
    assert(!source.includes(needle), `${rel} must not import forbidden MCP owner dependency ${needle}`);
  }
}

// Desktop UI/view-model files must not import MCP runtime internals.
for (const uiRoot of ["src/desktop/renderer", "src/desktop/console", "src/desktop/overlay"]) {
  for (const file of walk(uiRoot)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = read(rel);
    assert(!source.includes("src/service/capabilities/mcp") && !source.includes("/capabilities/mcp/"),
      `${rel} must not import MCP runtime internals`);
  }
}

const runtimeIntegrations = read("src/service/ai/integrations/runtime.mjs");
for (const needle of [
  "../../capabilities/mcp/registry.mjs",
  "../../capabilities/mcp/builtin.mjs",
  "../../capabilities/mcp/configured.mjs",
  "../../capabilities/mcp/env-resolver.mjs"
]) {
  assert(runtimeIntegrations.includes(needle), `AI integration runtime must use ${needle}`);
}

const configRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
for (const needle of [
  "../../capabilities/mcp/descriptor-validation.mjs",
  "../../capabilities/mcp/configured.mjs",
  "../../capabilities/mcp/drafts.mjs",
  'url.pathname === "/config/mcp/servers"',
  'url.pathname === "/config/mcp/test"',
  'url.pathname === "/config/mcp/drafts"'
]) {
  assert(configRoutes.includes(needle), `config-provider-routes.mjs must retain MCP contract ${needle}`);
}

const installRoutes = read("src/service/core/http-routes/mcp-install-routes.mjs");
for (const needle of [
  "../../capabilities/mcp/install-detection.mjs",
  "../../capabilities/mcp/install-execution.mjs",
  "../../capabilities/mcp/install-sandbox.mjs",
  "../../capabilities/mcp/descriptor-validation.mjs",
  'url.pathname === "/config/mcp/install/plan"',
  'url.pathname === "/config/mcp/install/preview"',
  'url.pathname === "/config/mcp/install/run"'
]) {
  assert(installRoutes.includes(needle), `mcp-install-routes.mjs must retain MCP contract ${needle}`);
}

const aiStatusRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
for (const needle of [
  'url.pathname === "/ai/mcp"',
  '^\\/ai\\/mcp\\/[^/]+\\/toggle$',
  '^\\/ai\\/mcp\\/[^/]+\\/config$',
  "../../capabilities/mcp/client-bridge.mjs"
]) {
  assert(aiStatusRoutes.includes(needle), `ai-status-routes.mjs must retain MCP contract ${needle}`);
}

assert(read("src/service/executors/agentic/planner.mjs").includes("../../capabilities/mcp/client-bridge.mjs"),
  "agentic planner must still load MCP action tools through client-bridge");
assert(read("src/service/connectors/core/mcp-catalog-bridge.mjs").includes("../../capabilities/mcp/client-bridge.mjs"),
  "MCP catalog bridge must still delegate to client-bridge");
assert(read("src/service/connectors/core/workflow-dispatcher.mjs").includes("../../capabilities/mcp/client-bridge.mjs"),
  "workflow dispatcher must still execute external MCP via client-bridge");
assert(read("src/service/core/persistent-runtime.mjs").includes("../capabilities/mcp/client-bridge.mjs"),
  "persistent runtime must disconnect MCP clients on shutdown");
assert(read("src/service/core/service-bootstrap.mjs").includes("../capabilities/mcp/auto-install.mjs"),
  "service bootstrap must retain MCP auto-install owner wiring");
assert(read("scripts/start-lingxy-mcp-server.mjs").includes("../src/service/capabilities/mcp/internal-server/connector-mcp-server.mjs"),
  "internal MCP server start script must point at the MCP internal-server owner");

const bridgeSource = read(`${ownerDir}/client-bridge.mjs`);
assert(bridgeSource.includes("../registry/types.mjs"),
  "MCP client bridge must return createActionResult-compatible tool results");
assert(bridgeSource.includes("resolveMcpEnv"),
  "MCP client bridge must resolve env/secret refs before spawning servers");
assert(read(`${ownerDir}/install-execution.mjs`).includes("spawnExternal"),
  "MCP install execution must use external-call spawn wrapper");
assert(read(`${ownerDir}/internal-server/connector-mcp-server.mjs`).includes("runConnectorWorkflow"),
  "internal MCP server must delegate workflow execution to connector dispatcher");

const boundaryDoc = "docs/architecture/mcp-surface-boundary.md";
assert(existsSync(path.join(root, boundaryDoc)), "MCP surface boundary doc missing");
const boundarySource = read(boundaryDoc);
assert(boundarySource.includes("MCP Surface Boundary"), "MCP surface boundary doc title missing");
assert(boundarySource.includes("src/service/capabilities/mcp/"),
  "MCP surface boundary doc must name target MCP capability root");

if (!process.exitCode) {
  console.log("[mcp-surface] MCP surface contract verified");
}
