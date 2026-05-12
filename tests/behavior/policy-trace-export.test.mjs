import test from "node:test";
import assert from "node:assert/strict";

import { buildRuntimeDiagnosticBundle } from "../../src/service/core/diagnostic-bundle.mjs";
import { buildRuntimeExportBundle } from "../../src/service/core/export-bundle.mjs";
import { buildPolicyTraceExport } from "../../src/service/security/policy-trace-export.mjs";

function makeRuntime() {
  const auditLogs = [
    {
      ts: "2026-05-12T10:00:00.000Z",
      task_id: "task_policy",
      event_subtype: "tool.blocked_by_policy",
      payload: {
        tool_id: "web_search_fetch",
        reason: "privacy_sandbox_blocks_network_tool",
        apiKey: "sk-secret"
      }
    },
    {
      ts: "2026-05-12T10:01:00.000Z",
      task_id: "task_policy",
      event_subtype: "redaction.applied",
      payload: {
        source_type: "selection",
        redactions_applied: ["email"],
        refresh_token: "token-secret"
      }
    },
    {
      ts: "2026-05-12T10:02:00.000Z",
      task_id: "task_other",
      event_subtype: "non_policy_event",
      payload: { value: "ignored" }
    }
  ];
  const taskEvents = {
    task_policy: [
      {
        event_type: "pending_approval_created",
        ts: "2026-05-12T10:03:00.000Z",
        payload: {
          approval_id: "approval_1",
          tool_id: "send_email",
          access_token: "token-secret"
        }
      },
      {
        event_type: "progress",
        ts: "2026-05-12T10:04:00.000Z",
        payload: { message: "not policy" }
      }
    ]
  };
  return {
    paths: {},
    configStore: {
      load() {
        return { ai: { customProviders: [{ name: "test", apiKey: "sk-secret" }] } };
      }
    },
    store: {
      listAuditLogs() { return auditLogs; },
      listPendingApprovals() {
        return [{
          approval_id: "approval_1",
          task_id: "task_policy",
          tool_id: "send_email",
          risk: { risk_level: "high" },
          secret: "approval-secret"
        }];
      },
      listTasks() { return [{ task_id: "task_policy", status: "waiting_for_approval" }]; },
      getTaskEvents(taskId) { return taskEvents[taskId] ?? []; },
      listConversations() { return []; },
      getConversationMessages() { return []; },
      getArtifactsForTask() { return []; },
      listSchedules() { return []; },
      listScheduleRuns() { return []; },
      listConnectedAccounts() { return []; }
    }
  };
}

test("policy trace export summarizes blocked decisions, approvals, and policy task events", () => {
  const trace = buildPolicyTraceExport(makeRuntime());
  assert.equal(trace.summary.decisions, 2);
  assert.equal(trace.summary.blocked, 1);
  assert.equal(trace.summary.approvals, 1);
  assert.equal(trace.summary.task_policy_events, 1);
  assert.equal(trace.decisions[0].decision_type, "redaction.applied");
  assert.equal(trace.decisions[1].reason, "privacy_sandbox_blocks_network_tool");
  assert.equal(trace.approvals[0].risk_level, "high");
  assert.equal(trace.taskPolicyEvents[0].approval_id, "approval_1");
});

test("policy trace export redacts secrets from audit payloads and approvals", () => {
  const trace = buildPolicyTraceExport(makeRuntime());
  const text = JSON.stringify(trace);
  assert.ok(!text.includes("sk-secret"));
  assert.ok(!text.includes("token-secret"));
  assert.ok(!text.includes("approval-secret"));
  assert.ok(trace.manifest.excludes.includes("raw_tool_arguments"));
});

test("runtime export bundle includes redacted policy trace", () => {
  const bundle = buildRuntimeExportBundle(makeRuntime());
  assert.equal(bundle.policyTrace.summary.decisions, 2);
  assert.ok(bundle.manifest.includes.includes("policy_trace_redacted"));
  assert.ok(!JSON.stringify(bundle).includes("sk-secret"));
});

test("diagnostic bundle includes bounded policy trace", async () => {
  const bundle = await buildRuntimeDiagnosticBundle(makeRuntime(), {
    limits: { auditLogs: 1, taskEventTasks: 1, taskEventsPerTask: 1 }
  });
  assert.equal(bundle.policyTrace.decisions.length, 1);
  assert.equal(bundle.policyTrace.taskPolicyEvents.length, 1);
  assert.ok(bundle.manifest.includes.includes("policy_trace"));
});
