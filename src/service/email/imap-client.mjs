import fs from "node:fs/promises";

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
      async markSeen(id) {
        const seen = state.seenByAccount.get(account.id) ?? new Set();
        seen.add(id);
        state.seenByAccount.set(account.id, seen);
      }
    };
  }

  return {
    async listUnread() {
      throw new Error(`IMAP client not configured for ${account.provider}.`);
    },
    async markSeen() {
      return null;
    }
  };
}
