import { listEmailAccounts, resolveAccountCredentials, updateAccountSyncStamp } from "./accounts.mjs";
import { createImapClient } from "./imap-client.mjs";
import { createGraphClient } from "./graph-client.mjs";
import { summarizeEmail } from "./summarizer.mjs";
import { extractEmailIntent } from "./intent-extractor.mjs";
import { createThreadTracker } from "./thread-tracker.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";

const DEFAULT_POLL_INTERVAL_MS = 120000;
const MAX_MESSAGES_PER_ACCOUNT = 20;

function buildClient({ account, credentials, state }) {
  if (account.provider === "graph") {
    return createGraphClient({ account, credentials, state });
  }
  return createImapClient({ account, credentials, state });
}

function buildSchedulePayload({ message, intent }) {
  const runAt = intent.dueAt;
  return {
    name: intent.suggestedTitle ?? message.subject ?? "邮件任务",
    description: `来自 ${message.from} · ${message.subject}`,
    trigger: { type: "at", run_at: runAt },
    action: {
      type: "action_tool",
      target: "notify",
      params: {
        title: "邮件提醒",
        body: message.subject ?? "有新的邮件任务"
      }
    },
    executionMode: "interactive",
    metadata: {
      category: "email",
      color: "#ef4444",
      userTodo: true,
      leadTimeMs: 15 * 60 * 1000,
      emailId: message.id,
      threadId: message.threadId
    }
  };
}

async function sendNotification(runtime, title, body) {
  const notifyTool = runtime.actionToolRegistry?.get?.("notify");
  if (!notifyTool) return null;
  return notifyTool.execute({ title, body }, { runtime });
}

function messageIndicatesReply(message, accountEmail) {
  if (message.direction === "out") return true;
  if (!accountEmail) return false;
  return String(message.from ?? "").toLowerCase().includes(String(accountEmail).toLowerCase());
}

export function createEmailMonitor({ runtime, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const state = {
    running: false,
    timer: null,
    seenByAccount: new Map()
  };
  const threadTracker = createThreadTracker({ runtime });

  async function pollAccount(account) {
    const credentials = await resolveAccountCredentials(runtime, account);
    const client = buildClient({ account, credentials, state });
    const since = account.lastSyncAt ?? null;
    const messages = await client.listUnread(since, MAX_MESSAGES_PER_ACCOUNT);
    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    const results = [];
    for (const message of messages) {
      const summary = await summarizeEmail({ runtime, message });
      const intent = extractEmailIntent(summary);
      await sendNotification(runtime, "新邮件摘要", summary);

      appendAuditLog(runtime, "email.new_message", {
        account_id: account.id,
        email_id: message.id,
        thread_id: message.threadId,
        summary
      });

      if (intent.actionRequired && intent.dueAt && intent.confidence >= 0.6) {
        const schedule = runtime.scheduler.createSchedule(
          buildSchedulePayload({ message, intent }),
          { createdBy: "email" }
        );
        threadTracker.trackThread({
          threadId: message.threadId,
          scheduleId: schedule.schedule_id,
          accountId: account.id
        });
        await sendNotification(runtime, "已创建邮件任务", `已为 "${message.subject}" 生成提醒。`);
      }

      const tracked = threadTracker.getThread(message.threadId);
      if (tracked && !tracked.completed && messageIndicatesReply(message, account.email)) {
        threadTracker.markCompleted(message.threadId);
        const schedule = threadTracker.updateSchedule(tracked.scheduleId, {
          last_run_status: "completed",
          metadata: {
            ...(runtime.store.getSchedule(tracked.scheduleId)?.metadata ?? {}),
            completed_at: new Date().toISOString()
          }
        });
        await sendNotification(runtime, "邮件任务已完成", schedule?.name ?? "已完成");
      }

      await client.markSeen(message.id);
      results.push({ message, summary, intent });
    }

    await updateAccountSyncStamp(runtime, account.id, new Date().toISOString());
    return results;
  }

  async function pollAllAccounts() {
    const config = runtime.configStore?.load?.() ?? {};
    if (config.email?.enabled === false) {
      return [];
    }
    const accounts = listEmailAccounts(runtime).filter((account) => account.enabled);
    const results = [];
    for (const account of accounts) {
      try {
        results.push(...await pollAccount(account));
      } catch (error) {
        appendAuditLog(runtime, "email.poll_error", {
          account_id: account.id,
          message: error.message
        });
      }
    }
    return results;
  }

  function start() {
    if (state.running) return;
    state.running = true;
    state.timer = setInterval(() => {
      pollAllAccounts();
    }, pollIntervalMs);
    // Detach the timer from Node's event-loop keepalive: when the only
    // thing keeping the process alive is this polling interval (e.g. the
    // service-core verify scripts call createServiceBootstrap() and then
    // exit without running a real HTTP server), the Node process can
    // now exit cleanly. In persistent-runtime the HTTP server and
    // scheduler poll timer still hold the loop open, so the ref semantics
    // aren't needed there.
    if (typeof state.timer?.unref === "function") {
      state.timer.unref();
    }
  }

  function stop() {
    state.running = false;
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  return {
    start,
    stop,
    pollAllAccounts,
    threadTracker,
    state,
    status() {
      return {
        running: state.running,
        poll_interval_ms: pollIntervalMs,
        accounts: listEmailAccounts(runtime).length
      };
    }
  };
}
