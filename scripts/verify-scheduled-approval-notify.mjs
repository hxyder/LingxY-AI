// Phase A gap-fix verifier (UCA-181):
//
// When a scheduled task suspends on a side-effect obligation (email_send /
// calendar_create / file_upload), the user is typically NOT at the desktop.
// Without an approval-pending notify the pending_approval card sits silent
// until the user happens to open the app.
//
// This verifier replays the executeScheduledTask-like flow and asserts:
//   1. A notify call with kind="approval_pending" fires when the task
//      ends in waiting_external_decision.
//   2. The notify carries the approval_id + tool_id so the toast can
//      deep-link the user to the right card.
//   3. The legacy success notify still fires for tasks that completed
//      cleanly (no regression).
//   4. Tasks where the agent already called notify itself do NOT
//      double-fire (the same dedupe rule the success path uses).

import assert from "node:assert/strict";

function createNotifyCapturingRuntime({ taskStatus, subStatus, events }) {
  const taskId = "task_test_approval_notify";
  const task = {
    task_id: taskId,
    status: taskStatus,
    sub_status: subStatus,
    result_summary: "draft summary"
  };
  const calls = [];
  const runtime = {
    actionToolRegistry: {
      call: (toolId, args) => {
        if (toolId === "notify") calls.push(args);
        return Promise.resolve({ success: true });
      }
    },
    store: {
      getTaskEvents: () => events
    }
  };
  return { runtime, task, calls, taskId };
}

// We do NOT exercise submitContextTask in this verifier — that's the live
// test's job. This harness isolates the post-submission notify branch.
async function runScheduledNotifyHarness({ taskStatus, subStatus, events, command = "5 分钟后给我发美股汇总" }) {
  // Re-implement the notify-decision block from executeScheduledTask
  // verbatim. If the verifier breaks when execute-action.mjs changes,
  // the test must be updated alongside the implementation — that's the
  // explicit contract.
  const { runtime: r2, task: task2, calls: calls2 } = createNotifyCapturingRuntime({ taskStatus, subStatus, events });
  const sourceApp = "uca.scheduler";
  const captureMode = "event";
  const userCommand = command;
  const actionTarget = "morning_brief";
  const commandRequestsOwnNotification = /(\bnotify\b|通知|发邮件|send\s+email|account_send_email)/i.test(userCommand);

  if (true
      && sourceApp === "uca.scheduler"
      && captureMode === "event") {
    const events_ = r2.store?.getTaskEvents?.(task2.task_id) ?? [];
    const successEvent = [...events_].reverse().find((e) => e.event_type === "success");
    const agentAlreadyNotified = events_.some((e) => {
      if (e.event_type !== "tool_call_completed") return false;
      const payload = e.payload ?? {};
      const toolId = payload.tool_id ?? payload.tool;
      return toolId === "notify" && payload.success === true;
    });
    const taskReallyRan = Boolean(successEvent) && task2.status !== "partial_success";

    const pendingApprovalEvent = task2.sub_status === "waiting_external_decision"
      ? [...events_].reverse().find((e) => e.event_type === "pending_approval_created")
      : null;

    if (pendingApprovalEvent && !agentAlreadyNotified) {
      const approvalId = pendingApprovalEvent.payload?.approval_id ?? "";
      const toolId = pendingApprovalEvent.payload?.tool_id ?? "";
      const previewEvent = [...events_].reverse().find(
        (e) => e.event_type === "partial_success" && typeof e.payload?.text === "string"
      );
      const previewText = previewEvent?.payload?.text
        ?? `定时任务"${actionTarget}"生成了待确认操作`;
      await r2.actionToolRegistry.call("notify", {
        kind: "approval_pending",
        title: `需要确认：${actionTarget}`,
        body: previewText,
        taskId: task2.task_id,
        approvalId,
        toolId,
        openWindow: "console",
        allowLongBody: true,
        autoHideMs: 0,
        dedupeKey: `scheduled-approval:${task2.task_id}:${approvalId || toolId}`
      });
    } else if (!commandRequestsOwnNotification && taskReallyRan && !agentAlreadyNotified) {
      const resultText = typeof successEvent?.payload?.text === "string"
        ? successEvent.payload.text
        : (task2.result_summary ?? `定时任务"${actionTarget}"已完成`);
      await r2.actionToolRegistry.call("notify", {
        kind: "success",
        title: `计划任务完成：${actionTarget}`,
        body: resultText,
        taskId: task2.task_id,
        openWindow: "overlay",
        allowLongBody: true,
        autoHideMs: 14000,
        dedupeKey: `scheduled-result:${task2.task_id}`
      });
    }
  }
  return { calls: calls2 };
}

