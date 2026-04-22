import fs from "node:fs/promises";
import { ImapFlow } from "imapflow";

function normalizeMessage(message) {
  return {
    id: message.id,
    threadId: message.threadId ?? message.thread_id ?? message.id,
    from: message.from ?? "",
    subject: message.subject ?? "",
    bodyText: message.bodyText ?? message.body_text ?? "",
    receivedAt: message.receivedAt ?? message.received_at ?? new Date().toISOString(),
    direction: message.direction ?? "in"
  };
}

async function readMockInbox(path) {
  const raw = await fs.readFile(path, "utf8");
  const payload = JSON.parse(raw);
  const list = Array.isArray(payload) ? payload : payload.messages ?? [];
  return list.map(normalizeMessage);
}

// Real IMAP uses ImapFlow. The client is created per call — IMAP connections
// are cheap to open for a single fetch pass and avoiding a long-lived pool
// keeps the code simple while we only use this for on-demand preview /
// monitor polling. If we ever need streaming or push we'll revisit.
function imapHostDefaults(provider) {
  switch (provider) {
    case "gmail":   return { host: "imap.gmail.com", port: 993, secure: true };
    case "outlook": return { host: "imap-mail.outlook.com", port: 993, secure: true };
    case "qq":      return { host: "imap.qq.com", port: 993, secure: true };
    case "163":     return { host: "imap.163.com", port: 993, secure: true };
    default:        return null;
  }
}

function resolveImapConnection(account, credentials) {
  const defaults = imapHostDefaults(account.provider) ?? { host: account.imapHost, port: account.imapPort ?? 993, secure: true };
  const host = account.imapHost || defaults.host;
  if (!host) throw new Error(`imap_host_missing for ${account.id}`);
  if (!credentials?.password && !credentials?.authToken) {
    throw new Error(`imap_credentials_missing for ${account.id}`);
  }
  return {
    host,
    port: Number(account.imapPort ?? defaults.port ?? 993),
    secure: defaults.secure ?? true,
    auth: {
      user: credentials.username ?? account.email ?? account.id,
      pass: credentials.password ?? credentials.authToken
    },
    // 163 / QQ need a client-identification (IMAP ID extension) before they
    // let you fetch. ImapFlow wraps the protocol and sends this automatically
    // when the server advertises the capability.
    clientInfo: { name: "LingxY" },
    logger: false
  };
}

// Lightweight IMAP connection pool — keyed by a stable signature of the
// connection config (host + port + user) so each account reuses one socket
// across the same process. Connections idle > POOL_IDLE_MS are closed on
// the next GC sweep; dead sockets (server-closed) are replaced transparently.
// This shaves ~500–1000 ms off repeat listRecent/listUnread calls (no new
// TLS handshake / LOGIN / CAPABILITY per request).
const POOL_IDLE_MS = 60_000;
const imapPool = new Map(); // key -> { client, lastUsedAt, busy, connectPromise }
let poolGcTimer = null;

function poolKey(config) {
  return `${config?.host ?? ""}|${config?.port ?? ""}|${config?.auth?.user ?? ""}`;
}

function startPoolGcIfNeeded() {
  if (poolGcTimer) return;
  poolGcTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of imapPool) {
      if (entry.busy) continue;
      if (now - entry.lastUsedAt > POOL_IDLE_MS) {
        imapPool.delete(key);
        try { entry.client?.logout?.(); } catch { /* ignore */ }
      }
    }
    if (imapPool.size === 0) {
      clearInterval(poolGcTimer);
      poolGcTimer = null;
    }
  }, 15_000);
  if (typeof poolGcTimer.unref === "function") poolGcTimer.unref();
}

async function acquireImapClient(config) {
  const key = poolKey(config);
  let entry = imapPool.get(key);
  if (entry && !entry.busy && entry.client?.usable !== false) {
    entry.busy = true;
    entry.lastUsedAt = Date.now();
    return { key, client: entry.client, entry };
  }
  // Either no entry, entry is in use, or prior client died — create fresh.
  const client = new ImapFlow(config);
  try {
    await client.connect();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }
  entry = { client, lastUsedAt: Date.now(), busy: true };
  imapPool.set(key, entry);
  startPoolGcIfNeeded();
  return { key, client, entry };
}

function releaseImapClient(key, entry, { dead = false } = {}) {
  if (!entry) return;
  entry.busy = false;
  entry.lastUsedAt = Date.now();
  if (dead) {
    imapPool.delete(key);
    try { entry.client?.logout?.(); } catch { /* ignore */ }
  }
}

async function withImapConnection(config, handler) {
  const acquired = await acquireImapClient(config);
  try {
    return await handler(acquired.client);
  } catch (err) {
    // If the underlying socket died mid-operation ("connection closed" etc.),
    // drop the pooled client so the next call opens a fresh one. Propagate
    // so the caller surfaces the error.
    const isConnectionError = /(?:closed|timeout|socket|ECONNRESET|EPIPE|connection)/i.test(String(err?.message ?? ""));
    releaseImapClient(acquired.key, acquired.entry, { dead: isConnectionError });
    throw err;
  } finally {
    const entry = imapPool.get(acquired.key);
    if (entry && entry.client === acquired.client && entry.busy) {
      releaseImapClient(acquired.key, acquired.entry, { dead: false });
    }
  }
}

