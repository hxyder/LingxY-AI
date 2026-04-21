import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listEmailAccounts } from "./accounts.mjs";
import { summarizeEmail } from "./summarizer.mjs";
import { extractEmailIntent } from "./intent-extractor.mjs";
import { appendAuditLog } from "../security/audit-log.mjs";
import { requireFeature } from "../core/feature-flags.mjs";

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

function buildDateRange(now) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return { start: yesterday, end: today };
}

function collectMessagesForAccount(account, range) {
  if (account.provider !== "mock") {
    return [];
  }
  const messages = account.mockMessages ?? [];
  return messages.filter((msg) => {
    const receivedAt = new Date(msg.receivedAt ?? msg.received_at ?? 0);
    return receivedAt >= range.start && receivedAt < range.end;
  });
}

function buildDigestMarkdown({ totals, buckets, perAccount }) {
  const lines = [];
  lines.push(`# 昨日邮件汇总`);
  lines.push("");
  lines.push(`总计 ${totals.total} 封邮件，其中 ${totals.actionRequired} 封需要回复。`);
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

export async function maybeRunMorningDigest({ runtime, now = new Date() } = {}) {
  const config = runtime.configStore?.load?.() ?? {};
  const featureGate = requireFeature("morning_digest", runtime.configStore);
  if (!featureGate.ok) {
    return { ok: false, reason: "feature_disabled", gate: featureGate };
  }
  const digestConfig = config.email?.digest ?? {};
  if (digestConfig.enabled === false) {
    return { ok: false, reason: "disabled" };
  }

  const { windowStart, windowEnd } = parseTimeWindow(digestConfig);
  if (!withinWindow(now, windowStart, windowEnd)) {
    return { ok: false, reason: "outside_window", windowStart, windowEnd };
  }

  if (digestConfig.skipWeekends && isWeekend(now)) {
    return { ok: false, reason: "weekend" };
  }

  // In-memory throttle — independent of the state file.
  const lastFiredAt = _digestLastFiredAt.get(runtime);
  if (lastFiredAt && now.getTime() - lastFiredAt < MIN_FIRE_MS) {
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
    if (state.lastDigestDate === todayKey) {
      return { ok: false, reason: "already_sent", lastDigestDate: state.lastDigestDate };
    }

    const accounts = listEmailAccounts(runtime).filter((account) => account.enabled);
    if (accounts.length === 0) {
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

    const range = buildDateRange(now);
    const allMessages = [];
    const perAccount = [];
    for (const account of accounts) {
      const messages = collectMessagesForAccount(account, range);
      allMessages.push(...messages);
      perAccount.push({
        id: account.id,
        name: account.displayName ?? account.email ?? account.id,
        count: messages.length,
        actionRequired: 0
      });
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

    const digestMd = buildDigestMarkdown({ totals, buckets, perAccount });
    const outputDir = runtime.paths?.outputsDir ?? path.join(os.homedir(), "Desktop", "UCA");
    await mkdir(outputDir, { recursive: true });
    const digestPath = path.join(outputDir, `email-digest-${todayKey}.md`);
    await writeFile(digestPath, digestMd, "utf8");

    await sendNotification(runtime, {
      title: "早晨邮件汇总",
      body: `昨日 ${totals.total} 封邮件，需回复 ${totals.actionRequired} 封。点击查看详情。`,
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

    return { ok: true, digestPath, sent: true };
  })();

  _digestInFlight.set(runtime, work);
  try {
    return await work;
  } finally {
    if (_digestInFlight.get(runtime) === work) _digestInFlight.delete(runtime);
  }
}
