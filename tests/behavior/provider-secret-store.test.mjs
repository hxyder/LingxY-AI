import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeConfigStore } from "../../src/service/core/config-store.mjs";
import { createPersistentRuntime } from "../../src/service/core/persistent-runtime.mjs";
import { ensureRuntimePaths, resolveRuntimePaths } from "../../src/service/core/runtime-paths.mjs";
import {
  createLocalSecretStore,
  createProviderApiKeySecretRef
} from "../../src/service/security/secret-store.mjs";
import { resolveProviderForTask } from "../../src/service/executors/shared/provider-resolver.mjs";

const CLOUD_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "UCA_ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "UCA_OPENAI_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "UCA_KIMI_API_KEY"
];

async function withTempRuntime(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function withIsolatedProviderEnv({ configPath, secretsPath }, fn) {
  const original = {
    UCA_CONFIG_PATH: process.env.UCA_CONFIG_PATH,
    UCA_SECRET_STORE_PATH: process.env.UCA_SECRET_STORE_PATH,
    UCA_FORCE_BOOT_KIMI_RUNTIME: process.env.UCA_FORCE_BOOT_KIMI_RUNTIME
  };
  const cloud = Object.fromEntries(CLOUD_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.UCA_CONFIG_PATH = configPath;
  process.env.UCA_SECRET_STORE_PATH = secretsPath;
  delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
  for (const key of CLOUD_ENV_KEYS) delete process.env[key];
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of Object.entries(cloud)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("runtime config migrates provider api keys into a secret ref that the resolver can hydrate", async () => {
  await withTempRuntime("lingxy-provider-secret-", async (dir) => {
    const paths = ensureRuntimePaths(resolveRuntimePaths({ baseDir: dir }));
    const secretStore = createLocalSecretStore({ paths });
    const configStore = createRuntimeConfigStore({
      configPath: paths.configPath,
      secretStore,
      defaults: {}
    });

    const saved = configStore.save({
      ai: {
        customProviders: [{
          id: "secret-openai",
          name: "Secret OpenAI",
          kind: "openai",
          baseUrl: "https://secret-openai.example/v1",
          apiKey: "sk-secret-store-test",
          defaultModel: "secret-model"
        }],
        taskRouting: {
          chat: { providerId: "secret-openai" }
        }
      }
    });

    const provider = saved.ai.customProviders[0];
    assert.equal(provider.apiKey, undefined);
    assert.equal(provider.apiKeyRef, createProviderApiKeySecretRef("secret-openai"));

    const runtimeJson = await readFile(paths.configPath, "utf8");
    assert.equal(runtimeJson.includes("sk-secret-store-test"), false);

    const resolved = withIsolatedProviderEnv(paths, () => resolveProviderForTask("chat"));
    assert.equal(resolved.apiKey, "sk-secret-store-test");
    assert.equal(resolved.configId, "secret-openai");
    assert.equal(resolved.model, "secret-model");
  });
});

test("provider config HTTP route redacts keys, preserves blank edits, and deletes provider secrets", async () => {
  await withTempRuntime("lingxy-provider-secret-http-", async (dir) => {
    const runtime = createPersistentRuntime({
      baseDir: dir,
      port: 0,
      pipeName: `\\\\.\\pipe\\lingxy-provider-secret-${crypto.randomUUID()}`
    });
    const listening = await runtime.start();
    const headers = {
      "Content-Type": "application/json",
      "X-Lingxy-Desktop-Actor": "desktop_console"
    };
    try {
      const createResponse = await fetch(`${listening.baseUrl}/config/providers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "http-openai",
          name: "HTTP OpenAI",
          kind: "openai",
          baseUrl: "https://http-openai.example/v1",
          apiKey: "sk-http-secret",
          defaultModel: "http-model"
        })
      });
      assert.equal(createResponse.ok, true);
      const createPayload = await createResponse.json();
      assert.equal(createPayload.provider.apiKey, undefined);
      assert.equal(createPayload.provider.apiKeyConfigured, true);

      const configOnDisk = await readFile(runtime.paths.configPath, "utf8");
      assert.equal(configOnDisk.includes("sk-http-secret"), false);
      assert.equal(configOnDisk.includes(createProviderApiKeySecretRef("http-openai")), true);

      const listPayload = await fetch(`${listening.baseUrl}/config/providers`).then((response) => response.json());
      assert.equal(listPayload.providers[0].apiKey, undefined);
      assert.equal(listPayload.providers[0].apiKeyConfigured, true);

      const editResponse = await fetch(`${listening.baseUrl}/config/providers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: "http-openai",
          name: "HTTP OpenAI",
          kind: "openai",
          baseUrl: "https://http-openai.example/v1",
          defaultModel: "http-model-v2"
        })
      });
      assert.equal(editResponse.ok, true);
      assert.equal(runtime.runtime.secretStore.getSync(createProviderApiKeySecretRef("http-openai")), "sk-http-secret");

      const deleteResponse = await fetch(`${listening.baseUrl}/config/providers/http-openai`, {
        method: "DELETE",
        headers: {
          "X-Lingxy-Desktop-Actor": "desktop_console"
        }
      });
      assert.equal(deleteResponse.ok, true);
      assert.equal(runtime.runtime.secretStore.getSync(createProviderApiKeySecretRef("http-openai")), null);
    } finally {
      await runtime.stop();
    }
  });
});
