/**
 * verify-provider-routing.mjs — UCA-049 commit 1 regression guard.
 *
 * Asserts that switching the user's `ai.customProviders` + `ai.taskRouting`
 * config takes effect on the *next* call to `resolveProviderForTask` /
 * `describeResolvedProvider` / `createProviderAdapter`, without requiring a
 * service restart. This is the fix for the "切到 DeepSeek 后仍然在跑 Kimi CLI"
 * bug — the submission layer used to hardcode `runtime.kimiRuntime.*` reads
 * that were captured at boot.
 *
 * The script writes three separate configs to a scratch runtime.json, points
 * the resolver at that path via `UCA_CONFIG_PATH`, and for each config it:
 *   1. resolves the provider for task type "chat"
 *   2. builds an adapter
 *   3. calls adapter.generate({messages}) with a mocked fetch
 *   4. asserts the mock received the right URL + request body
 * It also asserts that `describeResolvedProvider` returns the user-facing
 * descriptor fields (provider_id / provider_kind / provider_name / model /
 * transport) that the task event payload injects.
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const scratchDir = path.join(repoRoot, ".tmp", "verify-provider-routing");
const configPath = path.join(scratchDir, "runtime.json");

await rm(scratchDir, { recursive: true, force: true });
await mkdir(scratchDir, { recursive: true });

process.env.UCA_CONFIG_PATH = configPath;
// Guard against env-var fallbacks leaking through and masking test failures.
for (const envKey of [
  "ANTHROPIC_API_KEY",
  "UCA_ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "UCA_OPENAI_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "UCA_KIMI_API_KEY",
  "UCA_OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "UCA_OLLAMA_MODEL"
]) {
  delete process.env[envKey];
}

const {
  resolveProviderForTask,
  resolveCodeCliRuntimeForTask,
  describeResolvedProvider,
  describeCodeCliRuntime,
  resolveActiveProviderForTask
} = await import("../src/service/executors/shared/provider-resolver.mjs");

const { createProviderAdapter } = await import("../src/service/executors/agentic/provider-adapter.mjs");

async function writeConfig(obj) {
  await writeFile(configPath, JSON.stringify(obj, null, 2), "utf8");
}

/* ------------------------------------------------------------------------ */
/* Case 1 — DeepSeek (OpenAI-compatible) routed to chat                     */
/* ------------------------------------------------------------------------ */

await writeConfig({
  ai: {
    customProviders: [
      {
        id: "deepseek",
        name: "DeepSeek",
        kind: "openai",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-test-deepseek",
        defaultModel: "deepseek-chat"
      }
    ],
    taskRouting: {
      chat: { providerId: "deepseek", model: "deepseek-chat", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "DeepSeek provider should resolve for chat.");
  assert.equal(provider.kind, "openai");
  assert.equal(provider.configId, "deepseek");
  assert.equal(provider.model, "deepseek-chat");
  assert.equal(provider.baseUrl, "https://api.deepseek.com/v1");

  const descriptor = describeResolvedProvider(provider);
  assert.deepEqual(descriptor, {
    provider_id: "deepseek",
    provider_kind: "openai",
    provider_name: "DeepSeek",
    model: "deepseek-chat",
    transport: "https"
  });

  // code_cli fallback must be null — user chose an API provider.
  const cliRuntime = resolveCodeCliRuntimeForTask("chat", {
    command: "kimi",
    args: [],
    model: "kimi-k2",
    transport: "stream_json_print"
  });
  assert.equal(cliRuntime, null, "DeepSeek routing must NOT fall back to boot-time Kimi CLI runtime.");

  // Adapter round-trip with mocked fetch.
  let capturedUrl = null;
  let capturedBody = null;
  let capturedAuth = null;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    capturedAuth = init.headers?.Authorization;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "hello from deepseek" } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 }
      })
    };
  };
  const adapter = createProviderAdapter(provider);
  assert.equal(adapter.kind, "openai");
  assert.equal(adapter.transport, "https");
  const result = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: fakeFetch
  });
  assert.equal(capturedUrl, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(capturedBody.model, "deepseek-chat");
  assert.equal(capturedBody.messages[0].content, "hi");
  assert.equal(capturedAuth, "Bearer sk-test-deepseek");
  assert.equal(result.text, "hello from deepseek");
  assert.deepEqual(result.tool_calls, []);
}

