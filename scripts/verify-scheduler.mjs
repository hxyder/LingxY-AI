import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServiceBootstrap } from "../src/service/core/service-bootstrap.mjs";
import { createSqliteStore } from "../src/service/core/store/sqlite-store.mjs";
import { buildPendingApprovalsViewModel } from "../src/desktop/console/pending-approvals/view-model.mjs";
import { buildSchedulesViewModel } from "../src/desktop/console/schedules/view-model.mjs";
import { parseNaturalLanguageTrigger } from "../src/service/scheduler/nl_to_cron.mjs";

// Keep this verifier hermetic. The scheduled "AI work" smoke path only
// needs to prove that scheduler dispatch creates and completes a task; it
// must not depend on the user's real provider config/API quota.
process.env.UCA_CONFIG_PATH = path.join(
  os.tmpdir(),
  `uca-scheduler-runtime-${process.pid}-${Date.now()}.json`
);
for (const key of [
  "ANTHROPIC_API_KEY",
  "UCA_ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "UCA_OPENAI_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "UCA_KIMI_API_KEY",
  "UCA_OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "UCA_OLLAMA_MODEL"
]) {
  delete process.env[key];
}

const service = createServiceBootstrap();
const { runtime } = service;

assert.ok(runtime.scheduler);

const parsed = parseNaturalLanguageTrigger("每天 9 点提醒我喝水");
assert.equal(parsed.ok, true);
assert.equal(parsed.trigger.expression, "0 9 * * *");

const futureRunAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

const sqliteTempDir = await mkdtemp(path.join(os.tmpdir(), "uca-scheduler-"));
const sqliteStore = createSqliteStore({
  dbPath: path.join(sqliteTempDir, "scheduler.sqlite")
});
try {
  const sqliteService = createServiceBootstrap({
    storeAdapter: sqliteStore
  });
  const oneShotSchedule = sqliteService.runtime.scheduler.createSchedule({
    name: "One-shot reminder",
    trigger: {
      type: "interval",
      seconds: 60
    },
    action: {
      type: "action_tool",
      target: "notify",
      params: {
        title: "One-shot",
        body: "Run only once"
      }
    },
    metadata: {
      one_shot: true
    }
  });
  assert.equal(sqliteStore.getSchedule(oneShotSchedule.schedule_id).metadata.one_shot, true);

  const oneShotRun = await sqliteService.runtime.scheduler.dispatch(oneShotSchedule.schedule_id, "manual");
  assert.equal(oneShotRun.status, "success");
  const oneShotAfterRun = sqliteStore.getSchedule(oneShotSchedule.schedule_id);
  assert.equal(oneShotAfterRun.enabled, false);
  assert.equal(oneShotAfterRun.next_run_at, null);
  assert.equal(oneShotAfterRun.metadata.one_shot, true);

  const atSchedule = sqliteService.runtime.scheduler.createSchedule({
    name: "Exact reminder",
    trigger: {
      type: "at",
      run_at: futureRunAt
    },
    action: {
      type: "action_tool",
      target: "notify",
      params: {
        title: "At",
        body: "Run at exact time"
      }
    },
    metadata: {
      one_shot: true
    }
  });
  assert.equal(sqliteStore.getSchedule(atSchedule.schedule_id).next_run_at, futureRunAt);

  const nativeAtSchedule = sqliteService.runtime.scheduler.createSchedule({
    name: "Native at reminder",
    trigger: {
      type: "at",
      run_at: futureRunAt
    },
    action: {
      type: "action_tool",
      target: "notify",
      params: {
        title: "Native At",
        body: "Run once because trigger_type=at"
      }
    }
  });
  const nativeAtRun = await sqliteService.runtime.scheduler.dispatch(nativeAtSchedule.schedule_id, "manual");
  assert.equal(nativeAtRun.status, "success");
  const nativeAtAfterRun = sqliteStore.getSchedule(nativeAtSchedule.schedule_id);
  assert.equal(nativeAtAfterRun.enabled, false, "native trigger_type=at must close after one run");
  assert.equal(nativeAtAfterRun.next_run_at, null);

  const pausedRecurring = sqliteService.runtime.scheduler.createSchedule({
    name: "Paused recurring",
    trigger: {
      type: "interval",
      seconds: 60
    },
    action: {
      type: "action_tool",
      target: "notify",
      params: {
        title: "Paused",
        body: "Manual run should still work"
      }
    }
  });
  sqliteService.runtime.scheduler.pauseSchedule(pausedRecurring.schedule_id, false);
  const pausedManualRun = await sqliteService.runtime.scheduler.dispatch(pausedRecurring.schedule_id, "manual");
  assert.equal(pausedManualRun.status, "success", "manual Run now should work for paused schedules");
  assert.equal(sqliteStore.getSchedule(pausedRecurring.schedule_id).enabled, false);
} finally {
  sqliteStore.close();
  await rm(sqliteTempDir, { recursive: true, force: true });
}

