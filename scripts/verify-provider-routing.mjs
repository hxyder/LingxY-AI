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
  resolveActiveProviderForTask,
  buildKimiRuntimeFromProvider
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
        defaultModel: "deepseek-v4-flash"
      }
    ],
    taskRouting: {
      chat: { providerId: "deepseek", model: "deepseek-v4-flash", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "DeepSeek provider should resolve for chat.");
  assert.equal(provider.kind, "openai");
  assert.equal(provider.configId, "deepseek");
  assert.equal(provider.model, "deepseek-v4-flash");
  assert.equal(provider.baseUrl, "https://api.deepseek.com/v1");

  const descriptor = describeResolvedProvider(provider);
  assert.deepEqual(descriptor, {
    provider_id: "deepseek",
    provider_kind: "openai",
    provider_name: "DeepSeek",
    model: "deepseek-v4-flash",
    transport: "https",
    reasoning_effort: null
  });

  // code_cli fallback must be null — user chose an API provider.
  const cliRuntime = resolveCodeCliRuntimeForTask("chat", {
    command: "kimi",
    args: [],
    model: "kimi-k2.6",
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
  assert.equal(capturedBody.model, "deepseek-v4-flash");
  assert.equal(capturedBody.messages[0].content, "hi");
  assert.equal(capturedAuth, "Bearer sk-test-deepseek");
  assert.equal(result.text, "hello from deepseek");
  assert.deepEqual(result.tool_calls, []);

  // UCA-096 follow-up: task types without explicit routing must inherit the
  // chat routing's model, NOT fall back to getDefaultModelForKind which
  // picks a generic OpenAI model for every openai-compatible provider. The symptom
  // was `resolveProviderForTask("planner")` returning an OpenAI model
  // against DeepSeek's baseUrl, so the DAG planner got back
  // `{"error":"Model Not Exist"}` and silently turned into parse_failed.
  const plannerProvider = resolveProviderForTask("planner");
  assert.ok(plannerProvider, "planner should resolve via chat inheritance");
  assert.equal(plannerProvider.configId, "deepseek");
  assert.equal(
    plannerProvider.model,
    "deepseek-v4-flash",
    "unrouted task types must inherit the chat routing's model"
  );
  const summaryProvider = resolveProviderForTask("summary");
  assert.equal(summaryProvider?.model, "deepseek-v4-flash");
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
        defaultModel: "kimi-k2.6"
      }
    ],
    taskRouting: {
      chat: { providerId: "my-kimi-cli", model: "kimi-k2.6", mode: "default" }
    }
  }
});

{
  const provider = resolveProviderForTask("chat");
  assert.ok(provider, "Kimi CLI should resolve for chat.");
  assert.equal(provider.kind, "code_cli");
  assert.equal(provider.configId, "my-kimi-cli");
  assert.equal(provider.model, "kimi-k2.6");
  assert.equal(provider.command, "C:/Program Files/Kimi/kimi.exe");

  const descriptor = describeResolvedProvider(provider);
  assert.deepEqual(descriptor, {
    provider_id: "my-kimi-cli",
    provider_kind: "code_cli",
    provider_name: "Kimi CLI",
    model: "kimi-k2.6",
    transport: "subprocess",
    reasoning_effort: null
  });

  // code_cli path must produce a runtime object with the user's command.
  const cliRuntime = resolveCodeCliRuntimeForTask("chat", null);
  assert.ok(cliRuntime, "code_cli runtime must resolve when user routes chat to a code_cli provider.");
  assert.equal(cliRuntime.command, "C:/Program Files/Kimi/kimi.exe");
  assert.deepEqual(cliRuntime.args, ["--json"]);
  assert.equal(cliRuntime.model, "kimi-k2.6");
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
        defaultModel: "claude-sonnet-4-6"
      }
    ],
    taskRouting: {
      chat: { providerId: "claude", model: "claude-sonnet-4-6", mode: "default" }
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
      { role: "system", content: "You are LingxY." },
      { role: "user", content: "say hello" }
    ],
    fetchImpl: fakeFetch
  });
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(capturedApiKeyHeader, "sk-ant-test");
  assert.equal(capturedBody.model, "claude-sonnet-4-6");
  assert.ok(Array.isArray(capturedBody.system), "Anthropic system prompt should be sent as cacheable blocks");
  assert.equal(capturedBody.system[0].text, "You are LingxY.");
  assert.deepEqual(capturedBody.system[0].cache_control, { type: "ephemeral" });
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
        { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-1", defaultModel: "deepseek-v4-flash" }
      ],
      taskRouting: { chat: { providerId: "deepseek", model: "deepseek-v4-flash", mode: "default" } }
    }
  });
  let provider = resolveProviderForTask("chat");
  assert.equal(provider.configId, "deepseek");

  // Immediately switch to Claude, same process.
  await writeConfig({
    ai: {
      customProviders: [
        { id: "claude", name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-2", defaultModel: "claude-sonnet-4-6" }
      ],
      taskRouting: { chat: { providerId: "claude", model: "claude-sonnet-4-6", mode: "default" } }
    }
  });
  provider = resolveProviderForTask("chat");
  assert.equal(provider.configId, "claude", "Hot reload: second resolve call should see the new config.");
  assert.equal(provider.kind, "anthropic");
}

