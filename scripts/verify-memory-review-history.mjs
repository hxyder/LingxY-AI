#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import {
  approveMemoryProposal,
  createMemoryProposal,
  deleteApprovedMemory,
  rejectMemoryProposal,
  undoMemoryReview
} from "../src/service/memory/user-profile.mjs";

const profile = readFileSync("src/service/memory/user-profile.mjs", "utf8");
const routes = readFileSync("src/service/core/http-routes/config-provider-routes.mjs", "utf8");
const client = readFileSync("src/desktop/renderer/shared/runtime-user-memory-client.mjs", "utf8");
const consoleHtml = readFileSync("src/desktop/renderer/console.html", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const tests = readFileSync("tests/behavior/user-memory-profile.test.mjs", "utf8");
const clientTests = readFileSync("tests/behavior/runtime-user-memory-client.test.mjs", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-maturity-roadmap.md", "utf8");

for (const required of [
  "reviewHistory",
  "createMemoryReviewRecord",
  "undoMemoryReview",
  "approve_proposal",
  "reject_proposal",
  "delete_memory",
  "proposal_approval",
  "proposal_rejection",
  "memory_delete"
]) {
  assert.match(profile, new RegExp(required), `memory profile missing ${required}`);
}

assert.match(routes, /\/config\\\/user-memory\\\/reviews\\\/\(\[\^\/\]\+\)\\\/undo/u,
  "HTTP routes must expose memory review undo");
assert.match(routes, /reviewHistory:\s*incoming\.reviewHistory\s*\?\?\s*current\.reviewHistory/u,
  "saving editable memory must preserve review history");
assert.match(client, /undoReview/u, "renderer memory client must expose undoReview");
assert.match(consoleHtml, /userMemoryReviewList/u, "Console settings must include review history list");
assert.match(consoleJs, /data-memory-review-undo/u, "Console must wire review undo buttons");
assert.match(tests, /can undo approval, rejection, and deletion/u,
  "behavior tests must cover memory review undo flows");
assert.match(clientTests, /delete, and undo mutations/u,
  "renderer client tests must cover undo mutation");

const proposal = createMemoryProposal({ text: "Prefer explicit checkpoints." });
const approved = approveMemoryProposal({ proposals: [proposal] }, proposal.proposalId);
assert.equal(approved.reviewHistory[0].action, "approve_proposal");
const approvalUndone = undoMemoryReview(approved, approved.reviewHistory[0].reviewId);
assert.equal(approvalUndone.proposals[0].status, "pending");
assert.equal(approvalUndone.approvedMemories.length, 0);
const rejected = rejectMemoryProposal(approvalUndone, proposal.proposalId);
const rejectionUndone = undoMemoryReview(rejected, rejected.reviewHistory[0].reviewId);
assert.equal(rejectionUndone.proposals[0].status, "pending");
const reapproved = approveMemoryProposal(rejectionUndone, proposal.proposalId);
const deleted = deleteApprovedMemory(reapproved, reapproved.approvedMemories[0].id);
const deleteUndone = undoMemoryReview(deleted, deleted.reviewHistory[0].reviewId);
assert.equal(deleteUndone.approvedMemories.length, 1);

assert.match(roadmap, /MR-001 Memory review history and undo/u,
  "maturity roadmap must track MR-001");
const command = "node scripts/verify-memory-review-history.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include memory review verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include memory review verifier");

console.log("[verify-memory-review-history] memory review history contract OK");