const createResult = await runtime.actionToolRegistry.call("create_scheduled_task", {
  name: "Daily Reminder",
  trigger: {
    natural_language: "每天 9 点提醒我喝水",
    timezone: "Asia/Shanghai"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Drink Water",
      body: "Scheduled reminder"
    }
  },
  execution_mode: "unattended_safe"
}, {
  runtime
});
assert.equal(createResult.success, true);
const scheduleId = createResult.metadata.schedule_id;
assert.ok(runtime.store.getSchedule(scheduleId));

const emailScheduleResult = await runtime.actionToolRegistry.call("create_scheduled_task", {
  name: "Daily Email",
  trigger: {
    natural_language: "每天 9 点发送邮件",
    timezone: "Asia/Shanghai"
  },
  action: {
    type: "task",
    target: "daily email",
    params: {
      userCommand: "整理日报并发送邮件到 ops@example.com"
    }
  },
  execution_mode: "unattended_safe"
}, {
  runtime
});
const emailSchedule = runtime.store.getSchedule(emailScheduleResult.metadata.schedule_id);
assert.equal(
  emailSchedule.metadata?.side_effect_contract?.groups?.email_send?.slots?.to?.values?.[0],
  "ops@example.com"
);

const listResult = await runtime.actionToolRegistry.call("list_scheduled_tasks", {
  includeDisabled: true
}, {
  runtime
});
assert.equal(listResult.metadata.schedules.length >= 1, true);

const dispatchResult = await runtime.scheduler.dispatch(scheduleId, "manual");
assert.equal(dispatchResult.status, "success");
assert.equal(runtime.store.listScheduleRuns(scheduleId).length, 1);

const aiWorkSchedule = runtime.scheduler.createSchedule({
  name: "Scheduled AI work",
  trigger: {
    type: "at",
    run_at: futureRunAt
  },
  action: {
    type: "task",
    target: "context_task",
    params: {
      userCommand: "总结今天的待办",
      contextText: "Scheduled AI work smoke test"
    }
  },
  executionMode: "unattended_safe",
  metadata: {
    one_shot: true
  }
});
const aiWorkRun = await runtime.scheduler.dispatch(aiWorkSchedule.schedule_id, "manual");
assert.equal(aiWorkRun.status, "success");
assert.equal(runtime.store.getSchedule(aiWorkSchedule.schedule_id).enabled, false);
assert.equal(Boolean(aiWorkRun.task?.task_id), true);

const pauseResult = await runtime.actionToolRegistry.call("pause_scheduled_task", {
  schedule_id: scheduleId
}, {
  runtime
});
assert.equal(pauseResult.success, true);
assert.equal(runtime.store.getSchedule(scheduleId).enabled, false);

await runtime.actionToolRegistry.call("pause_scheduled_task", {
  schedule_id: scheduleId,
  enabled: true
}, {
  runtime
});
assert.equal(runtime.store.getSchedule(scheduleId).enabled, true);

const fileWatchSchedule = runtime.scheduler.createSchedule({
  name: "Inbox Watch",
  trigger: {
    type: "file_watch",
    path: "C:/Users/der/Desktop/inbox",
    events: ["add"],
    glob: "*.pdf"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "File Arrived",
      body: "paper.pdf"
    }
  }
});
const fileWatchResult = await runtime.scheduler.handleFileWatchEvent(fileWatchSchedule.schedule_id, {
  path: "C:/Users/der/Desktop/inbox/paper.pdf",
  event: "add"
});
assert.equal(fileWatchResult.status, "success");

const approvalSchedule = runtime.scheduler.createSchedule({
  name: "Send Daily Email",
  trigger: {
    type: "interval",
    seconds: 300
  },
  action: {
    type: "action_tool",
    target: "send_email_smtp",
    params: {
      to: ["ops@example.com"],
      subject: "Daily Report",
      body: "Queued schedule"
    }
  },
  executionMode: "approval_required"
});

const approvalRun1 = await runtime.scheduler.dispatch(approvalSchedule.schedule_id, "manual");
assert.equal(approvalRun1.status, "pending_approval");
const firstApprovalId = approvalRun1.approval.approval_id;
assert.equal(runtime.store.getPendingApproval(firstApprovalId).status, "pending");

