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

// CAP-4E preflight: lock the current Code CLI adapter/config/runtime-probe
// surface before the physical move to capabilities/code_cli.

const ownerDir = "src/service/ai/code_cli";
const targetDir = "src/service/capabilities/code_cli";
const expectedFiles = [
  "README.md",
  "builtin.mjs",
  "configured.mjs",
  "registry.mjs",
  "kimi/README.md",
  "kimi/runtime.mjs"
];

assert(existsSync(path.join(root, ownerDir)), `Code CLI owner dir missing: ${ownerDir}`);
assert(!existsSync(path.join(root, targetDir)),
  `${targetDir} must not exist before CAP-4E physical move`);
for (const file of expectedFiles) {
  assert(existsSync(path.join(root, ownerDir, file)), `Code CLI owner file missing: ${ownerDir}/${file}`);
}

const registry = await importModule(`${ownerDir}/registry.mjs`);
assertFunction(registry, `${ownerDir}/registry.mjs`, "createCodeCliRegistry");

const builtin = await importModule(`${ownerDir}/builtin.mjs`);
assertConst(builtin, `${ownerDir}/builtin.mjs`, "BUILTIN_CODE_CLI_ADAPTERS");
assert(Array.isArray(builtin.BUILTIN_CODE_CLI_ADAPTERS), "BUILTIN_CODE_CLI_ADAPTERS must be an array");
assert.deepEqual(
  builtin.BUILTIN_CODE_CLI_ADAPTERS.map((adapter) => adapter.id),
  ["kimi-code-cli", "codex-cli"],
  "built-in Code CLI adapter ids changed"
);

const configured = await importModule(`${ownerDir}/configured.mjs`);
assertFunction(configured, `${ownerDir}/configured.mjs`, "createConfiguredCodeCliAdapter");

const kimiRuntime = await importModule(`${ownerDir}/kimi/runtime.mjs`);
assertFunction(kimiRuntime, `${ownerDir}/kimi/runtime.mjs`, "getKimiRuntimeStatus");
assertFunction(kimiRuntime, `${ownerDir}/kimi/runtime.mjs`, "resolveKimiRuntime");

const registryInstance = registry.createCodeCliRegistry(builtin.BUILTIN_CODE_CLI_ADAPTERS);
assert.equal(registryInstance.list().length, 2, "Code CLI registry list size changed");
assert.equal(registryInstance.get("codex-cli")?.displayName, "Codex CLI", "Code CLI registry get changed");
const codexStatus = await registryInstance.getStatus("codex-cli", {});
assert.equal(codexStatus.available, true, "Codex CLI built-in status changed");
assert.equal(codexStatus.supportsCheckpointResume, true, "Codex CLI checkpoint capability changed");

const customAdapter = configured.createConfiguredCodeCliAdapter({
  id: "custom-cli",
  displayName: "Custom CLI",
  command: "custom-cli",
  args: ["--json"],
  defaultModel: "custom-model"
});
assert.equal(customAdapter.id, "custom-cli", "configured Code CLI adapter id changed");
assert.equal(customAdapter.transport, "stream_json_print", "configured Code CLI default transport changed");
assert.equal(customAdapter.source, "runtime_config", "configured Code CLI default source changed");
const customStatus = await customAdapter.getStatus();
assert.equal(customStatus.id, "custom-cli", "configured Code CLI status id changed");
assert.deepEqual(customStatus.args, ["--json"], "configured Code CLI args normalization changed");
assert.equal(customStatus.model, "custom-model", "configured Code CLI model changed");

const explicitKimi = kimiRuntime.resolveKimiRuntime({
  explicitRuntime: { command: "kimi", args: ["--mock"], env: { UCA_TEST: "1" } },
  env: {}
});
assert.equal(explicitKimi.transport, "jsonl_task_package", "explicit Kimi runtime transport default changed");
assert.equal(explicitKimi.maxRuntimeSeconds, 600, "explicit Kimi runtime timeout default changed");

