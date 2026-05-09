#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const agentLoop = read("src/service/executors/tool_using/agent-loop.mjs");

assert.match(agentLoop, /const MCP_STATUS_CACHE_TTL_MS = 5_000/u,
  "tool_using planner must cache MCP status for a short TTL");
assert.match(agentLoop, /const mcpStatusCache = new WeakMap\(\)/u,
  "tool_using planner must key MCP status cache by MCP server registry object");
assert.match(agentLoop, /async function listMcpStatusWithTtl/u,
  "tool_using planner must use a shared MCP status TTL helper");
assert.match(agentLoop, /cached\?\.promise[\s\S]{0,120}return cached\.promise/u,
  "MCP status helper must reuse an in-flight status promise");
assert.match(agentLoop, /const historyResultPromise = runtimeForLoader[\s\S]{0,260}loadStructuredHistoryFor/u,
  "structured history load must start before final planner prompt assembly");
assert.match(agentLoop, /const mcpCapabilitiesNotePromise = leanChatMode[\s\S]{0,160}resolveMcpCapabilitiesNote/u,
  "MCP capability status load must start before final planner prompt assembly");
assert.match(agentLoop, /const skillCapabilitiesNotePromise = leanChatMode[\s\S]{0,180}resolveSkillCapabilities/u,
  "skill capability load must start before final planner prompt assembly");
assert.match(agentLoop, /await Promise\.all\(\[[\s\S]{0,140}historyResultPromise[\s\S]{0,140}mcpCapabilitiesNotePromise[\s\S]{0,140}skillCapabilitiesNotePromise/u,
  "tool_using planner must await independent warmup tasks with Promise.all");
const warmupAwaitIndex = agentLoop.indexOf("const [historyResult, mcpCapabilitiesNote, skillCapabilities] = await Promise.all");
const systemPromptIndex = agentLoop.indexOf("const systemPrompt = leanChatMode");
assert.ok(warmupAwaitIndex >= 0 && systemPromptIndex >= 0 && warmupAwaitIndex < systemPromptIndex,
  "MCP and skill capability notes must be resolved before systemPrompt interpolates capability notes");
assert.doesNotMatch(agentLoop, /const statuses = await mcpServers\.listStatus/u,
  "tool_using planner must not synchronously block on mcpServers.listStatus in the hot path");

console.log("planner prefetch ok");
