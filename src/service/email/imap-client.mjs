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

async function withImapConnection(config, handler) {
  const client = new ImapFlow(config);
  try {
    await client.connect();
    return await handler(client);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}

function shortPreview(text = "", max = 120) {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
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
  return {
    async listUnread(since, limit = 20) {
      return withImapConnection(config, async (client) => {
        const mailbox = await client.getMailboxLock("INBOX");
        try {
          const criteria = since ? { seen: false, since: new Date(since) } : { seen: false };
          const uids = await client.search(criteria);
          const recent = uids.slice(-limit);
          const messages = [];
          for await (const msg of client.fetch(recent, { envelope: true, bodyParts: ["TEXT"], source: false })) {
            messages.push(normalizeMessage({
              id: String(msg.uid),
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
            messages.push({
              id: String(msg.uid),
              subject: msg.envelope?.subject ?? "(no subject)",
              from: fromAddr?.address ?? "",
              fromName: fromAddr?.name ?? "",
              received: (msg.envelope?.date ?? new Date()).toISOString(),
              isRead: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : msg.flags?.has?.("\\Seen") ?? false,
              preview: shortPreview(msg.bodyParts?.get?.("TEXT")?.toString?.() ?? "")
            });
          }
          // newest first
          return messages.reverse();
        } finally {
          mailbox.release();
        }
      });
    },
    async markSeen() {
      return null;
    }
  };
}
