import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const runtime = createPersistentRuntime({
  baseDir: path.join(repoRoot, ".tmp", "verify-provider-health", crypto.randomUUID()),
  port: 0,
  pipeName: `\\\\.\\pipe\\uca-helper-provider-health-${crypto.randomUUID()}`
});

const listening = await runtime.start();

try {
  const health = await fetch(`${listening.baseUrl}/health`).then((response) => response.json());
  const providersPayload = await fetch(`${listening.baseUrl}/ai/providers`).then((response) => response.json());

  assert.equal(health.ok, true);
  assert.ok(Array.isArray(health.providers));
  assert.equal(health.providers.length, 4);
  assert.ok(Array.isArray(providersPayload.providers));
  assert.equal(providersPayload.providers.length, 4);

  const openai = providersPayload.providers.find((provider) => provider.id === "openai.gpt-5.4-mini");
  const anthropic = providersPayload.providers.find((provider) => provider.id === "anthropic.claude-sonnet");
  const kimi = providersPayload.providers.find((provider) => provider.id === "kimi.k2");
  const ollama = providersPayload.providers.find((provider) => provider.id === "ollama.local");

  assert.equal(typeof openai.configured, "boolean");
  assert.equal(typeof anthropic.configured, "boolean");
  assert.equal(typeof kimi.configured, "boolean");
  assert.equal(typeof ollama.available, "boolean");
  assert.equal(typeof ollama.detail, "string");
  assert.equal(typeof kimi.codeCliLinked, "boolean");
  assert.ok(openai.capabilities.supportsEmbeddings);
  assert.ok(anthropic.capabilities.supportsVision);

  console.log("AI provider health verification passed.");
} finally {
  await runtime.stop();
}