const approvalRun2 = await runtime.scheduler.dispatch(approvalSchedule.schedule_id, "manual");
assert.equal(approvalRun2.status, "pending_approval");
assert.equal(runtime.store.getPendingApproval(firstApprovalId).status, "superseded");

const approvalResult = await runtime.scheduler.approvePendingApproval(approvalRun2.approval.approval_id, {
  actor: "tester"
});
assert.equal(approvalResult.approval.status, "approved");
assert.equal(Boolean(approvalResult.approval.resulting_task_id), true);
assert.equal(approvalResult.executionResult.task.status, "success");

const expiredApproval = runtime.pendingApprovals.create({
  sourceType: "schedule_trigger",
  sourceId: "sched_expired",
  proposedAction: "action_tool",
  proposedTarget: "notify",
  proposedParams: {
    title: "Expired",
    body: "Expired"
  },
  previewText: "Expired approval",
  createdAt: "2026-03-01T00:00:00.000Z"
});
const expired = runtime.scheduler.sweepExpiredApprovals({
  now: "2026-04-08T00:00:00.000Z"
});
assert.equal(expired.some((entry) => entry.approval_id === expiredApproval.approval_id), true);
assert.equal(runtime.store.getPendingApproval(expiredApproval.approval_id).status, "expired");

const misfireSchedule = runtime.scheduler.createSchedule({
  name: "Misfire Catchup",
  trigger: {
    type: "interval",
    seconds: 60
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Catchup",
      body: "Recovered run"
    }
  },
  catchupPolicy: "run_once"
});
const misfireRecord = runtime.store.getSchedule(misfireSchedule.schedule_id);
misfireRecord.last_run_at = "2026-04-08T08:00:00.000Z";
misfireRecord.next_run_at = "2026-04-08T08:01:00.000Z";
runtime.store.updateSchedule(misfireRecord.schedule_id, misfireRecord);
const recovered = await runtime.scheduler.recoverSchedules({
  now: "2026-04-08T08:05:00.000Z"
});
assert.equal(recovered.length >= 1, true);

const legacyExpiredAt = runtime.scheduler.createSchedule({
  name: "Legacy expired at",
  trigger: {
    type: "at",
    run_at: "2026-04-08T08:00:00.000Z"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Expired",
      body: "Should be normalized disabled"
    }
  },
  enabled: true
});
assert.equal(legacyExpiredAt.enabled, false, "new expired at schedules should not stay enabled");

const legacyTerminalAt = runtime.scheduler.createSchedule({
  name: "Legacy terminal at",
  trigger: {
    type: "at",
    run_at: "2026-04-08T09:00:00.000Z"
  },
  action: {
    type: "action_tool",
    target: "notify",
    params: {
      title: "Legacy",
      body: "Legacy row"
    }
  }
});
const legacyTerminalRecord = runtime.store.getSchedule(legacyTerminalAt.schedule_id);
legacyTerminalRecord.enabled = true;
legacyTerminalRecord.next_run_at = null;
legacyTerminalRecord.last_run_at = "2026-04-08T09:00:00.000Z";
legacyTerminalRecord.run_count = 1;
runtime.store.updateSchedule(legacyTerminalRecord.schedule_id, legacyTerminalRecord);
await runtime.scheduler.recoverSchedules({
  now: "2026-04-08T10:00:00.000Z"
});
assert.equal(runtime.store.getSchedule(legacyTerminalAt.schedule_id).enabled, false);

const failingSchedule = runtime.scheduler.createSchedule({
  name: "Broken Schedule",
  trigger: {
    type: "interval",
    seconds: 60
  },
  action: {
    type: "action_tool",
    target: "non_existent_tool",
    params: {}
  }
});
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
await runtime.scheduler.dispatch(failingSchedule.schedule_id, "manual");
assert.equal(runtime.store.getSchedule(failingSchedule.schedule_id).enabled, false);

const schedulesVm = buildSchedulesViewModel(runtime.store.listSchedules(), runtime.store.listScheduleRuns());
assert.equal(schedulesVm.actions.includes("run_now"), true);
const pendingVm = buildPendingApprovalsViewModel(runtime.store.listPendingApprovals());
assert.equal(pendingVm.actions.includes("approve"), true);

const deleteResult = await runtime.actionToolRegistry.call("delete_scheduled_task", {
  schedule_id: scheduleId
}, {
  runtime
});
assert.equal(deleteResult.success, true);
assert.equal(runtime.store.getSchedule(scheduleId), null);

/* ────────────────────────────────────────────────────────────────────────── */
/* UCA-046: computeDefaultLeadTime + category/color + reminder watcher       */
/* ────────────────────────────────────────────────────────────────────────── */

