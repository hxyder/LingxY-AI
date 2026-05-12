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

// CAP-4D preflight: lock the current provider catalog/config/model-discovery
// surface before the physical move to capabilities/providers.

const ownerDir = "src/service/ai/providers";
const targetDir = "src/service/capabilities/providers";
const expectedFiles = [
  "README.md",
  "builtin.mjs",
  "configured.mjs",
  "model-discovery.mjs",
  "registry.mjs",
  "runtime.mjs"
];

assert(existsSync(path.join(root, ownerDir)), `provider owner dir missing: ${ownerDir}`);
assert(!existsSync(path.join(root, targetDir)),
  `${targetDir} must not exist before CAP-4D physical move`);
for (const file of expectedFiles) {
  assert(existsSync(path.join(root, ownerDir, file)), `provider owner file missing: ${ownerDir}/${file}`);
}

const registry = await importModule(`${ownerDir}/registry.mjs`);
assertFunction(registry, `${ownerDir}/registry.mjs`, "createAIProviderRegistry");

const builtin = await importModule(`${ownerDir}/builtin.mjs`);
assertConst(builtin, `${ownerDir}/builtin.mjs`, "BUILTIN_AI_PROVIDERS");
assert(Array.isArray(builtin.BUILTIN_AI_PROVIDERS), "BUILTIN_AI_PROVIDERS must be an array");
assert.deepEqual(
  builtin.BUILTIN_AI_PROVIDERS.map((provider) => provider.id),
  ["anthropic.claude-sonnet", "openai.gpt-5.4-mini", "kimi.k2", "ollama.local"],
  "built-in provider ids changed"
);

const configured = await importModule(`${ownerDir}/configured.mjs`);
assertFunction(configured, `${ownerDir}/configured.mjs`, "createConfiguredAIProvider");

const runtime = await importModule(`${ownerDir}/runtime.mjs`);
assertFunction(runtime, `${ownerDir}/runtime.mjs`, "getBuiltinProviderStatus");

const modelDiscovery = await importModule(`${ownerDir}/model-discovery.mjs`);
assertFunction(modelDiscovery, `${ownerDir}/model-discovery.mjs`, "createProviderModelDiscovery");

const aiProviders = registry.createAIProviderRegistry(builtin.BUILTIN_AI_PROVIDERS);
assert.equal(aiProviders.list().length, 4, "AI provider registry list size changed");
assert.equal(aiProviders.get("kimi.k2")?.displayName, "Kimi K2.6", "AI provider registry get changed");
const providerStatus = await aiProviders.getStatus("openai.gpt-5.4-mini", {
  config: { ai: { providers: { "openai.gpt-5.4-mini": { apiKeyConfigured: true } } } }
});
assert.equal(providerStatus.configured, true, "built-in OpenAI provider configured status changed");
assert.equal(providerStatus.capabilities.supportsEmbeddings, true, "built-in OpenAI capabilities changed");

const customProvider = configured.createConfiguredAIProvider({
  id: "custom-openai",
  name: "Custom OpenAI",
  kind: "openai",
  apiKeyConfigured: true,
  baseUrl: "https://example.test/v1",
  defaultModel: "custom-model"
});
assert.equal(await customProvider.isConfigured(), true, "configured provider isConfigured changed");
const customStatus = await customProvider.getStatus();
assert.equal(customStatus.id, "custom-openai", "configured provider status id changed");
assert.equal(customStatus.model, "custom-model", "configured provider model changed");

let discoveryFetched = false;
const discovery = modelDiscovery.createProviderModelDiscovery({
  async fetchImpl() {
    discoveryFetched = true;
    throw new Error("code_cli_should_not_fetch");
  }
});
const codeCliModels = await discovery.getProviderModelOptions({
  id: "codex-cli",
  kind: "code_cli",
  defaultModel: "gpt-5.5"
});
assert.equal(discoveryFetched, false, "code_cli model discovery must not fetch");
assert.equal(codeCliModels.source, "curated", "code_cli model discovery source changed");
assert(codeCliModels.models.some((model) => model.id === "gpt-5.5"), "code_cli curated models missing default");

// Provider owners must stay service/runtime code. They must not reach into
// desktop, Electron, renderer, preload, connector, MCP, or skill modules.
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
    "src/service/capabilities/skills/"
  ]) {
    assert(!source.includes(needle),
      `${rel} must not import forbidden provider owner dependency ${needle}`);
  }
}

// Desktop UI/view-model files must not import provider runtime internals.
for (const uiRoot of ["src/desktop/renderer", "src/desktop/console", "src/desktop/overlay"]) {
  for (const file of walk(uiRoot)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = read(rel);
    assert(!source.includes("src/service/ai/providers") && !source.includes("/ai/providers/"),
      `${rel} must not import provider runtime internals`);
    assert(!source.includes("src/service/capabilities/providers") && !source.includes("/capabilities/providers/"),
      `${rel} must not import provider capability internals`);
  }
}

const aiRuntime = read("src/service/ai/integrations/runtime.mjs");
for (const needle of [
  "../providers/registry.mjs",
  "../providers/builtin.mjs",
  "../providers/configured.mjs",
  "createAIProviderRegistry(BUILTIN_AI_PROVIDERS)",
  "createConfiguredAIProvider(provider)"
]) {
  assert(aiRuntime.includes(needle), `AI integrations runtime must retain provider wiring ${needle}`);
}

const httpServer = read("src/service/core/http-server.mjs");
assert(httpServer.includes("../ai/providers/model-discovery.mjs"),
  "http-server.mjs must construct provider model discovery from provider owner");

const aiStatusRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
for (const needle of [
  'url.pathname === "/ai/providers"'
]) {
  assert(aiStatusRoutes.includes(needle), `ai-status-routes.mjs must retain provider route ${needle}`);
}

const configRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
for (const needle of [
  'url.pathname === "/config/providers"',
  'url.pathname.startsWith("/config/providers/")',
  'url.pathname === "/config/provider-model-options"',
  'url.pathname === "/ai/active-provider-for-task"'
]) {
  assert(configRoutes.includes(needle), `config-provider-routes.mjs must retain provider route ${needle}`);
}

const providerBoundary = read("scripts/verify-provider-boundary.mjs");
for (const needle of ["provider-adapter.mjs", "provider-resolver.mjs", "resolveProviderForTask"]) {
  assert(providerBoundary.includes(needle), `provider boundary verifier must still lock ${needle}`);
}

const boundaryDoc = "docs/architecture/provider-surface-boundary.md";
assert(existsSync(path.join(root, boundaryDoc)), "provider surface boundary doc missing");
const boundarySource = read(boundaryDoc);
assert(boundarySource.includes("Provider Surface Boundary"), "provider surface boundary doc title missing");
assert(boundarySource.includes("src/service/capabilities/providers/"),
  "provider surface boundary doc must name target provider capability root");

if (!process.exitCode) {
  console.log("[provider-surface] provider surface contract verified");
}