/* ------------------------------------------------------------------------ */
/* Case 2 — Kimi CLI (code_cli) routed to chat                              */
/* ------------------------------------------------------------------------ */

await writeConfig({
  ai: {
    customProviders: [
      {
        id: "my-kimi-cli",
        name: "Kimi CLI",
        kind: "code_cli",
        command: "C:/Program Files/Kimi/kimi.exe",
        args: ["--json"],
        transport: "stream_json_print",
        defaultModel: "kimi-k2"
      }
    ],
    taskRouting: {
      chat: { providerId: "my-kimi-cli", model: "kimi-k2", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "Kimi CLI should resolve for chat.");
  assert.equal(provider.kind, "code_cli");
  assert.equal(provider.configId, "my-kimi-cli");
  assert.equal(provider.model, "kimi-k2");
  assert.equal(provider.command, "C:/Program Files/Kimi/kimi.exe");

  const descriptor = describeResolvedProvider(provider);
  assert.deepEqual(descriptor, {
    provider_id: "my-kimi-cli",
    provider_kind: "code_cli",
    provider_name: "Kimi CLI",
    model: "kimi-k2",
    transport: "subprocess"
  });

  // code_cli path must produce a runtime object with the user's command.
  const cliRuntime = resolveCodeCliRuntimeForTask("chat", null);
  assert.ok(cliRuntime, "code_cli runtime must resolve when user routes chat to a code_cli provider.");
  assert.equal(cliRuntime.command, "C:/Program Files/Kimi/kimi.exe");
  assert.deepEqual(cliRuntime.args, ["--json"]);
  assert.equal(cliRuntime.model, "kimi-k2");
  assert.equal(cliRuntime.transport, "stream_json_print");

  const runtimeDescriptor = describeCodeCliRuntime(cliRuntime);
  assert.equal(runtimeDescriptor.provider_id, "my-kimi-cli");
  assert.equal(runtimeDescriptor.provider_kind, "code_cli");
  assert.equal(runtimeDescriptor.transport, "subprocess");

  // UCA-049 commit 3: code_cli adapter is now wired through code-cli-bridge.
  // The factory call still returns a working adapter; generate() actually
  // tries to spawn the configured command. With the bogus path used in this
  // case, spawn fails with ENOENT and the bridge wraps it as a clear error.
  // The "real" code_cli end-to-end path is verified in
  // verify-agentic-planner.mjs case 5 with a Node-based mock CLI.
  const adapter = createProviderAdapter(provider);
  assert.equal(adapter.kind, "code_cli");
  assert.equal(adapter.transport, "subprocess");
  await assert.rejects(
    () => adapter.generate({ messages: [{ role: "user", content: "ping" }] }),
    /(spawn failed|ENOENT|exited with code)/
  );
}

/* ------------------------------------------------------------------------ */
/* Case 3 — Anthropic (Claude API) routed to chat                           */
/* ------------------------------------------------------------------------ */

await writeConfig({
  ai: {
    customProviders: [
      {
        id: "claude",
        name: "Claude",
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-test",
        defaultModel: "claude-sonnet-4-5-20250514"
      }
    ],
    taskRouting: {
      chat: { providerId: "claude", model: "claude-sonnet-4-5-20250514", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "Claude provider should resolve for chat.");
  assert.equal(provider.kind, "anthropic");
  assert.equal(provider.configId, "claude");

  const descriptor = describeResolvedProvider(provider);
  assert.equal(descriptor.provider_id, "claude");
  assert.equal(descriptor.provider_kind, "anthropic");
  assert.equal(descriptor.transport, "https");

  let capturedUrl = null;
  let capturedBody = null;
  let capturedApiKeyHeader = null;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = JSON.parse(init.body);
    capturedApiKeyHeader = init.headers?.["x-api-key"];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "hello from claude" }],
        usage: { input_tokens: 4, output_tokens: 2 }
      })
    };
  };
  const adapter = createProviderAdapter(provider);
  assert.equal(adapter.kind, "anthropic");
  const result = await adapter.generate({
    messages: [
      { role: "system", content: "You are UCA." },
      { role: "user", content: "say hello" }
    ],
    fetchImpl: fakeFetch
  });
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedApiKeyHeader, "sk-ant-test");
  assert.equal(capturedBody.model, "claude-sonnet-4-5-20250514");
  assert.equal(capturedBody.system, "You are UCA.");
  assert.equal(capturedBody.messages[0].content, "say hello");
  assert.equal(result.text, "hello from claude");
}

