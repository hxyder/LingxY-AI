#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const read = (path) => readFileSync(path, "utf8");

const fast = read("src/service/executors/fast/fast-executor.mjs");
const toolUsing = read("src/service/executors/tool_using/agent-loop.mjs");
const toolFinalComposer = read("src/service/executors/tool_using/final-composer.mjs");
const agenticExecutor = read("src/service/executors/agentic/executor.mjs");
const agenticPlanner = read("src/service/executors/agentic/planner.mjs");
const agenticToolExecution = read("src/service/executors/agentic/tool-execution.mjs");
const providerAdapter = read("src/service/executors/agentic/provider-adapter.mjs");
const multimodal = read("src/service/executors/multi_modal/multi-modal-executor.mjs");
const translate = read("src/service/executors/translate/translate-executor.mjs");
const kimi = read("src/service/executors/kimi/kimi-cli-executor.mjs");
const codeCliBridge = read("src/service/executors/agentic/code-cli-bridge.mjs");
const desktopMain = read("src/desktop/tray/electron-main.mjs");
const smokeRunner = read("src/desktop/smoke/desktop-gui-smoke-runner.mjs");
const interactionSmoke = read("scripts/verify-user-interaction-smoke.mjs");

assert.match(fast, /async \*execute\(task,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/u,
  "fast executor must accept AbortSignal");
assert.match(fast, /callOpenAICompatible\([\s\S]*signal,/u,
  "fast OpenAI-compatible path must pass signal");
assert.match(fast, /callAnthropic\([\s\S]*signal,/u,
  "fast Anthropic path must pass signal");
assert.match(fast, /callOllama\([\s\S]*signal/u,
  "fast Ollama path must pass signal");

assert.match(toolUsing, /async function llmPlanner\([\s\S]*signal/u,
  "tool_using planner must accept signal");
assert.match(toolUsing, /adapter\.generate\(\{[\s\S]*signal,/u,
  "tool_using planner must pass signal to provider adapter");
assert.match(toolUsing, /registry\.call\(plan\.toolId,\s*plan\.args,\s*ctx\)/u,
  "tool_using deterministic artifact recovery must call the planned artifact tool through registry.call");
assert.match(toolUsing, /const ctx = \{[\s\S]*signal[\s\S]*\};[\s\S]*registry\.call\(plan\.toolId,\s*plan\.args,\s*ctx\)/u,
  "tool_using deterministic artifact recovery must pass signal to planned artifact tools");
assert.match(toolUsing, /registry\.call\(tool\.id,\s*decision\.args,[\s\S]*signal/u,
  "tool_using runtime tool calls must pass signal");
assert.match(toolUsing, /attemptArtifactRecovery\(\{[\s\S]*signal/u,
  "tool_using final artifact recovery must preserve signal");
assert.match(toolFinalComposer, /adapter\.generate\(\{[\s\S]*signal,/u,
  "tool_using final composer must pass signal to provider adapter");

assert.match(agenticExecutor, /runAgenticPlanner\(\{[\s\S]*signal,/u,
  "agentic executor must pass signal to planner");
assert.match(agenticPlanner, /adapter\.generate\(\{[\s\S]*signal,/u,
  "agentic planner must pass signal to provider adapter");
assert.match(agenticPlanner, /executeAgenticToolCall\(\{[\s\S]*signal/u,
  "agentic planner must pass signal to tool execution");
assert.match(agenticToolExecution, /if \(signal\?\.aborted\)/u,
  "agentic tool execution must abort before running tools");
assert.match(agenticToolExecution, /tool\.execute\(callArgs,\s*\{[\s\S]*signal/u,
  "agentic tool execution must pass signal to tool.execute");

for (const provider of ["generateAnthropic", "generateOpenAI", "generateOllama", "generateCodeCli"]) {
  assert.match(providerAdapter, new RegExp(`async function ${provider}\\([\\s\\S]*signal`, "u"),
    `${provider} must accept signal`);
}
assert.match(providerAdapter, /fetchFn\([\s\S]*signal/u,
  "provider adapter fetch calls must include signal");
assert.match(providerAdapter, /runCodeCliChat\(\{[\s\S]*signal/u,
  "code-cli provider adapter must pass signal to code CLI bridge");

assert.match(multimodal, /async \*execute\(task,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/u,
  "multi-modal executor must accept signal");
assert.match(multimodal, /callAnthropicVision\(\{[\s\S]*signal/u,
  "multi-modal Anthropic vision path must pass signal");
assert.match(multimodal, /callOpenAIVision\(\{[\s\S]*signal/u,
  "multi-modal OpenAI vision path must pass signal");
assert.match(translate, /async \*execute\(task,\s*\{\s*signal\s*\}\s*=\s*\{\}\)/u,
  "translate executor must accept signal");
assert.match(translate, /signal\s*\}/u,
  "translate executor must pass signal to provider call");
assert.match(kimi, /abortSignal/u,
  "Kimi executor must pass abortSignal to CLI invocation");
assert.match(codeCliBridge, /abortSignal:\s*signal/u,
  "agentic code CLI bridge must map signal to abortSignal");

for (const checkName of [
  "task_cancel_ipc_bridge",
  "overlay_stop_button_cancel",
  "console_stop_button_cancel",
  "console_task_detail_cancel"
]) {
  assert.equal(smokeRunner.includes(checkName), true,
    `desktop GUI smoke runner must include ${checkName}`);
  assert.equal(interactionSmoke.includes(checkName), true,
    `user interaction smoke must guard ${checkName}`);
}

const command = "node scripts/verify-cancellation-propagation.mjs";
assert.equal(CHECK_COMMANDS.includes(command), true,
  "full check manifest must include cancellation propagation verifier");
assert.equal(FAST_CHECK_COMMANDS.includes(command), true,
  "fast check manifest must include cancellation propagation verifier");

console.log("cancellation propagation verification passed");
