#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

function walkFiles(relativeDir) {
  const start = path.join(root, relativeDir);
  if (!existsSync(start)) return [];
  const files = [];
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    const fullPath = path.join(start, entry.name);
    const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath));
    } else if (/\.(?:mjs|js|cjs)$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

const docPath = "docs/architecture/session-context-artifact-write-budget.md";
assert.ok(existsSync(path.join(root, docPath)), "RT-002 session/context/artifact write-budget doc missing");
const doc = read(docPath);

for (const required of [
  "# Session Context Artifact Write Budget",
  "RT-002",
  "RT-001 Decision Applied",
  "Budgeted Write Surfaces",
  "Context Trace Decision",
  "Hot-Path Rules",
  "Queue Reconsideration Gate",
  "Verification",
  "No DB queue or DB worker is introduced in RT-002"
]) {
  assert.ok(doc.includes(required), `RT-002 write-budget doc missing: ${required}`);
}

const command = "node scripts/verify-session-context-artifact-write-budget.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "full check manifest must include RT-002 write-budget verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include RT-002 write-budget verifier");

const sessionService = read("src/service/core/session/conversation-session-service.mjs");
for (const eventType of [
  "tool_call_started",
  "tool_call_proposed",
  "tool_call_completed",
  "tool_call_denied"
]) {
  assert.match(sessionService, new RegExp(`TOOL_EVENT_TYPES[\\s\\S]*"${eventType}"`, "u"),
    `ConversationSessionService must record ${eventType}`);
}
for (const streamType of [
  "text_delta",
  "tool_input_delta",
  "reasoning_delta",
  "tool_planner_decision"
]) {
  assert.doesNotMatch(sessionService, new RegExp(`TOOL_EVENT_TYPES[\\s\\S]*"${streamType}"`, "u"),
    `ConversationSessionService must not record high-frequency ${streamType} as a session item`);
}
assert.match(sessionService, /const MAX_SESSION_CONTENT_CHARS = 12000/u,
  "ConversationSessionService must bound session item content text");
assert.match(sessionService, /function truncateContent/u,
  "ConversationSessionService must truncate observation text");
assert.match(sessionService, /store\.appendSessionItem/u,
  "ConversationSessionService must own appendSessionItem calls");

const eventEmitter = read("src/service/core/task-runtime/event-emitter.mjs");
assert.match(eventEmitter, /runtime\.conversationSessions\?\.recordTaskEvent\?\./u,
  "event emitter must route task events through ConversationSessionService");
assert.match(eventEmitter, /EPHEMERAL_EVENT_TYPES[\s\S]*"text_delta"[\s\S]*"tool_input_delta"[\s\S]*"reasoning_delta"[\s\S]*"tool_planner_decision"/u,
  "event emitter must keep stream deltas ephemeral");

const contextCompiler = read("src/service/core/context/context-compiler.mjs");
assert.match(contextCompiler, /export function compileContextForTask/u,
  "ContextCompiler must expose compileContextForTask");
assert.match(contextCompiler, /recordRuntimeTiming\?\.\("context\.compile"/u,
  "ContextCompiler must record metrics");
assert.match(contextCompiler, /listArtifactExtractsForArtifact/u,
  "ContextCompiler may read existing artifact extracts");
assert.doesNotMatch(contextCompiler, /\b(?:appendSessionItem|appendArtifactExtract|appendArtifactLineage|insertTask|updateTask|appendEvent)\b/u,
  "ContextCompiler must not write task/session/artifact/event records");

const taskRecord = read("src/service/core/task-runtime/task-record.mjs");
assert.match(taskRecord, /compileContextForTask/u,
  "task record creation must compile context");
assert.match(taskRecord, /compiled_context:\s*compiledContext/u,
  "task record creation must stamp compact compiled_context into context_packet");
assert.doesNotMatch(taskRecord, /context_compile_traces/u,
  "RT-002 must not add context_compile_traces writes");

const extractService = read("src/service/core/artifact-extracts/artifact-extract-service.mjs");
assert.match(extractService, /const MAX_EXTRACT_TEXT_CHARS = 20000/u,
  "ArtifactExtractService must bound extract text");
assert.match(extractService, /function truncateText/u,
  "ArtifactExtractService must truncate extract text");
assert.match(extractService, /store\.appendArtifactExtract/u,
  "ArtifactExtractService must own appendArtifactExtract writes");

const extractLane = read("src/service/core/artifact-extracts/artifact-extract-background-lane.mjs");
for (const required of [
  "createArtifactExtractBackgroundLane",
  "queue = []",
  "running = new Set()",
  "DEFAULT_MAX_CONCURRENT = 1",
  "createTimeoutAbortController",
  "artifactExtracts.appendExtract",
  "snapshot()"
]) {
  assert.ok(extractLane.includes(required), `artifact extract background lane missing ${required}`);
}

const lineageService = read("src/service/core/artifact-lineage/artifact-lineage-service.mjs");
assert.match(lineageService, /validateArtifactTransformContract/u,
  "ArtifactLineageService must validate transform contracts");
assert.match(lineageService, /appendTransformLineage\(options = \{\}\)[\s\S]{0,260}sourceArtifactIds required/u,
  "appendTransformLineage must require source artifacts");
assert.match(lineageService, /store\.appendArtifactLineage/u,
  "ArtifactLineageService must own appendArtifactLineage writes");

const runtimeServices = read("src/service/core/task-runtime/runtime-services.mjs");
for (const required of [
  "createConversationSessionService",
  "createArtifactExtractService",
  "createArtifactExtractBackgroundLane",
  "createArtifactLineageService"
]) {
  assert.ok(runtimeServices.includes(required), `runtime services must wire ${required}`);
}

const forbiddenPersistenceCalls = /\b(?:appendSessionItem|appendArtifactExtract|appendArtifactLineage)\b/u;
for (const file of [
  ...walkFiles("src/desktop"),
  ...walkFiles("src/service/executors")
]) {
  const source = read(file);
  assert.doesNotMatch(source, forbiddenPersistenceCalls,
    `${file} must not directly own session/artifact persistence writes`);
}

console.log("[session-context-artifact-write-budget] RT-002 write budget verified");
