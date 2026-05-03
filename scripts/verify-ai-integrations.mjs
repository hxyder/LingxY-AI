import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-ai-integrations", crypto.randomUUID());

await rm(runtimeDir, { recursive: true, force: true });

const runtime = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: `\\\\.\\pipe\\uca-helper-ai-integrations-${crypto.randomUUID()}`
});

async function postJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `${pathname} should succeed`);
  return response.json();
}

async function patchJson(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true, `PATCH ${pathname} failed with ${response.status}`);
  return response.json();
}

async function patchJsonResponse(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function postJsonResponse(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

const skillDir = path.join(runtime.paths.skillsDir, "scratch-skill");
await mkdir(skillDir, { recursive: true });
await writeFile(
  path.join(skillDir, "SKILL.md"),
  "# Scratch Skill\n\ndescription: Used by the AI integration verification script.\n",
  "utf8"
);

const listening = await runtime.start();

try {
  const config = await fetch(`${listening.baseUrl}/config/integrations`).then((response) => response.json());
  assert.equal(config.paths.mcpDir.endsWith(path.join("integrations", "mcp")), true);
  assert.equal(config.paths.skillsDir.endsWith(path.join("integrations", "skills")), true);
  assert.equal(config.paths.codeCliDir.endsWith(path.join("integrations", "code_cli")), true);

  await postJson(listening.baseUrl, "/config/providers", {
    id: "mock-openai",
    name: "Mock OpenAI",
    kind: "openai",
    baseUrl: "https://example.invalid/v1",
    apiKey: "sk-test",
    defaultModel: "mock-model"
  });

  const invalidMcp = await postJsonResponse(listening.baseUrl, "/config/mcp/servers", {
    id: "bad-mcp",
    displayName: "Bad MCP",
    transport: "stdio"
  });
  assert.equal(invalidMcp.response.status, 400, "stdio MCP server config must require a command");
  assert.equal(invalidMcp.payload?.error, "mcp_server_invalid");
  assert.ok(invalidMcp.payload?.errors?.includes("command required for stdio transport"));

  const invalidMcpPreflight = await postJsonResponse(listening.baseUrl, "/config/mcp/test", {
    id: "bad-mcp",
    displayName: "Bad MCP",
    transport: "http"
  });
  assert.equal(invalidMcpPreflight.response.status, 200, "MCP preflight should return structured validation, not throw");
  assert.equal(invalidMcpPreflight.payload?.ok, false);
  assert.ok(invalidMcpPreflight.payload?.errors?.includes("url required for http/ws transport"));

  const validMcpPreflight = await postJsonResponse(listening.baseUrl, "/config/mcp/test", {
    id: "mock-mcp",
    displayName: "Mock MCP",
    transport: "stdio",
    command: process.execPath,
    args: ["--version"]
  });
  assert.equal(validMcpPreflight.response.status, 200);
  assert.equal(validMcpPreflight.payload?.ok, true);
  assert.equal(validMcpPreflight.payload?.server?.command, process.execPath);

  await postJson(listening.baseUrl, "/config/mcp/servers", {
    id: "mock-mcp",
    displayName: "Mock MCP",
    transport: "stdio",
    command: process.execPath,
    args: ["--version"]
  });
  await writeFile(
    path.join(runtime.paths.mcpDir, "readonly-mcp.json"),
    JSON.stringify({
      servers: [{
        id: "readonly-mcp",
        displayName: "Readonly MCP",
        transport: "stdio",
        command: process.execPath,
        args: ["--version"]
      }]
    }),
    "utf8"
  );

  const legacySkillPath = await postJsonResponse(listening.baseUrl, "/config/skills/registries", {
    id: "legacy-path-field",
    displayName: "Legacy Path Field",
    path: runtime.paths.skillsDir
  });
  assert.equal(legacySkillPath.response.status, 400, "skill registry config must require rootPath, not legacy path");
  assert.equal(legacySkillPath.payload?.error, "id and rootPath required");

  await postJson(listening.baseUrl, "/config/skills/registries", {
    id: "scratch-skills",
    displayName: "Scratch Skills",
    rootPath: runtime.paths.skillsDir
  });

  await postJson(listening.baseUrl, "/config/code-cli/adapters", {
    id: "mock-code-cli",
    displayName: "Mock Code CLI",
    command: process.execPath,
    args: ["--version"],
    defaultModel: "mock-model",
    transport: "stream_json_print"
  });

  const providersPayload = await fetch(`${listening.baseUrl}/ai/providers`).then((response) => response.json());
  assert.ok(providersPayload.providers.some((provider) => provider.id === "mock-openai" && provider.configured));

  const mcpPayload = await fetch(`${listening.baseUrl}/ai/mcp`).then((response) => response.json());
  const mockMcp = mcpPayload.servers.find((server) => server.id === "mock-mcp");
  assert.equal(mockMcp.available, true);
  assert.equal(mockMcp.transport, "stdio");
  assert.equal(mockMcp.enabled, true);

  await patchJson(listening.baseUrl, "/ai/mcp/mock-mcp/toggle", { enabled: false });
  const disabledMcpPayload = await fetch(`${listening.baseUrl}/ai/mcp`).then((response) => response.json());
  const disabledMockMcp = disabledMcpPayload.servers.find((server) => server.id === "mock-mcp");
  assert.equal(disabledMockMcp.enabled, false, "runtime-config MCP servers must toggle through the card endpoint");
  assert.equal(disabledMockMcp.detail, "disabled");

  await patchJson(listening.baseUrl, "/ai/mcp/mock-mcp/toggle", { enabled: true });
  const reenabledMcpPayload = await fetch(`${listening.baseUrl}/ai/mcp`).then((response) => response.json());
  const reenabledMockMcp = reenabledMcpPayload.servers.find((server) => server.id === "mock-mcp");
  assert.equal(reenabledMockMcp.enabled, true);
  assert.equal(reenabledMockMcp.available, true);

  const readonlyToggle = await patchJsonResponse(listening.baseUrl, "/ai/mcp/readonly-mcp/toggle", { enabled: false });
  assert.equal(readonlyToggle.response.status, 409, "JSON-declared MCP servers must not report persisted toggle success");
  assert.equal(readonlyToggle.payload?.error, "mcp_server_read_only");
  assert.equal(readonlyToggle.payload?.serverId, "readonly-mcp");

  const skillsPayload = await fetch(`${listening.baseUrl}/ai/skills`).then((response) => response.json());
  assert.ok(skillsPayload.registries.some((registry) => registry.id === "scratch-skills" && registry.available));
  assert.ok(skillsPayload.skills.some((skill) => skill.id === "scratch-skill"));

  const codeCliPayload = await fetch(`${listening.baseUrl}/ai/code-cli`).then((response) => response.json());
  assert.ok(codeCliPayload.adapters.some((adapter) => adapter.id === "mock-code-cli" && adapter.available));

  console.log("AI integration registry verification passed.");
} finally {
  await runtime.stop();
}
