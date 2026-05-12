#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const client = read("src/desktop/renderer/shared/runtime-submission-client.mjs");
const memoryClient = read("src/desktop/renderer/shared/runtime-user-memory-client.mjs");
const preflightClient = read("src/desktop/renderer/shared/runtime-preflight-client.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");
const behavior = read("tests/behavior/runtime-submission-client.test.mjs");
const memoryBehavior = read("tests/behavior/runtime-user-memory-client.test.mjs");
const preflightBehavior = read("tests/behavior/runtime-preflight-client.test.mjs");
const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");
const checkManifest = read("scripts/check-manifest.mjs");

assert.match(client, /export function createRuntimeSubmissionClient/u,
  "runtime-submission-client must export createRuntimeSubmissionClient");
assert.match(client, /submitTask\(body = \{\}\)/u,
  "runtime-submission-client must own /task submission");
assert.match(client, /clarifyTask\(body = \{\}\)/u,
  "runtime-submission-client must own /task/clarify submission");
assert.match(client, /createConversation\(body = \{\}\)/u,
  "runtime-submission-client must own conversation creation mutation");
assert.match(client, /updateConversationModel\(conversationId, body = \{\}\)/u,
  "runtime-submission-client must own conversation model mutation");
assert.match(client, /clearConversationModel\(conversationId\)/u,
  "runtime-submission-client must own conversation model clear mutation");
assert.match(memoryClient, /export function createRuntimeUserMemoryClient/u,
  "runtime-user-memory-client must export createRuntimeUserMemoryClient");
assert.match(memoryClient, /saveUserMemory\(payload = \{\}\)/u,
  "runtime-user-memory-client must own user-memory save mutation");
assert.match(memoryClient, /decideProposal\(proposalId, action\)/u,
  "runtime-user-memory-client must own user-memory proposal mutation");
assert.match(memoryClient, /deleteMemory\(memoryId\)/u,
  "runtime-user-memory-client must own user-memory delete mutation");
assert.match(preflightClient, /export function createRuntimePreflightClient/u,
  "runtime-preflight-client must export createRuntimePreflightClient");
assert.match(preflightClient, /testMcpServerConfig\(payload = \{\}\)/u,
  "runtime-preflight-client must own MCP config validation");
assert.match(preflightClient, /planMcpInstall\(payload = \{\}\)/u,
  "runtime-preflight-client must own MCP install planning");
assert.match(preflightClient, /testSkillRegistryConfig\(payload = \{\}\)/u,
  "runtime-preflight-client must own skill registry validation");
assert.match(preflightClient, /previewDag\(graph\)/u,
  "runtime-preflight-client must own DAG preview validation");

assert.match(consoleJs, /createRuntimeSubmissionClient/u,
  "console renderer must use runtime submission client");
assert.match(consoleJs, /consoleSubmissionClient\.submitTask/u,
  "console task submission must use runtime submission client");
assert.match(consoleJs, /consoleSubmissionClient\.createConversation/u,
  "console conversation creation must use runtime submission client");
assert.match(consoleJs, /consoleSubmissionClient\.updateConversationModel/u,
  "console model mutation must use runtime submission client");
assert.match(consoleJs, /createRuntimeUserMemoryClient/u,
  "console renderer must use runtime user memory client");
assert.match(consoleJs, /consoleUserMemoryClient\.saveUserMemory/u,
  "console user-memory save must use runtime user memory client");
assert.match(consoleJs, /consoleUserMemoryClient\.decideProposal/u,
  "console user-memory proposal decisions must use runtime user memory client");
assert.match(consoleJs, /consoleUserMemoryClient\.deleteMemory/u,
  "console user-memory delete must use runtime user memory client");
assert.match(consoleJs, /createRuntimePreflightClient/u,
  "console renderer must use runtime preflight client");
assert.match(consoleJs, /consolePreflightClient\.testMcpServerConfig/u,
  "console MCP config validation must use runtime preflight client");
assert.match(consoleJs, /consolePreflightClient\.planMcpInstall/u,
  "console MCP install planning must use runtime preflight client");
assert.match(consoleJs, /consolePreflightClient\.testSkillRegistryConfig/u,
  "console skill validation must use runtime preflight client");
assert.match(consoleJs, /consolePreflightClient\.previewDag/u,
  "console DAG preview must use runtime preflight client");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/task/u,
  "console renderer must not submit tasks by direct fetchJson('/task')");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/conversations/u,
  "console renderer must not create conversations by direct fetchJson('/conversations')");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/config\/user-memory/u,
  "console renderer must not mutate user memory by direct fetchJson('/config/user-memory')");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*`\/config\/user-memory/u,
  "console renderer must not mutate user memory by direct fetchJson(`/config/user-memory...`)");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/config\/mcp\/test/u,
  "console renderer must not directly POST MCP preflight");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/config\/mcp\/install\/plan/u,
  "console renderer must not directly POST MCP install planning");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/config\/skills\/test/u,
  "console renderer must not directly POST skill preflight");
assert.doesNotMatch(consoleJs, /fetchJson\(\s*["']\/dag\/preview/u,
  "console renderer must not directly POST DAG preview");
assert.doesNotMatch(consoleJs, /desktopJsonOptions|desktopMutationOptions/u,
  "console renderer must not own duplicated desktop JSON mutation helpers");

assert.match(overlayJs, /createRuntimeSubmissionClient/u,
  "overlay renderer must use runtime submission client");
assert.match(overlayJs, /overlaySubmissionClient\.submitTask/u,
  "overlay task submission must use runtime submission client");
assert.match(overlayJs, /overlaySubmissionClient\.clarifyTask/u,
  "overlay clarification submission must use runtime submission client");
assert.doesNotMatch(overlayJs, /fetchJson\(\s*["']\/task/u,
  "overlay renderer must not submit tasks by direct fetchJson('/task')");
assert.doesNotMatch(overlayJs, /fetchJson\(\s*["']\/task\/clarify/u,
  "overlay renderer must not clarify tasks by direct fetchJson('/task/clarify')");

assert.match(behavior, /runtime submission client routes task and clarification mutations/u,
  "runtime submission client behavior tests must cover task and clarification mutations");
assert.match(behavior, /conversation model mutations/u,
  "runtime submission client behavior tests must cover conversation model mutations");
assert.match(memoryBehavior, /runtime user memory client owns save, proposal, delete, and undo mutations/u,
  "runtime user memory client behavior tests must cover save/proposal/delete/undo mutations");
assert.match(preflightBehavior, /runtime preflight client owns MCP, skill, and DAG validation mutations/u,
  "runtime preflight client behavior tests must cover MCP/skill/DAG validation mutations");
assert.match(roadmap, /DX-003: Renderer Runtime Client Consolidation/u,
  "roadmap must track DX-003");
assert.match(checkManifest, /node scripts\/verify-renderer-runtime-client-consolidation\.mjs/u,
  "check manifest must include renderer runtime client consolidation verifier");

console.log("[verify-renderer-runtime-client-consolidation] renderer runtime mutation client contract OK");
