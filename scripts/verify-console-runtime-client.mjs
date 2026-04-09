import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { createConsoleRuntimeClient } from "../src/desktop/console/runtime-client.mjs";
import { createDesktopRuntimeHost } from "../src/desktop/tray/runtime-host.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-console-runtime-client", crypto.randomUUID());

const runtime = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: "\\\\.\\pipe\\uca-helper-console-runtime-client"
});

const listening = await runtime.start();

try {
  runtime.runtime.store.appendPendingApproval({
    approval_id: "approval_console",
    created_at: "2026-04-08T12:00:00.000Z",
    expires_at: "2026-04-15T12:00:00.000Z",
    source_type: "agent_tool_call",
    source_id: "task_console",
    proposed_action: "action_tool",
    proposed_target: "notify",
    proposed_params: { title: "UCA" },
    preview_text: "Pending notify action",
    status: "pending",
    decided_at: null,
    decided_by: null,
    resulting_task_id: null,
    metadata: {}
  });

  runtime.runtime.store.insertSchedule({
    schedule_id: "schedule_console",
    name: "Morning Review",
    description: "Check inbox and summarize",
    enabled: true,
    created_at: "2026-04-08T08:00:00.000Z",
    updated_at: "2026-04-08T08:00:00.000Z",
    created_by: "user",
    trigger_type: "cron",
    trigger_config: { expression: "0 9 * * 1-5" },
    action_type: "context_capture",
    action_target: "browser",
    action_params: {},
    execution_mode: "unattended_safe",
    catchup_policy: "skip",
    max_runtime_seconds: 600,
    next_run_at: "2026-04-09T09:00:00.000Z",
    last_run_at: null,
    last_run_status: null,
    run_count: 0,
    failure_count: 0,
    consecutive_failure_count: 0
  });
  runtime.runtime.store.appendScheduleRun({
    run_id: "run_console",
    schedule_id: "schedule_console",
    task_id: null,
    approval_id: null,
    triggered_at: "2026-04-08T09:00:00.000Z",
    trigger_reason: "manual_test",
    status: "success",
    error_message: null,
    metadata: {}
  });
  runtime.runtime.store.appendAuditLog({
    audit_id: "audit_console",
    ts: "2026-04-08T09:05:00.000Z",
    task_id: null,
    event_subtype: "console.snapshot_loaded",
    payload: {}
  });
  runtime.runtime.platform.embeddingStore.add({
    id: "task_console",
    text: "Kimi CLI generated a report for a markdown file.",
    metadata: {
      summary: "Kimi report",
      created_at: "2026-04-08T09:10:00.000Z"
    }
  });

  const client = createConsoleRuntimeClient(listening.baseUrl);
  const snapshot = await client.loadWorkspaceSnapshot({
    historyQuery: "Kimi report",
    historyLimit: 3
  });

  assert.equal(snapshot.viewModels.console.codeCliEndpoint, "/ai/code-cli");
  assert.equal(snapshot.viewModels.approvals.count, 1);
  assert.equal(snapshot.viewModels.schedules.schedules.length, 1);
  assert.equal(snapshot.viewModels.schedules.historyCount, 1);
  assert.equal(snapshot.viewModels.audit.total >= 1, true);
  assert.equal(snapshot.viewModels.history.resultCount, 1);

  const host = createDesktopRuntimeHost({
    serviceBaseUrl: listening.baseUrl
  });
  const hostClient = host.createConsoleClient();
  const health = await hostClient.getHealth();
  assert.equal(health.ok, true);

  console.log("Console runtime client verification passed.");
} finally {
  await runtime.stop();
}
