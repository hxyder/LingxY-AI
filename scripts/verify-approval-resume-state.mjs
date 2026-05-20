#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  attachApprovalResumeMetadata,
  resolveApprovalResumeMetadata
} from "../src/service/scheduler/approval-resume-state.mjs";
import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";

const stateModule = readFileSync("src/service/scheduler/approval-resume-state.mjs", "utf8");
const graphResume = readFileSync("src/service/scheduler/approval-graph-resume.mjs", "utf8");
const approvals = readFileSync("src/service/scheduler/pending-approvals.mjs", "utf8");
const runtimeServices = readFileSync("src/service/core/task-runtime/runtime-services.mjs", "utf8");
const workflowSubmission = readFileSync("src/service/capabilities/connectors/core/workflow-submission.mjs", "utf8");
const executeAction = readFileSync("src/service/scheduler/execute-action.mjs", "utf8");
const schedulerEngine = readFileSync("src/service/scheduler/engine.mjs", "utf8");
const behavior = readFileSync("tests/behavior/approval-resume-state.test.mjs", "utf8");

assert.match(stateModule, /kind:\s*"hitl_approval"/u, "resume state must identify HITL approval interrupts");
assert.match(stateModule, /state:\s*"interrupted"/u, "resume state must start interrupted");
assert.match(stateModule, /state:\s*normalizedDecision === "approved" \? "resumed" : "rejected"/u, "resume state must resolve to resumed/rejected");
assert.match(stateModule, /resume_token/u, "resume state must expose a stable token");

assert.match(approvals, /attachApprovalResumeMetadata/u, "pending approvals must attach resume metadata at create time");
assert.match(approvals, /resolveApprovalResumeMetadata/u, "pending approvals must resolve resume metadata on decisions");
assert.match(approvals, /approval_resume:\s*approval\.metadata\?\.approval_resume/u, "terminal bridge events must carry resume metadata");
assert.match(approvals, /sameTaskResume[\s\S]{0,120}executionResult\?\.resumed_same_task === true/u,
  "generic and connector same-task approval resumes must skip compatibility bridge terminalization");
assert.match(runtimeServices, /resumeAgentToolApprovalInOriginalTask/u,
  "generic agent tool approvals must route through same-task graph resume");
assert.match(graphResume, /export async function resumeAgentToolApprovalInOriginalTask/u,
  "same-task graph resume service must be exported");
assert.match(graphResume, /eventType,\s*payload/u,
  "same-task graph resume must append task events through a single event helper");
assert.match(graphResume, /"approval_resume_started"/u,
  "same-task graph resume must emit approval_resume_started");
assert.match(graphResume, /same_task_resume:\s*true/u,
  "same-task graph resume events must be distinguishable from bridge compatibility events");
assert.match(graphResume, /"tool_call_completed"/u,
  "same-task graph resume must complete the original tool card");
assert.match(graphResume, /"success"/u,
  "same-task graph resume must terminalize successful original tasks");
assert.match(workflowSubmission, /export async function resumeConnectorWorkflowTask/u,
  "connector workflow approvals must have a same-task resume path");
assert.match(workflowSubmission, /approval_resume_started/u,
  "same-task connector workflow resume must emit an explicit resume event");
assert.match(executeAction, /resumeTaskId/u,
  "approval execution must be able to route connector workflows back to the suspended task");
assert.match(schedulerEngine, /resumeTaskId:\s*approval\.proposed_action === "connector_workflow"/u,
  "scheduler approval bridge must pass the suspended task id into connector workflow resume");

const attached = attachApprovalResumeMetadata({
  task_id: "task_abc",
  tool_id: "write_file"
}, {
  approvalId: "appr_abc",
  createdAt: "2026-05-08T00:00:00.000Z"
});
const resolved = resolveApprovalResumeMetadata(attached, {
  decision: "approved",
  actor: "test",
  resultingTaskId: "task_new",
  decidedAt: "2026-05-08T00:01:00.000Z"
});
assert.equal(resolved.approval_resume.resume_token, "approval:appr_abc");
assert.equal(resolved.approval_resume.state, "resumed");
assert.equal(resolved.approval_resume.resulting_task_id, "task_new");

assert.match(behavior, /terminal\.payload\.approval_resume/u, "behavior tests must verify terminal event resume metadata");
assert.match(behavior, /generic agent tool approval resumes and terminalizes the original task without bridge events/u,
  "behavior tests must cover generic same-task approval resume");
assert.match(behavior, /bridged_from_approval === true\), false/u,
  "behavior tests must prove same-task resume does not use compatibility bridge events");

const command = "node scripts/verify-approval-resume-state.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include approval resume verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include approval resume verifier");

console.log("[verify-approval-resume-state] FW-020 approval resume state contract OK");
