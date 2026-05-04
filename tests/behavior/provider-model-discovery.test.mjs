import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderModelDiscovery
} from "../../src/service/ai/providers/model-discovery.mjs";

function jsonResponse(body, {
  ok = true,
  status = 200
} = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function modelById(result, id) {
  return result.models.find((model) => model.id === id);
}

test("provider model discovery merges configured, curated, and live model metadata", async () => {
  const requestedUrls = [];
  const discovery = createProviderModelDiscovery({
    cacheTtlMs: 60_000,
    async fetchImpl(url) {
      requestedUrls.push(url);
      return jsonResponse({
        data: [
          { id: "gpt-5.4-mini" },
          { id: "custom-live-model" }
        ]
      });
    }
  });

  const result = await discovery.getProviderModelOptions({
    id: "openai-main",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test-1234",
    defaultModel: "gpt-5.4-mini"
  });

  assert.equal(result.source, "provider_models");
  assert.equal(result.dynamic, true);
  assert.equal(result.stale, false);
  assert.deepEqual(requestedUrls, ["https://api.openai.com/v1/models"]);

  const defaultModel = modelById(result, "gpt-5.4-mini");
  assert.ok(defaultModel);
  assert.equal(defaultModel.configuredDefault, true);
  assert.equal(defaultModel.recommended, true);
  assert.equal(defaultModel.available, true);
  assert.deepEqual(defaultModel.sources, ["configured_default", "curated", "discovered"]);

  const liveModel = modelById(result, "custom-live-model");
  assert.ok(liveModel);
  assert.equal(liveModel.available, true);
  assert.equal(liveModel.recommended, false);
  assert.deepEqual(liveModel.sources, ["discovered"]);
});

test("code CLI model discovery is curated and exposes provider-specific effort choices", async () => {
  let called = false;
  const discovery = createProviderModelDiscovery({
    async fetchImpl() {
      called = true;
      throw new Error("code_cli_should_not_fetch");
    }
  });

  const result = await discovery.getProviderModelOptions({
    id: "claude-code",
    kind: "code_cli",
    command: "claude.exe",
    defaultModel: "opus"
  });

  assert.equal(called, false);
  assert.equal(result.source, "curated");
  assert.equal(result.dynamic, false);
  assert.ok(modelById(result, "opus")?.configuredDefault);
  assert.ok(modelById(result, "claude-opus-4-7")?.recommended);
  assert.ok(modelById(result, "opus[1m]")?.recommended);
  assert.ok(result.reasoningEfforts.some((option) => option.id === "max"));
});

test("provider model discovery falls back to stale live cache on refresh failure", async () => {
  let calls = 0;
  const discovery = createProviderModelDiscovery({
    cacheTtlMs: 60_000,
    async fetchImpl() {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ data: [{ id: "live-a" }] });
      }
      throw new Error("temporary provider outage");
    }
  });

  const provider = {
    id: "openrouter-main",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-router-5678",
    defaultModel: "openrouter/auto"
  };

  const first = await discovery.getProviderModelOptions(provider);
  assert.equal(first.stale, false);
  assert.ok(modelById(first, "live-a")?.available);

  const second = await discovery.getProviderModelOptions(provider, { forceRefresh: true });
  assert.equal(second.stale, true);
  assert.equal(second.error, "temporary provider outage");
  assert.ok(modelById(second, "live-a")?.available);
  assert.equal(calls, 2);
});