/* ------------------------------------------------------------------------ */
/* Case 4 — Ollama (local) routed to chat, no apiKey required               */
/* ------------------------------------------------------------------------ */

await writeConfig({
  ai: {
    customProviders: [
      {
        id: "local-ollama",
        name: "Ollama",
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        defaultModel: "llama3.2"
      }
    ],
    taskRouting: {
      chat: { providerId: "local-ollama", model: "llama3.2", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "Ollama provider should resolve for chat.");
  assert.equal(provider.kind, "ollama");
  const descriptor = describeResolvedProvider(provider);
  assert.equal(descriptor.provider_id, "local-ollama");
  assert.equal(descriptor.transport, "https");

  let capturedUrl = null;
  const fakeFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        message: { content: "hello from ollama" },
        prompt_eval_count: 2,
        eval_count: 3
      })
    };
  };
  const adapter = createProviderAdapter(provider);
  assert.equal(adapter.kind, "ollama");
  const result = await adapter.generate({
    messages: [{ role: "user", content: "hi" }],
    fetchImpl: fakeFetch
  });
  assert.equal(capturedUrl, "http://127.0.0.1:11434/api/chat");
  assert.equal(result.text, "hello from ollama");
}

/* ------------------------------------------------------------------------ */
/* Case 5 — Hot reload: change config on disk mid-run                       */
/* ------------------------------------------------------------------------ */

{
  // Switch back to DeepSeek
  await writeConfig({
    ai: {
      customProviders: [
        { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-1", defaultModel: "deepseek-chat" }
      ],
      taskRouting: { chat: { providerId: "deepseek", model: "deepseek-chat", mode: "default" } }
    }
  });
  let provider = resolveProviderForTask("chat");
  assert.equal(provider.configId, "deepseek");

  // Immediately switch to Claude, same process.
  await writeConfig({
    ai: {
      customProviders: [
        { id: "claude", name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-2", defaultModel: "claude-sonnet-4-5-20250514" }
      ],
      taskRouting: { chat: { providerId: "claude", model: "claude-sonnet-4-5-20250514", mode: "default" } }
    }
  });
  provider = resolveProviderForTask("chat");
  assert.equal(provider.configId, "claude", "Hot reload: second resolve call should see the new config.");
  assert.equal(provider.kind, "anthropic");
}

/* ------------------------------------------------------------------------ */
/* Case 6 — resolveActiveProviderForTask (diagnostic endpoint helper)       */
/* ------------------------------------------------------------------------ */

{
  await writeConfig({
    ai: {
      customProviders: [
        { id: "my-kimi-cli", name: "Kimi CLI", kind: "code_cli", command: "kimi.exe", transport: "stream_json_print", defaultModel: "kimi-k2" }
      ],
      taskRouting: { chat: { providerId: "my-kimi-cli", model: "kimi-k2" } }
    }
  });
  const active = resolveActiveProviderForTask("chat", null);
  assert.ok(active.descriptor);
  assert.equal(active.descriptor.provider_id, "my-kimi-cli");
  assert.equal(active.descriptor.transport, "subprocess");
  assert.ok(active.runtime, "resolveActiveProviderForTask must also return the code_cli runtime when the provider kind is code_cli.");
  assert.equal(active.runtime.command, "kimi.exe");
}

console.log("Provider routing verification passed (DeepSeek / Kimi CLI / Claude / Ollama + hot-reload + resolveActiveProviderForTask).");
