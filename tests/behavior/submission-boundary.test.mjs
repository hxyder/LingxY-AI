import assert from "node:assert/strict";
import test from "node:test";

import { evaluateSubmissionBoundary } from "../../src/service/core/policy/submission-boundary.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";

function createRuntime() {
  return {
    store: createInMemoryStoreScaffold()
  };
}

test("submission boundary stamps and audits tasks without blocking execution", () => {
  const runtime = createRuntime();
  const { task } = submitTaskWithConversation({
    runtime,
    route: { intent: "act", executor: "tool_using", requires_confirmation: false, intent_tags: [] },
    contextPacket: {
      source_type: "clipboard",
      source_app: "uca.test",
      capture_mode: "manual",
      text: "Open the app"
    },
    userCommand: "Open the app",
    executionMode: "interactive",
    executorOverride: "tool_using",
    submissionKind: "action_tool"
  });

  assert.equal(task.status, "queued");
  assert.equal(task.submission_boundary.submission_kind, "action_tool");
  assert.equal(task.submission_boundary.decision, "audit_only");
  assert.equal(task.submission_boundary.blocking, false);
  assert.match(task.submission_boundary.reasons.join("\n"), /executor_override:tool_using/);

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.task_id, task.task_id);
  assert.equal(audit.payload.submission_kind, "action_tool");
  assert.equal(audit.payload.decision, "audit_only");
});

test("submission boundary pure evaluator records missing kind and forbidden policy groups", () => {
  const decision = evaluateSubmissionBoundary({
    submissionKind: "",
    executorOverride: null,
    contextPacket: {},
    task: {
      task_spec: {
        tool_policy: {
          policy_groups: {
            external_web_read: { mode: "forbidden", reason: "local only" }
          }
        }
      }
    }
  });

  assert.equal(decision.decision, "audit_only");
  assert.equal(decision.risk, "medium");
  assert.deepEqual(decision.required_guards, ["policy_group:external_web_read"]);
  assert.match(decision.reasons.join("\n"), /missing_submission_kind/);
  assert.match(decision.reasons.join("\n"), /forbidden_policy_group:external_web_read/);
});