// Code CLI owners must stay service/runtime code. They must not reach into
// desktop, Electron, renderer, preload, connector, MCP, skill, or provider
// catalog internals.
for (const file of walk(ownerDir)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!rel.endsWith(".mjs")) continue;
  const source = read(rel);
  for (const needle of [
    "src/desktop/",
    "electron",
    "renderer/",
    "preload/",
    "src/service/capabilities/connectors/",
    "src/service/capabilities/mcp/",
    "src/service/capabilities/skills/",
    "src/service/capabilities/providers/"
  ]) {
    assert(!source.includes(needle),
      `${rel} must not import forbidden Code CLI owner dependency ${needle}`);
  }
}

// Desktop UI/view-model files must not import Code CLI runtime internals.
for (const uiRoot of ["src/desktop/renderer", "src/desktop/console", "src/desktop/overlay"]) {
  for (const file of walk(uiRoot)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = read(rel);
    assert(!source.includes("src/service/ai/code_cli") && !source.includes("/ai/code_cli/"),
      `${rel} must not import Code CLI runtime internals`);
    assert(!source.includes("src/service/capabilities/code_cli") && !source.includes("/capabilities/code_cli/"),
      `${rel} must not import target Code CLI capability internals before CAP-4E move`);
  }
}

const aiRuntime = read("src/service/ai/integrations/runtime.mjs");
for (const needle of [
  "../code_cli/registry.mjs",
  "../code_cli/builtin.mjs",
  "../code_cli/configured.mjs",
  "createCodeCliRegistry(BUILTIN_CODE_CLI_ADAPTERS)",
  "createConfiguredCodeCliAdapter(adapter)"
]) {
  assert(aiRuntime.includes(needle), `AI integrations runtime must retain Code CLI wiring ${needle}`);
}

const persistentRuntime = read("src/service/core/persistent-runtime.mjs");
assert(persistentRuntime.includes("../ai/code_cli/kimi/runtime.mjs"),
  "persistent-runtime.mjs must retain Kimi runtime resolver wiring");

const providerRuntime = read("src/service/capabilities/providers/runtime.mjs");
assert(providerRuntime.includes("../../ai/code_cli/kimi/runtime.mjs"),
  "provider runtime must retain Kimi provider health wiring through Code CLI runtime");

const aiStatusRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
assert(aiStatusRoutes.includes('url.pathname === "/ai/code-cli"'),
  "ai-status-routes.mjs must retain /ai/code-cli route");

const configRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
for (const needle of [
  'url.pathname === "/config/detect-clis"',
  'url.pathname === "/config/code-cli/adapters"',
  'url.pathname.startsWith("/config/code-cli/adapters/")',
  "detectInstalledCodeClisCached",
  "requireDesktopActor({ request, response, allowedActors: [\"desktop_console\"] })"
]) {
  assert(configRoutes.includes(needle), `config-provider-routes.mjs must retain Code CLI route/detection contract ${needle}`);
}

const codeCliBridge = read("src/service/executors/agentic/code-cli-bridge.mjs");
for (const needle of ["spawnCodeCliChat", "buildCodeCliChatPrompt", "parseJsonToolCalls"]) {
  assert(codeCliBridge.includes(needle), `code-cli-bridge.mjs must retain execution boundary ${needle}`);
}

const providerAdapter = read("src/service/executors/agentic/provider-adapter.mjs");
assert(providerAdapter.includes('case "code_cli"') || providerAdapter.includes("case 'code_cli'"),
  "provider-adapter.mjs must retain code_cli transport branch");

const boundaryDoc = "docs/architecture/code-cli-surface-boundary.md";
assert(existsSync(path.join(root, boundaryDoc)), "Code CLI surface boundary doc missing");
const boundarySource = read(boundaryDoc);
assert(boundarySource.includes("Code CLI Surface Boundary"), "Code CLI surface boundary doc title missing");
assert(boundarySource.includes("src/service/ai/code_cli/"), "Code CLI boundary doc must name current owner");
assert(boundarySource.includes("src/service/capabilities/code_cli/"), "Code CLI boundary doc must name target owner");

console.log("[code-cli-surface] Code CLI surface contract verified");