/* ------------------------------------------------------------------------ */
/* Case 5b — Semantic router routing inherits chat unless explicitly set     */
/* ------------------------------------------------------------------------ */

{
  await writeConfig({
    ai: {
      customProviders: [
        { id: "qa", name: "QA Model", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-qa", defaultModel: "claude-sonnet-4-6" },
        { id: "router", name: "Router Model", kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-router", defaultModel: "deepseek-v4-flash" }
      ],
      taskRouting: {
        chat: { providerId: "qa", model: "claude-sonnet-4-6", mode: "default" }
      }
    }
  });
  let routerProvider = resolveProviderForTask("router");
  assert.ok(routerProvider, "router task must inherit chat provider when unset");
  assert.equal(routerProvider.configId, "qa");
  assert.equal(routerProvider.kind, "anthropic");

  await writeConfig({
    ai: {
      customProviders: [
        { id: "qa", name: "QA Model", kind: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-qa", defaultModel: "claude-sonnet-4-6" },
        { id: "router", name: "Router Model", kind: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-router", defaultModel: "deepseek-v4-flash" }
      ],
      taskRouting: {
        chat: { providerId: "qa", model: "claude-sonnet-4-6", mode: "default" },
        router: { providerId: "router", model: "deepseek-v4-flash", mode: "default" }
      }
    }
  });
  routerProvider = resolveProviderForTask("router");
  assert.ok(routerProvider, "router task must resolve when explicitly configured");
  assert.equal(routerProvider.configId, "router");
  assert.equal(routerProvider.kind, "openai");
  assert.equal(routerProvider.model, "deepseek-v4-flash");
}

/* ------------------------------------------------------------------------ */
/* Case 5c — Embedding/RAG routing can use a separate vector model           */
/* ------------------------------------------------------------------------ */

{
  await writeConfig({
    ai: {
      customProviders: [
        { id: "qa", name: "QA Model", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-qa", defaultModel: "gpt-5.4-mini", embeddingModel: "text-embedding-3-large" },
        { id: "embed", name: "Embedding Model", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-embed", defaultModel: "text-embedding-3-small" }
      ],
      taskRouting: {
        chat: { providerId: "qa", model: "gpt-5.4-mini", mode: "default" }
      }
    }
  });
  let embeddingProvider = resolveProviderForTask("embedding");
  assert.ok(embeddingProvider, "embedding task must resolve via chat provider fallback when unset");
  assert.equal(embeddingProvider.configId, "qa");
  assert.equal(embeddingProvider.embeddingModel, "text-embedding-3-large");

  await writeConfig({
    ai: {
      customProviders: [
        { id: "qa", name: "QA Model", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-qa", defaultModel: "gpt-5.4-mini" },
        { id: "embed", name: "Embedding Model", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "sk-embed", defaultModel: "text-embedding-3-small" }
      ],
      taskRouting: {
        chat: { providerId: "qa", model: "gpt-5.4-mini", mode: "default" },
        embedding: { providerId: "embed", model: "text-embedding-3-small", mode: "default" }
      }
    }
  });
  embeddingProvider = resolveProviderForTask("embedding");
  assert.ok(embeddingProvider, "embedding task must resolve when explicitly configured");
  assert.equal(embeddingProvider.configId, "embed");
  assert.equal(embeddingProvider.kind, "openai");
  assert.equal(embeddingProvider.model, "text-embedding-3-small");
}

/* ------------------------------------------------------------------------ */
/* Case 6 — resolveActiveProviderForTask (diagnostic endpoint helper)       */
/* ------------------------------------------------------------------------ */

{
  await writeConfig({
    ai: {
      customProviders: [
        { id: "my-kimi-cli", name: "Kimi CLI", kind: "code_cli", command: "kimi.exe", transport: "stream_json_print", defaultModel: "kimi-k2.6" }
      ],
      taskRouting: { chat: { providerId: "my-kimi-cli", model: "kimi-k2.6" } }
    }
  });
  const active = resolveActiveProviderForTask("chat", null);
  assert.ok(active.descriptor);
  assert.equal(active.descriptor.provider_id, "my-kimi-cli");
  assert.equal(active.descriptor.transport, "subprocess");
  assert.ok(active.runtime, "resolveActiveProviderForTask must also return the code_cli runtime when the provider kind is code_cli.");
  assert.equal(active.runtime.command, "kimi.exe");
}

/* ────────────────────────────────────────────────────────────────────────
   New coverage — CLI-managed model + Codex reasoning-effort plumbing.
   Tests that when the user picks "(CLI 自行管理)" (model=""), the resolved
   runtime carries no model flag, and that reasoningEffort survives the
   route → resolver → buildKimiRuntimeFromProvider pipeline for Codex only.
   ──────────────────────────────────────────────────────────────────────── */

{
  // (a) model: "" means the CLI subprocess should not receive a --model flag.
  await writeConfig({
    ai: {
      customProviders: [
        { id: "claude-code", name: "Claude Code", kind: "code_cli", command: "claude.exe", transport: "stream_json_print", defaultModel: "" }
      ],
      taskRouting: { chat: { providerId: "claude-code", model: "" } }
    }
  });
  const resolved = resolveProviderForTask("chat", {});
  const runtime = buildKimiRuntimeFromProvider(resolved);
  assert.ok(runtime, "code_cli runtime must build even with empty model");
  assert.ok(!runtime.model, `empty-model routing must not populate runtime.model (got: ${runtime.model})`);
}

{
  // (b) reasoningEffort: "high" on a Codex provider flows into the runtime.
  await writeConfig({
    ai: {
      customProviders: [
        { id: "codex", name: "Codex CLI", kind: "code_cli", command: "codex.exe", transport: "stream_json_print", defaultModel: "" }
      ],
      taskRouting: { chat: { providerId: "codex", model: "", reasoningEffort: "high" } }
    }
  });
  const resolved = resolveProviderForTask("chat", {});
  assert.equal(resolved.reasoningEffort, "high", "Codex provider must surface route.reasoningEffort on the resolved config");
  const runtime = buildKimiRuntimeFromProvider(resolved);
  assert.equal(runtime.reasoningEffort, "high", "buildKimiRuntimeFromProvider must forward reasoningEffort");
}

{
  // (c) reasoningEffort on a non-Codex CLI is preserved in the runtime. The
  //     subprocess bridge maps it per CLI family: Claude gets `--effort`,
  //     Kimi gets no effort flag, and Codex gets config overrides.
  await writeConfig({
    ai: {
      customProviders: [
        { id: "kimi", name: "Kimi", kind: "code_cli", command: "kimi.exe", transport: "stream_json_print", defaultModel: "" }
      ],
      taskRouting: { chat: { providerId: "kimi", model: "", reasoningEffort: "high" } }
    }
  });
  const resolved = resolveProviderForTask("chat", {});
  const runtime = buildKimiRuntimeFromProvider(resolved);
  assert.equal(runtime.reasoningEffort, "high", "reasoningEffort preserved on non-Codex runtimes (bridge is the place that filters)");

  const { __testBuildInvocationArgs } = await import("../src/service/executors/agentic/code-cli-bridge.mjs");
  if (typeof __testBuildInvocationArgs === "function") {
    const kimiArgs = __testBuildInvocationArgs({ baseArgs: [], transport: "stream_json_print", command: "kimi.exe", reasoningEffort: "high" });
    assert.equal(kimiArgs.includes("--reasoning-effort"), false, "Kimi invocation must NOT receive --reasoning-effort flag");
    assert.equal(kimiArgs.includes("--effort"), false, "Kimi invocation must NOT receive Claude Code --effort flag");
    assert.equal(kimiArgs.includes("-c"), false, "Kimi invocation must NOT receive Codex config overrides");
    assert.equal(kimiArgs.includes("--mcp-config-file"), false, "Kimi invocation should only receive MCP files when configured");
    const claudeArgs = __testBuildInvocationArgs({
      baseArgs: [],
      transport: "stream_json_print",
      command: "claude.exe",
      configFile: "claude-settings.json",
      mcpConfigFiles: ["mcp.json"],
      reasoningEffort: "high"
    });
    assert.equal(claudeArgs.includes("--print"), true, "Claude invocation must use print mode");
    assert.equal(claudeArgs.includes("--verbose"), true, "Claude stream-json print mode must include --verbose");
    assert.equal(claudeArgs.includes("--mcp-config"), true, "Claude invocation must use --mcp-config");
    assert.equal(claudeArgs.includes("--mcp-config-file"), false, "Claude invocation must not receive Kimi's --mcp-config-file");
    assert.equal(claudeArgs.includes("--settings"), true, "Claude config files should map to --settings");
    assert.equal(claudeArgs.includes("--reasoning-effort"), false, "Claude invocation must NOT receive Codex reasoning flags");
    assert.equal(claudeArgs.includes("--effort"), true, "Claude invocation should receive Claude Code's --effort flag");
    assert.equal(claudeArgs[claudeArgs.indexOf("--effort") + 1], "high");
    const claudeNoEffortArgs = __testBuildInvocationArgs({
      baseArgs: [],
      transport: "stream_json_print",
      command: "claude.exe",
      reasoningEffort: ""
    });
    assert.equal(claudeNoEffortArgs.includes("--effort"), false, "Claude invocation must not receive --effort when no effort is selected");
    const claudeInvalidEffortArgs = __testBuildInvocationArgs({
      baseArgs: [],
      transport: "stream_json_print",
      command: "claude.exe",
      reasoningEffort: "unsupported"
    });
    assert.equal(claudeInvalidEffortArgs.includes("--effort"), false, "Claude invocation must drop unsupported effort values");
    const claudeXhighArgs = __testBuildInvocationArgs({
      baseArgs: [],
      transport: "stream_json_print",
      command: "claude.exe",
      reasoningEffort: "extra_high"
    });
    assert.equal(claudeXhighArgs[claudeXhighArgs.indexOf("--effort") + 1], "xhigh");
    const codexArgs = __testBuildInvocationArgs({ baseArgs: [], transport: "stream_json_print", command: "codex.exe", reasoningEffort: "high" });
    assert.equal(codexArgs[0], "exec", "Codex invocation must use `codex exec`");
    assert.equal(codexArgs.includes("--json"), true, "Codex invocation must request JSONL output");
    assert.equal(codexArgs.includes("--print"), false, "Codex invocation must not receive Kimi/Claude --print");
    assert.equal(codexArgs.includes("--reasoning-effort"), false, "Codex CLI does not support --reasoning-effort on this install");
    assert.equal(codexArgs.includes("-c"), true, "Codex invocation should carry reasoning effort through config override");
    assert.equal(codexArgs[codexArgs.indexOf("-c") + 1], "model_reasoning_effort=\"high\"");
    const codexXhighArgs = __testBuildInvocationArgs({ baseArgs: [], transport: "stream_json_print", command: "codex.exe", reasoningEffort: "extra_high" });
    assert.equal(codexXhighArgs[codexXhighArgs.indexOf("-c") + 1], "model_reasoning_effort=\"xhigh\"");
    const codexOldModelArgs = __testBuildInvocationArgs({ baseArgs: [], transport: "stream_json_print", command: "codex.exe", model: "gpt-4o" });
    assert.equal(codexOldModelArgs.includes("--model"), false, "Codex must not receive old saved gpt-4o model values");
  }

  const { __testBuildPrintInvocationArgs } = await import("../src/service/executors/kimi/kimi-cli-executor.mjs");
  if (typeof __testBuildPrintInvocationArgs === "function") {
    const codexFileArgs = __testBuildPrintInvocationArgs({
      command: "codex.exe",
      args: [],
      reasoningEffort: "xhigh",
      workDir: "C:\\Users\\der\\Desktop",
      addDirs: ["C:\\Users\\der\\Documents"]
    });
    assert.equal(codexFileArgs[0], "exec", "Codex file executor must use `codex exec`");
    assert.equal(codexFileArgs.includes("-w"), false, "Codex must not receive Kimi's -w worktree flag");
    assert.equal(codexFileArgs.includes("-C"), true, "Codex should receive a working directory via -C");
    assert.equal(codexFileArgs.includes("--add-dir"), true, "Codex should receive extra directories via --add-dir");
    const claudeFileArgs = __testBuildPrintInvocationArgs({
      command: "claude.exe",
      args: [],
      reasoningEffort: "extra_high",
      workDir: "C:\\Users\\der\\Desktop",
      addDirs: ["C:\\Users\\der\\Documents"],
      mcpConfigFiles: ["mcp.json"]
    });
    assert.equal(claudeFileArgs.includes("--print"), true, "Claude file executor must use print mode");
    assert.equal(claudeFileArgs.includes("--verbose"), true, "Claude file executor stream-json mode requires --verbose");
    assert.equal(claudeFileArgs.includes("-w"), false, "Claude must not receive Kimi's -w/--work-dir flag because Claude treats -w as worktree");
    assert.equal(claudeFileArgs.includes("--work-dir"), false, "Claude must not receive Kimi's --work-dir flag");
    assert.equal(claudeFileArgs.includes("--mcp-config"), true, "Claude file executor should use --mcp-config");
    assert.equal(claudeFileArgs.includes("--mcp-config-file"), false, "Claude file executor must not receive Kimi's MCP flag");
    assert.equal(claudeFileArgs[claudeFileArgs.indexOf("--effort") + 1], "xhigh", "Claude file executor should map extra_high to --effort xhigh");
    const kimiFileArgs = __testBuildPrintInvocationArgs({
      command: "kimi.exe",
      args: [],
      workDir: "C:\\Users\\der\\Desktop",
      addDirs: ["C:\\Users\\der\\Documents"],
      mcpConfigFiles: ["mcp.json"]
    });
    assert.equal(kimiFileArgs.includes("-w"), true, "Kimi file executor should receive Kimi's -w work-dir flag");
    assert.equal(kimiFileArgs.includes("--mcp-config-file"), true, "Kimi file executor should receive --mcp-config-file");
  }
}

console.log("Provider routing verification passed (DeepSeek / Kimi CLI / Claude / Ollama + hot-reload + router inheritance/override + resolveActiveProviderForTask + CLI-managed model + Codex exec/reasoning).");
