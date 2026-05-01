import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFastExecutorScaffold } from "../../src/service/executors/fast/fast-executor.mjs";

async function collectEvents(asyncIterable) {
  const events = [];
  for await (const event of asyncIterable) {
    events.push(event);
  }
  return events;
}

function sseChatResponse(text) {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    "",
    "data: [DONE]",
    ""
  ].join("\n");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  });
}

async function withFakeOpenAIProvider(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-fast-executor-"));
  const configPath = path.join(dir, "runtime.json");
  const originalConfigPath = process.env.UCA_CONFIG_PATH;
  const originalForceBootKimi = process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;

  await writeFile(configPath, JSON.stringify({
    ai: {
      customProviders: [{
        id: "fake-openai",
        kind: "openai",
        name: "Fake OpenAI",
        apiKey: "test-key",
        baseUrl: "https://fake-openai.local/v1",
        defaultModel: "fake-chat-model"
      }],
      taskRouting: {
        chat: { providerId: "fake-openai" }
      }
    }
  }));

  process.env.UCA_CONFIG_PATH = configPath;
  delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;

  try {
    return await fn();
  } finally {
    if (originalConfigPath === undefined) delete process.env.UCA_CONFIG_PATH;
    else process.env.UCA_CONFIG_PATH = originalConfigPath;

    if (originalForceBootKimi === undefined) delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
    else process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = originalForceBootKimi;

    await rm(dir, { recursive: true, force: true });
  }
}

test("fast executor retries a transient OpenAI-compatible HTTP failure and still emits success", async () => {
  await withFakeOpenAIProvider(async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      globalThis.fetch = async (url, init = {}) => {
        calls.push({
          url,
          body: JSON.parse(init.body),
          hasAbortSignal: Boolean(init.signal)
        });
        if (calls.length === 1) {
          return new Response("temporary upstream failure", { status: 502 });
        }
        return sseChatResponse("Recovered answer");
      };

      const executor = createFastExecutorScaffold();
      const events = await collectEvents(executor.execute({
        task_id: "task_fast_retry",
        user_command: "Say hello",
        context_packet: {}
      }));

      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "https://fake-openai.local/v1/chat/completions");
      assert.equal(calls[0].body.model, "fake-chat-model");
      assert.equal(calls[0].body.stream, true);
      assert.equal(calls.every((call) => call.hasAbortSignal), true);

      assert.deepEqual(
        events.map((event) => event.event_type),
        ["step_started", "log", "planner_request_started", "step_finished", "inline_result", "success"]
      );
      assert.equal(events.at(-1).payload.text, "Recovered answer");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
