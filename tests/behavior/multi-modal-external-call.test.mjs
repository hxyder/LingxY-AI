import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMultiModalExecutorScaffold } from "../../src/service/executors/multi_modal/multi-modal-executor.mjs";

async function collectEvents(asyncIterable) {
  const events = [];
  for await (const event of asyncIterable) {
    events.push(event);
  }
  return events;
}

async function withFakeVisionProvider(provider, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-multi-modal-"));
  const configPath = path.join(dir, "runtime.json");
  const imagePath = path.join(dir, "fixture.png");
  const originalConfigPath = process.env.UCA_CONFIG_PATH;
  const originalForceBootKimi = process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;

  await writeFile(imagePath, Buffer.from("not-a-real-png-but-readable"));
  await writeFile(configPath, JSON.stringify({
    ai: {
      customProviders: [provider],
      taskRouting: {
        vision: { providerId: provider.id }
      }
    }
  }));

  process.env.UCA_CONFIG_PATH = configPath;
  delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;

  try {
    return await fn({ imagePath });
  } finally {
    if (originalConfigPath === undefined) delete process.env.UCA_CONFIG_PATH;
    else process.env.UCA_CONFIG_PATH = originalConfigPath;

    if (originalForceBootKimi === undefined) delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
    else process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = originalForceBootKimi;

    await rm(dir, { recursive: true, force: true });
  }
}

async function withFakeAnthropicVisionProvider(fn) {
  return withFakeVisionProvider({
    id: "fake-anthropic-vision",
    kind: "anthropic",
    name: "Fake Anthropic Vision",
    apiKey: "test-key",
    baseUrl: "https://fake-anthropic-vision.local",
    defaultModel: "claude-sonnet-4-6",
    supportsVision: true
  }, fn);
}

async function withFakeOpenAIVisionProvider(fn) {
  return withFakeVisionProvider({
    id: "fake-openai-vision",
    kind: "openai",
    name: "Fake OpenAI Vision",
    apiKey: "test-key",
    baseUrl: "https://fake-openai-vision.local/v1",
    defaultModel: "gpt-4o",
    supportsVision: true
  }, fn);
}

test("multi-modal executor retries a transient Anthropic Vision HTTP failure and still emits success", async () => {
  await withFakeAnthropicVisionProvider(async ({ imagePath }) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, init = {}) => {
        const body = JSON.parse(init.body);
        calls.push({
          url,
          body,
          anthropicVersion: init.headers["anthropic-version"],
          hasAbortSignal: Boolean(init.signal)
        });
        if (calls.length === 1) {
          return new Response("temporary vision failure", { status: 502 });
        }
        return Response.json({
          content: [{ type: "text", text: "Recovered vision answer" }]
        });
      };

      const executor = createMultiModalExecutorScaffold();
      const events = await collectEvents(executor.execute({
        task_id: "task_multi_modal_anthropic_retry",
        user_command: "Describe the image",
        context_packet: { image_paths: [imagePath] }
      }));

      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "https://fake-anthropic-vision.local/v1/messages");
      assert.equal(typeof calls[0].body.model, "string");
      assert.ok(calls[0].body.model.length > 0);
      assert.equal(calls[0].body.messages[0].role, "user");
      assert.equal(calls[0].anthropicVersion, "2023-06-01");
      assert.equal(calls.every((call) => call.hasAbortSignal), true);

      assert.deepEqual(
        events.map((event) => event.event_type),
        ["step_started", "step_started", "log", "step_finished", "inline_result", "success"]
      );
      assert.equal(events.at(-1).payload.text, "Recovered vision answer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("multi-modal executor retries a transient OpenAI-compatible Vision HTTP failure and still emits success", async () => {
  await withFakeOpenAIVisionProvider(async ({ imagePath }) => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, init = {}) => {
        const body = JSON.parse(init.body);
        calls.push({
          url,
          body,
          authorization: init.headers.Authorization,
          hasAbortSignal: Boolean(init.signal)
        });
        if (calls.length === 1) {
          return new Response("temporary openai vision failure", { status: 502 });
        }
        return Response.json({
          choices: [{ message: { content: "Recovered OpenAI vision answer" } }]
        });
      };

      const executor = createMultiModalExecutorScaffold();
      const events = await collectEvents(executor.execute({
        task_id: "task_multi_modal_openai_retry",
        user_command: "Describe the image",
        context_packet: { image_paths: [imagePath] }
      }));

      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "https://fake-openai-vision.local/v1/chat/completions");
      assert.equal(calls[0].authorization, "Bearer test-key");
      assert.equal(typeof calls[0].body.model, "string");
      assert.ok(calls[0].body.model.length > 0);
      assert.equal(calls[0].body.messages[0].role, "user");
      assert.equal(calls.every((call) => call.hasAbortSignal), true);

      assert.deepEqual(
        events.map((event) => event.event_type),
        ["step_started", "step_started", "log", "step_finished", "inline_result", "success"]
      );
      assert.equal(events.at(-1).payload.text, "Recovered OpenAI vision answer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