// 1. waiting_external_decision → approval_pending notify fires.
{
  const events = [
    {
      event_type: "tool_call_completed",
      payload: { tool_id: "web_search_fetch", success: true }
    },
    {
      event_type: "pending_approval_created",
      payload: { approval_id: "appr_xyz", tool_id: "connector_workflow_run" }
    },
    {
      event_type: "partial_success",
      payload: { text: "邮件已经生成待确认操作，但还没有真正执行完成。" }
    }
  ];
  const { calls } = await runScheduledNotifyHarness({
    taskStatus: "partial_success",
    subStatus: "waiting_external_decision",
    events
  });
  assert.equal(calls.length, 1, "exactly one notify call should fire");
  assert.equal(calls[0].kind, "approval_pending");
  assert.equal(calls[0].approvalId, "appr_xyz");
  assert.equal(calls[0].toolId, "connector_workflow_run");
  assert.equal(calls[0].openWindow, "console");
  assert.equal(calls[0].autoHideMs, 0, "approval toast must be sticky (autoHideMs=0)");
  assert.match(calls[0].body, /待确认操作/);
  assert.match(calls[0].dedupeKey, /^scheduled-approval:/);
  console.log("PASS  waiting_external_decision → approval_pending notify (sticky, deep-linked)");
}

// 2. Email commands still notify when they are waiting for approval. The
// command-text suppression only applies to generic success toasts.
{
  const events = [
    {
      event_type: "pending_approval_created",
      payload: { approval_id: "appr_email", tool_id: "connector_workflow_run" }
    },
    {
      event_type: "partial_success",
      payload: { text: "邮件发送需要确认。" }
    }
  ];
  const { calls } = await runScheduledNotifyHarness({
    taskStatus: "partial_success",
    subStatus: "waiting_external_decision",
    events,
    command: "5 分钟后 send email market brief to han@example.com"
  });
  assert.equal(calls.length, 1, "email command must still surface pending approval");
  assert.equal(calls[0].kind, "approval_pending");
  assert.equal(calls[0].approvalId, "appr_email");
  console.log("PASS  email command waiting approval → approval_pending notify still fires");
}

// 3. Success path: notify still fires with kind=success.
{
  const events = [
    {
      event_type: "tool_call_completed",
      payload: { tool_id: "web_search_fetch", success: true }
    },
    {
      event_type: "success",
      payload: { text: "今天市场情况：纳斯达克下跌 1.2%，能源板块走强。" }
    }
  ];
  const { calls } = await runScheduledNotifyHarness({
    taskStatus: "success",
    subStatus: null,
    events
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "success");
  assert.equal(calls[0].openWindow, "overlay");
  assert.equal(calls[0].autoHideMs, 14000);
  console.log("PASS  success → legacy success notify still fires");
}

// 4. Agent already called notify itself (e.g. "提醒我喝水") → no double-fire.
{
  const events = [
    {
      event_type: "tool_call_completed",
      payload: { tool_id: "notify", success: true }
    },
    {
      event_type: "pending_approval_created",
      payload: { approval_id: "appr_y", tool_id: "connector_workflow_run" }
    }
  ];
  const { calls } = await runScheduledNotifyHarness({
    taskStatus: "partial_success",
    subStatus: "waiting_external_decision",
    events
  });
  assert.equal(calls.length, 0, "must not double-notify when the agent already used notify");
  console.log("PASS  agent-notified task: no double-notify on waiting_external_decision");
}

// 5. partial_success with NO pending_approval_created → no notify (legacy).
{
  const events = [
    {
      event_type: "tool_call_completed",
      payload: { tool_id: "web_search_fetch", success: false }
    }
  ];
  const { calls } = await runScheduledNotifyHarness({
    taskStatus: "partial_success",
    subStatus: null,
    events
  });
  assert.equal(calls.length, 0, "partial_success without approval pending must not fire either notify");
  console.log("PASS  partial_success without approval → no notify (no false alarm)");
}

console.log("\nok verify-scheduled-approval-notify");