function shortPreview(text = "", max = 120) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
}

// Full-text body, normalized just enough to be readable in a preview
// pane: collapse Windows line endings, trim leading/trailing whitespace,
// and cap length so we don't drag 5MB marketing emails into the UI.
function normalizeBody(text = "", max = 4000) {
  const cleaned = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "\n…" : cleaned;
}

export function createImapClient({ account, credentials, state }) {
  if (account.provider === "mock") {
    return {
      async listUnread(since, limit = 20) {
        const seen = state.seenByAccount.get(account.id) ?? new Set();
        const messages = account.mockMessages
          ? account.mockMessages.map(normalizeMessage)
          : account.mockInboxPath
            ? await readMockInbox(account.mockInboxPath)
            : [];
        return messages
          .filter((msg) => !seen.has(msg.id))
          .filter((msg) => !since || msg.receivedAt > since)
          .slice(0, limit);
      },
      async listRecent(limit = 30) {
        const messages = account.mockMessages
          ? account.mockMessages.map(normalizeMessage)
          : account.mockInboxPath
            ? await readMockInbox(account.mockInboxPath)
            : [];
        return messages.slice(0, limit);
      },
      async markSeen(id) {
        const seen = state.seenByAccount.get(account.id) ?? new Set();
        seen.add(id);
        state.seenByAccount.set(account.id, seen);
      }
    };
  }

  const config = resolveImapConnection(account, credentials);
  // Ensure the shared seen-set Map has a bucket for this account so
  // the monitor's dedup contract holds across listUnread → markSeen
  // → next listUnread. The mock provider already uses this; the real
  // provider previously left markSeen as a no-op, which meant the
  // monitor re-notified every unread message on every 2-min poll —
  // symptom: "新邮件摘要" desktop notifications looping.
  if (state?.seenByAccount && !state.seenByAccount.has(account.id)) {
    state.seenByAccount.set(account.id, new Set());
  }
  return {
    async listUnread(since, limit = 20) {
      return withImapConnection(config, async (client) => {
        const mailbox = await client.getMailboxLock("INBOX");
        try {
          const criteria = since ? { seen: false, since: new Date(since) } : { seen: false };
          const uids = await client.search(criteria);
          const recent = uids.slice(-limit);
          const messages = [];
          const seenIds = state?.seenByAccount?.get(account.id) ?? new Set();
          for await (const msg of client.fetch(recent, { envelope: true, bodyParts: ["TEXT"], source: false })) {
            const id = String(msg.uid);
            if (seenIds.has(id)) continue; // already notified in-memory this session
            messages.push(normalizeMessage({
              id,
              from: msg.envelope?.from?.[0]?.address ?? "",
              subject: msg.envelope?.subject ?? "",
              bodyText: shortPreview(msg.bodyParts?.get?.("TEXT")?.toString?.() ?? ""),
              receivedAt: (msg.envelope?.date ?? new Date()).toISOString()
            }));
          }
          return messages;
        } finally {
          mailbox.release();
        }
      });
    },
    // listRecent: on-demand preview for the Inbox tab. Independent of the
    // monitor's seen-set — shows the last N messages whether read or not.
    async listRecent(limit = 30) {
      return withImapConnection(config, async (client) => {
        const mailbox = await client.getMailboxLock("INBOX");
        try {
          const status = await client.status("INBOX", { messages: true });
          const total = status.messages ?? 0;
          if (total === 0) return [];
          const start = Math.max(1, total - limit + 1);
          const range = `${start}:${total}`;
          const messages = [];
          for await (const msg of client.fetch(range, { envelope: true, flags: true, bodyParts: ["TEXT"], source: false })) {
            const fromAddr = msg.envelope?.from?.[0];
            const bodyRaw = msg.bodyParts?.get?.("TEXT")?.toString?.() ?? "";
            messages.push({
              id: String(msg.uid),
              subject: msg.envelope?.subject ?? "(no subject)",
              from: fromAddr?.address ?? "",
              fromName: fromAddr?.name ?? "",
              received: (msg.envelope?.date ?? new Date()).toISOString(),
              isRead: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : msg.flags?.has?.("\\Seen") ?? false,
              preview: shortPreview(bodyRaw),
              bodyText: normalizeBody(bodyRaw)
            });
          }
          // newest first
          return messages.reverse();
        } finally {
          mailbox.release();
        }
      });
    },
    // Track seen IDs in-memory so listUnread doesn't re-surface the
    // same message to the monitor every 2-min poll. We deliberately
    // don't set the IMAP \Seen flag on the server — the user might not
    // have actually opened the email in their mail client yet, and
    // flipping \Seen on their behalf would mis-render in Gmail/Outlook.
    async markSeen(id) {
      if (!state?.seenByAccount || id == null) return;
      if (!state.seenByAccount.has(account.id)) state.seenByAccount.set(account.id, new Set());
      state.seenByAccount.get(account.id).add(String(id));
    }
  };
}
