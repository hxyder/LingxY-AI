#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyUserMemoryProfileToContext,
  sanitizeUserMemoryProfile
} from "../src/service/memory/user-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const profileService = read("src/service/memory/user-profile.mjs");
const contextSubmission = read("src/service/core/context-submission.mjs");
const bgContexts = read("src/service/core/intent/background-contexts.mjs");
const contextSources = read("src/service/core/intent/context-sources.mjs");
const providerRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const behaviorTest = read("tests/behavior/user-memory-profile.test.mjs");
const plan = read("FUNCTION_AUDIT_AND_UPGRADE_PLAN.md");

assert.match(profileService, /sanitizeUserMemoryProfile/u, "user memory profile should have a sanitizer");
assert.match(profileService, /applyUserMemoryProfileToContext/u, "user memory profile should inject via structured context helper");
assert.match(profileService, /current user instruction override/u, "memory copy must state current user instructions win");
assert.match(contextSubmission, /applyUserMemoryProfileToContext/u, "submitContextTask should apply editable user memory");
assert.match(contextSubmission, /readUserMemoryProfileFromConfig/u, "submitContextTask should read memory from config");
assert.match(bgContexts, /"user_profile"/u, "background context schema should allow user_profile");
assert.match(bgContexts, /"project_memory"/u, "background context schema should allow project_memory");
assert.match(bgContexts, /"conversation_memory"/u, "background context schema should allow conversation_memory");
assert.match(contextSources, /case "user_profile":/u, "context source classifier should treat user_profile as background");
assert.match(contextSources, /case "project_memory":/u, "context source classifier should treat project_memory as background");
assert.match(contextSources, /case "conversation_memory":/u, "context source classifier should treat conversation_memory as background");
assert.match(
  contextSubmission,
  /applyUserMemoryProfileToContext[\s\S]{0,260}conversationId:\s*effectiveConversationId/u,
  "submitContextTask should pass conversationId into user memory injection"
);
assert.match(providerRoutes, /\/config\/user-memory/u, "local HTTP surface should expose user memory config route");
assert.match(providerRoutes, /requireDesktopActor[\s\S]{0,120}desktop_console/u, "user memory save route should be desktop guarded");
assert.match(consoleHtml, /id="userMemoryPanel"/u, "Console Settings should expose editable user memory panel");
assert.match(consoleHtml, /id="userMemoryAutoApprove"/u, "Console Settings should expose explicit auto-save memory opt-in");
assert.match(consoleJs, /renderUserMemorySettings/u, "Console should render user memory settings");
assert.match(consoleJs, /saveUserMemorySettings/u, "Console should save user memory settings");
assert.match(consoleJs, /autoApproveGenerated/u, "Console should persist the auto-save memory opt-in");
assert.match(behaviorTest, /background-only/u, "behavior tests should prove user memory remains background-only");
assert.match(behaviorTest, /conversation-scoped memory injects only for the matching conversation/u,
  "behavior tests should prove conversation memory is scoped");
assert.match(behaviorTest, /auto-approves only after explicit user opt-in/u,
  "behavior tests should prove generated memories require opt-in before auto-approval");
assert.match(
  plan,
  /FW-019[\s\S]*User\/project memory[\s\S]*PARTIAL/u,
  "upgrade plan should track FW-019 progress"
);

const profile = sanitizeUserMemoryProfile({
  preferences: ["Prefer concise answers."],
  projectMemories: [{ projectId: "proj_a", text: "Use Playwright for UI proof." }]
}, { now: "2026-05-08T00:00:00.000Z" });
const context = applyUserMemoryProfileToContext({ text: "hello", selection_metadata: {} }, profile, { projectId: "proj_a" });
assert.equal(context.selection_metadata.user_memory_injected, true);
assert.equal(context.background_contexts.length, 2);

const conversationProfile = sanitizeUserMemoryProfile({
  approvedMemories: [
    { id: "conv_a", scope: "conversation", conversationId: "conv_a", type: "episodic_task", text: "Conversation scoped marker." },
    { id: "conv_b", scope: "conversation", conversationId: "conv_b", type: "episodic_task", text: "Wrong conversation marker." }
  ]
}, { now: "2026-05-14T00:00:00.000Z" });
const conversationContext = applyUserMemoryProfileToContext(
  { text: "hello", selection_metadata: {} },
  conversationProfile,
  { conversationId: "conv_a" }
);
assert.equal(conversationContext.background_contexts.length, 1);
assert.equal(conversationContext.background_contexts[0].kind, "conversation_memory");
assert.match(conversationContext.background_contexts[0].content, /Conversation scoped marker/);
assert.doesNotMatch(conversationContext.background_contexts[0].content, /Wrong conversation marker/);

console.log("user memory profile verification passed");
