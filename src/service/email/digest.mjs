import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listEmailAccounts, resolveAccountCredentials } from "./accounts.mjs";
import { createImapClient } from "./imap-client.mjs";
import { summarizeEmail } from "./summarizer.mjs";
import { extractEmailIntent } from "./intent-extractor.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { requireFeature } from "../core/feature-flags.mjs";
import { listUserAccounts } from "../connectors/core/account-registry.mjs";
import { listGoogleEmails } from "../connectors/google/google-connector.mjs";
import { listMicrosoftEmails } from "../connectors/microsoft/microsoft-connector.mjs";

function resolveStatePath(runtime) {
  const baseDir = runtime?.paths?.dataDir
    ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "UCA") : path.join(os.homedir(), ".uca-runtime"));
  return path.join(baseDir, "email-digest-state.json");
}

async function loadDigestState(runtime) {
  try {
    const raw = await readFile(resolveStatePath(runtime), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveDigestState(runtime, state) {
  const filePath = resolveStatePath(runtime);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// Local-date key for the dedupe guard. Using toISOString().slice(0, 10)
// was the original bug — ISO strings are UTC, but the digest window is
// evaluated in LOCAL time. In UTC+8 (China) the 06:00 local fire maps
// to 22:00 UTC of the previous day, so the state file stored "yesterday"
// and any re-fire between UTC midnight and local noon saw a different
// todayKey → guard miss → digest fired a second time.
function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Belt-and-suspenders: refuse to fire more than once every MIN_FIRE_MS
// within a single runtime, independent of the state file. If the state
// file ever ends up unreadable or wiped mid-session, this in-memory
// throttle still blocks an immediate repeat.
const MIN_FIRE_MS = 4 * 60 * 60 * 1000;
const _digestLastFiredAt = new WeakMap();

function parseTimeWindow(config) {
  const windowStart = config?.windowStart ?? "06:00";
  const windowEnd = config?.windowEnd ?? "12:00";
  return { windowStart, windowEnd };
}

function withinWindow(now, windowStart, windowEnd) {
  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const start = new Date(now);
  start.setHours(sh, sm || 0, 0, 0);
  const end = new Date(now);
  end.setHours(eh, em || 0, 0, 0);
  return now >= start && now <= end;
}

function buildYesterdayRange(now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return { start: yesterday, end: today };
}

function buildRecentFallbackRange(now, days = 7) {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(end.getDate() - days);
  return { start, end };
}

function messageInRange(message, range) {
  const receivedAt = new Date(
    message.receivedAt
    ?? message.received_at
    ?? message.received
    ?? 0
  );
  return receivedAt >= range.start && receivedAt < range.end;
}

function normalizeDigestMessage(message = {}) {
  return {
    id: message.id ?? message.messageId ?? null,
    threadId: message.threadId ?? message.thread_id ?? message.id ?? message.messageId ?? null,
    from: message.from ?? message.fromEmail ?? "",
    subject: message.subject ?? "(no subject)",
    bodyText: message.bodyText ?? message.body_text ?? message.preview ?? "",
    receivedAt: message.receivedAt ?? message.received_at ?? message.received ?? new Date().toISOString()
  };
}

async function collectMessagesForImapAccount(runtime, account, range) {
  const credentials = await resolveAccountCredentials(runtime, account);
  if (!credentials) return [];
  try {
    const client = createImapClient({
      account,
      credentials,
      state: { seenByAccount: new Map() }
    });
    const messages = await client.listRecent(50);
    return messages
      .map(normalizeDigestMessage)
      .filter((message) => messageInRange(message, range));
  } catch {
    return [];
  }
}

async function collectMessagesForConnectedAccount(runtime, account, range) {
  try {
    let result = null;
    if (account.provider === "google" && account.capabilities?.emailRead) {
      result = await listGoogleEmails(runtime, account, { limit: 50 });
    } else if (account.provider === "microsoft" && account.capabilities?.emailRead) {
      result = await listMicrosoftEmails(runtime, account, { limit: 50 });
    }
    if (result?.status !== "success") return [];
    return (result.data?.emails ?? [])
      .map(normalizeDigestMessage)
      .filter((message) => messageInRange(message, range));
  } catch {
    return [];
  }
}

function buildDigestMarkdown({ totals, buckets, perAccount, title = "昨日邮件汇总", summaryLead = null }) {
  const lines = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(summaryLead ?? `总计 ${totals.total} 封邮件，其中 ${totals.actionRequired} 封需要回复。`);
  lines.push("");
  for (const [label, items] of Object.entries(buckets)) {
    lines.push(`## ${label}`);
    if (items.length === 0) {
      lines.push("- 无");
    } else {
      for (const item of items.slice(0, 5)) {
        lines.push(`- ${item.subject}（${item.from}）`);
      }
    }
    lines.push("");
  }
  lines.push("## 账户汇总");
  for (const entry of perAccount) {
    lines.push(`- ${entry.name}: ${entry.count} 封（需回复 ${entry.actionRequired}）`);
  }
  lines.push("");
  return lines.join("\n");
}

async function sendNotification(runtime, payload) {
  const notifyTool = runtime.actionToolRegistry?.get?.("notify");
  if (!notifyTool) return null;
  return notifyTool.execute(payload, { runtime });
}

// In-memory lock so two concurrent /email/digest/check calls (manual
// "Test" button + startup auto-check landing at the same millisecond)
// don't both pass the dedupe guard. Keyed by runtime instance.
const _digestInFlight = new WeakMap();

export async function maybeRunMorningDigest({
  runtime,
  now = new Date(),
  force = false,
  dependencies = {}
} = {}) {
  const {
    getEmailAccounts = (currentRuntime) => listEmailAccounts(currentRuntime).filter((account) => account.enabled),
    getConnectorAccounts = (currentRuntime) => listUserAccounts(currentRuntime).filter((account) =>
      account.tokenStatus === "active" && account.capabilities?.emailRead
    ),
    collectConfiguredAccountMessages = collectMessagesForImapAccount,
    collectConnectedAccountMessages = collectMessagesForConnectedAccount
  } = dependencies;
  const config = runtime.configStore?.load?.() ?? {};
  const featureGate = requireFeature("morning_digest", runtime.configStore);
  if (!featureGate.ok) {
    return { ok: false, reason: "feature_disabled", gate: featureGate };
  }
  const digestConfig = config.email?.digest ?? {};
  if (!force && digestConfig.enabled === false) {
    return { ok: false, reason: "disabled" };
  }

  const { windowStart, windowEnd } = parseTimeWindow(digestConfig);
  if (!force && !withinWindow(now, windowStart, windowEnd)) {
    return { ok: false, reason: "outside_window", windowStart, windowEnd };
  }

  if (!force && digestConfig.skipWeekends && isWeekend(now)) {
    return { ok: false, reason: "weekend" };
  }

  // In-memory throttle — independent of the state file.
  const lastFiredAt = _digestLastFiredAt.get(runtime);
  if (!force && lastFiredAt && now.getTime() - lastFiredAt < MIN_FIRE_MS) {
    const minutesAgo = Math.round((now.getTime() - lastFiredAt) / 60_000);
    return { ok: false, reason: "throttled_in_memory", minutesAgo };
  }

  // Serialize concurrent callers — second caller waits for the first to
  // finish, then re-reads the state file and bails on "already_sent".
  const existing = _digestInFlight.get(runtime);
  if (existing) {
    try { await existing; } catch { /* first caller's error is its own problem */ }
  }

  const work = (async () => {
    const state = await loadDigestState(runtime);
    const todayKey = localDateKey(now);
    if (!force && state.lastDigestDate === todayKey) {
      return { ok: false, reason: "already_sent", lastDigestDate: state.lastDigestDate };
    }

    const emailAccounts = getEmailAccounts(runtime);
    const connectorAccounts = getConnectorAccounts(runtime);
    if (emailAccounts.length === 0 && connectorAccounts.length === 0) {
      return { ok: false, reason: "no_accounts" };
    }

    // Mark today eagerly — BEFORE any outbound work. This is the key bug
    // fix: previously we only wrote the state AFTER writeFile + notify
    // succeeded, so a single failure (notification tool missing, disk
    // error, summarizer throw) would re-fire the digest on every app
    // restart within the morning window. Now a failed run still blocks
    // retries for the day; the user can manually re-trigger via the
    // "Test digest now" button if they really want another attempt.
    state.lastDigestDate = todayKey;
    await saveDigestState(runtime, state);
    _digestLastFiredAt.set(runtime, now.getTime());

    const primaryRange = buildYesterdayRange(now);
    const fallbackRange = force ? buildRecentFallbackRange(now, 7) : null;
    const allMessages = [];
    const perAccount = [];
    for (const account of emailAccounts) {
      const messages = await collectConfiguredAccountMessages(runtime, account, primaryRange);
      allMessages.push(...messages);
      perAccount.push({
        id: account.id,
        name: account.displayName ?? account.email ?? account.id,
        count: messages.length,
        actionRequired: 0
      });
    }
    for (const account of connectorAccounts) {
      const messages = await collectConnectedAccountMessages(runtime, account, primaryRange);
      allMessages.push(...messages);
      perAccount.push({
        id: account.id,
        name: account.displayName ?? account.email ?? account.id,
        count: messages.length,
        actionRequired: 0
      });
    }

    let digestTitle = "昨日邮件汇总";
    let summaryLead = null;
    if (allMessages.length === 0 && fallbackRange) {
      for (const entry of perAccount) {
        entry.count = 0;
        entry.actionRequired = 0;
      }
      for (const account of emailAccounts) {
        const messages = await collectConfiguredAccountMessages(runtime, account, fallbackRange);
        allMessages.push(...messages);
        const target = perAccount.find((entry) => entry.id === account.id);
        if (target) target.count = messages.length;
      }
      for (const account of connectorAccounts) {
        const messages = await collectConnectedAccountMessages(runtime, account, fallbackRange);
        allMessages.push(...messages);
        const target = perAccount.find((entry) => entry.id === account.id);
        if (target) target.count = messages.length;
      }
      if (allMessages.length > 0) {
        digestTitle = "最近邮件摘要（手动测试）";
        summaryLead = `最近 7 天内共找到 ${allMessages.length} 封邮件，其中稍后需处理的会被归到“需要回复”。`;
      }
    }

    if (allMessages.length === 0) {
      return { ok: true, reason: "no_messages" };
    }

    const buckets = {
      "需要回复": [],
      "提及我": [],
      "通知": []
    };

    for (const message of allMessages) {
      const summary = await summarizeEmail({ runtime, message });
      const intent = extractEmailIntent(summary);
      if (intent.actionRequired) {
        buckets["需要回复"].push(message);
      } else if (/@|提及/.test(summary)) {
        buckets["提及我"].push(message);
      } else {
        buckets["通知"].push(message);
      }
    }

    const totals = {
      total: allMessages.length,
      actionRequired: buckets["需要回复"].length
    };

    for (const entry of perAccount) {
      entry.actionRequired = allMessages.filter((msg) =>
        msg.threadId && buckets["需要回复"].some((item) => item.threadId === msg.threadId)
      ).length;
    }

    const digestMd = buildDigestMarkdown({ totals, buckets, perAccount, title: digestTitle, summaryLead });
    const outputDir = runtime.paths?.outputsDir ?? path.join(os.homedir(), "Desktop", "UCA");
    await mkdir(outputDir, { recursive: true });
    const digestPath = path.join(outputDir, `email-digest-${todayKey}.md`);
    await writeFile(digestPath, digestMd, "utf8");

    await sendNotification(runtime, {
      title: force ? "邮件摘要（手动测试）" : "早晨邮件汇总",
      body: force
        ? `找到 ${totals.total} 封近期邮件，需回复 ${totals.actionRequired} 封。点击查看详情。`
        : `昨日 ${totals.total} 封邮件，需回复 ${totals.actionRequired} 封。点击查看详情。`,
      handoff: {
        file_paths: [digestPath],
        source_app: "uca.email",
        capture_mode: "email_digest",
        userCommand: "请查看昨日邮件汇总"
      }
    });

    appendAuditLog(runtime, "email.digest_sent", {
      total: totals.total,
      action_required: totals.actionRequired,
      digest_path: digestPath
    });

    return { ok: true, digestPath, sent: true, forced: force };
  })();

  _digestInFlight.set(runtime, work);
  try {
    return await work;
  } finally {
    if (_digestInFlight.get(runtime) === work) _digestInFlight.delete(runtime);
  }
}
