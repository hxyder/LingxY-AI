#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const corpus = readFileSync("scripts/real-llm-test/corpus-function-audit-100.mjs", "utf8");
const runner = readFileSync("scripts/real-llm-test/run-corpus.mjs", "utf8");

assert.match(corpus, /google\.gmail\.draft_confirm_send/u,
  "email live-write corpus must accept Google connector workflow confirmation");
assert.match(corpus, /microsoft\.outlook\.draft_confirm_send/u,
  "email live-write corpus must accept Microsoft connector workflow confirmation");
assert.match(corpus, /google\.calendar\.create_confirm/u,
  "calendar live-write corpus must accept Google connector workflow confirmation");
assert.match(corpus, /microsoft\.calendar\.create_confirm/u,
  "calendar live-write corpus must accept Microsoft connector workflow confirmation");

assert.match(runner, /live_write_waiting_approval/u,
  "live-write grading must fail approve-path tasks that remain waiting for approval");
assert.match(runner, /live_write_not_success/u,
  "live-write grading must require approve-path writes to finish as success");
assert.match(runner, /live_write_reject_not_confirmed/u,
  "live-write grading must prove reject-path approvals were actually rejected");
assert.match(runner, /taskIsWaitingExternalDecision\(taskRecord\)/u,
  "live-write grading must inspect pending approval state from task records/events");
assert.match(runner, /if \(\["success", "failed", "cancelled"\]\.includes\(terminalStatus\)\) return false/u,
  "live-write pending detection must not treat historical approval waits as active after terminal success");
assert.match(runner, /function auditSafeCaseId/u,
  "live-write audit markers must use a provider-safe case id");
assert.ok(runner.includes('replace(/[^a-z0-9-]/gi, "_")'),
  "live-write audit marker ids must avoid punctuation that models/providers may split in calendar titles");
assert.match(runner, /function approvalMarkerCandidates/u,
  "live-write approval safety must support marker candidate matching");
assert.match(runner, /maybeDriveLiveApprovalFromTaskRecord/u,
  "live-write approval auto-driver must resolve approvals visible in the task event stream");
assert.match(runner, /pendingApprovalsFromTaskRecord/u,
  "live-write approval auto-driver must inspect task pendingApproval payloads");

const command = "node scripts/verify-live-write-grading.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include live-write grading verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include live-write grading verifier");

console.log("[verify-live-write-grading] real-LLM live-write grading contract OK");