import {
  computeDefaultLeadTime,
  SCHEDULE_CATEGORIES,
  CATEGORY_COLOR_MAP,
  resolveScheduleColor
} from "../src/service/scheduler/store.mjs";
import { createReminderWatcher } from "../src/service/scheduler/reminder-watcher.mjs";

// computeDefaultLeadTime rules per §4
const HOUR = 3600_000;
const DAY = 86400_000;
assert.equal(computeDefaultLeadTime(4 * HOUR), 1 * HOUR);      // ≤ 8h → 1h
assert.equal(computeDefaultLeadTime(20 * HOUR), 1 * HOUR);     // ≤ 1d → 1h
assert.equal(computeDefaultLeadTime(5 * DAY), 1 * DAY);        // ≤ 1w → 1d
assert.equal(computeDefaultLeadTime(20 * DAY), 3 * DAY);       // ≤ 1m → 3d
assert.equal(computeDefaultLeadTime(60 * DAY), 7 * DAY);       // > 1m → 1w
assert.equal(computeDefaultLeadTime(0), 0);                     // already past

// Category palette
assert.equal(SCHEDULE_CATEGORIES.length, 6);
assert.equal(CATEGORY_COLOR_MAP.email, "#ef4444");
assert.equal(resolveScheduleColor("work"), "#3b82f6");
assert.equal(resolveScheduleColor("nonexistent"), CATEGORY_COLOR_MAP.general);
assert.equal(resolveScheduleColor("work", "#custom"), "#custom");

// Schedule entity now carries UCA-046 fields
const categorizedSchedule = runtime.scheduler.createSchedule({
  name: "Morning standup",
  trigger: { type: "at", run_at: new Date(Date.now() + 3 * HOUR).toISOString() },
  action: { type: "action_tool", target: "notify", params: { title: "Standup", body: "Time" } },
  category: "work",
  userTodo: true,
  metadata: { one_shot: true }
});
assert.equal(categorizedSchedule.category, "work");
assert.equal(categorizedSchedule.color, "#3b82f6");
assert.equal(categorizedSchedule.user_todo, true);
assert.equal(categorizedSchedule.reminder_sent_at, null);
assert.equal(categorizedSchedule.completed_at, null);
// lead_time_ms defaults to null (use computeDefaultLeadTime at runtime)
assert.equal(categorizedSchedule.lead_time_ms, null);

// Reminder watcher — direct tick invocation
let notifiedBody = null;
let notifiedNavigate = null;
const testNotifyTool = {
  id: "notify",
  async execute(args) {
    notifiedBody = args.body;
    notifiedNavigate = args.navigate ?? null;
    return { success: true, observation: "ok" };
  }
};
const watcherRuntime = {
  store: runtime.store,
  actionToolRegistry: {
    get: (id) => id === "notify" ? testNotifyTool : null
  }
};

// Move the schedule's next_run_at into the lead-time window
const catSched = runtime.store.getSchedule(categorizedSchedule.schedule_id);
const nowMs = Date.now();
catSched.next_run_at = new Date(nowMs + 30 * 60_000).toISOString(); // 30 min from now
catSched.lead_time_ms = 1 * HOUR; // lead = 1h → 30 min < 1h → should remind
runtime.store.updateSchedule(catSched.schedule_id, catSched);

const watcher = createReminderWatcher({ runtime: watcherRuntime });
await watcher.tick();
assert.ok(notifiedBody, "reminder watcher should have fired a notification");
assert.match(notifiedBody, /待办/);   // userTodo → "你有一项待办"
assert.match(notifiedBody, /Morning standup/);
assert.equal(notifiedNavigate?.tabId, "schedules");
assert.equal(notifiedNavigate?.scheduleId, categorizedSchedule.schedule_id);

// After tick, reminder_sent_at should be stamped
const afterReminder = runtime.store.getSchedule(categorizedSchedule.schedule_id);
assert.ok(afterReminder.reminder_sent_at, "reminder_sent_at must be stamped after reminder fires");

// Second tick should NOT fire again (duplicate suppression)
notifiedBody = null;
await watcher.tick();
assert.equal(notifiedBody, null, "reminder watcher must not fire duplicate notifications");

// After dispatch, reminder_sent_at should reset
await runtime.scheduler.dispatch(categorizedSchedule.schedule_id, "manual");
const afterDispatch = runtime.store.getSchedule(categorizedSchedule.schedule_id);
assert.equal(afterDispatch.reminder_sent_at, null, "dispatch must reset reminder_sent_at for next cycle");

console.log("Scheduler, misfire, and pending approval verification passed.");
