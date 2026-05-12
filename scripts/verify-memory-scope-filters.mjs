#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  approveMemoryProposal,
  buildUserMemoryBackgroundEntries,
  createMemoryProposal,
  filterMemoryGovernanceProfile,
  rejectMemoryProposal,
  sanitizeUserMemoryProfile
} from "../src/service/memory/user-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const userProfile = read("src/service/memory/user-profile.mjs");
const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const tests = read("tests/behavior/user-memory-profile.test.mjs");
const roadmap = read("docs/architecture/post-runtime-maturity-roadmap.md");

for (const required of [
  "filterMemoryGovernanceProfile",
  "matchesGovernanceFilter",
  "Boolean(normalizedProjectId) && item.projectId === normalizedProjectId",
  "scope: approved.scope",
  "projectId: approved.projectId",
  "conversationId: proposal.conversationId"
]) {
  assert.ok(userProfile.includes(required), `user-profile missing scope filter contract: ${required}`);
}

for (const required of [
  "userMemoryScopeFilter",
  "userMemoryProjectFilter",
  "userMemoryConversationFilter"
]) {
  assert.ok(consoleHtml.includes(required), `console HTML missing memory filter control: ${required}`);
  assert.ok(consoleJs.includes(required), `console JS missing memory filter wiring: ${required}`);
}

for (const required of [
  "does not leak project memory without matching scope context",
  "filters approved, proposed, and review records by scope",
  "filterMemoryGovernanceProfile"
]) {
  assert.ok(tests.includes(required), `user memory tests missing MR-002 coverage: ${required}`);
}

const projectProposal = createMemoryProposal({
  type: "project_fact",
  text: "Project A fact",
  scope: "project",
  projectId: "proj_a"
});
const otherProjectProposal = createMemoryProposal({
  type: "project_fact",
  text: "Project B fact",
  scope: "project",
  projectId: "proj_b"
});
const conversationProposal = createMemoryProposal({
  type: "episodic_task",
  text: "Conversation A fact",
  scope: "conversation",
  conversationId: "conv_a"
});
const profile = sanitizeUserMemoryProfile({
  projectMemories: [
    { projectId: "proj_a", text: "Project A note" },
    { projectId: "proj_b", text: "Project B note" }
  ],
  proposals: [projectProposal, otherProjectProposal, conversationProposal],
  approvedMemories: [
    { id: "global_1", type: "user_preference", scope: "global", text: "Global fact" }
  ]
});

const unscopedText = buildUserMemoryBackgroundEntries(profile)
  .map((entry) => entry.content)
  .join("\n");
assert.match(unscopedText, /Global fact/u);
assert.doesNotMatch(unscopedText, /Project A note/u);
assert.doesNotMatch(unscopedText, /Project A fact/u);

const approved = approveMemoryProposal(profile, projectProposal.proposalId);
const rejected = rejectMemoryProposal(approved, conversationProposal.proposalId);
const projectFiltered = filterMemoryGovernanceProfile(rejected, { scope: "project", projectId: "proj_a" });
assert.equal(projectFiltered.approvedMemories.length, 1, "project filter should include only project A approved memory");
assert.equal(projectFiltered.approvedMemories[0].projectId, "proj_a");
assert.equal(projectFiltered.proposals.length, 1, "project filter should include only project A proposal");
assert.equal(projectFiltered.reviewHistory.length, 1, "project filter should include only project A review");

assert.ok(roadmap.includes("MR-002 Memory project scope and review filters | complete"), "roadmap must mark MR-002 complete");
assert.ok(roadmap.includes("node scripts/verify-memory-scope-filters.mjs"), "roadmap must list MR-002 verifier");

const command = "node scripts/verify-memory-scope-filters.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include memory scope filter verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include memory scope filter verifier");

console.log("[memory-scope-filters] memory project/conversation scope filters verified");
