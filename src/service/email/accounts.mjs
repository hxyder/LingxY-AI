import { getCredential, setCredential, deleteCredential } from "./credential-store.mjs";

function loadConfig(runtime) {
  return runtime?.configStore?.load?.() ?? {};
}

function saveConfig(runtime, nextConfig) {
  runtime?.configStore?.save?.(nextConfig);
  return nextConfig;
}

function normalizeAccount(entry) {
  return {
    id: entry.id,
    provider: entry.provider ?? "imap",
    displayName: entry.displayName ?? entry.email ?? entry.id,
    email: entry.email ?? "",
    authType: entry.authType ?? "password",
    imapHost: entry.imapHost ?? "",
    imapPort: Number(entry.imapPort ?? 993),
    enabled: entry.enabled !== false,
    lastSyncAt: entry.lastSyncAt ?? null,
    metadata: entry.metadata ?? {},
    credentialRef: entry.credentialRef ?? entry.id
  };
}

export function listEmailAccounts(runtime) {
  const config = loadConfig(runtime);
  const accounts = config.email?.accounts ?? [];
  return accounts.map(normalizeAccount);
}

export async function upsertEmailAccount(runtime, account, credentials = null) {
  const config = loadConfig(runtime);
  const accounts = config.email?.accounts ?? [];
  const normalized = normalizeAccount(account);
  const nextAccounts = accounts.some((item) => item.id === normalized.id)
    ? accounts.map((item) => item.id === normalized.id ? normalized : item)
    : [...accounts, normalized];

  const nextConfig = {
    ...config,
    email: {
      ...(config.email ?? {}),
      accounts: nextAccounts
    }
  };

  saveConfig(runtime, nextConfig);

  if (credentials) {
    await setCredential(runtime, normalized.credentialRef, credentials);
  }

  return normalized;
}

export async function deleteEmailAccount(runtime, accountId) {
  const config = loadConfig(runtime);
  const accounts = config.email?.accounts ?? [];
  const remaining = accounts.filter((item) => item.id !== accountId);
  const removed = accounts.find((item) => item.id === accountId) ?? null;
  const nextConfig = {
    ...config,
    email: {
      ...(config.email ?? {}),
      accounts: remaining
    }
  };
  saveConfig(runtime, nextConfig);
  await deleteCredential(runtime, accountId);
  return removed;
}

export async function resolveAccountCredentials(runtime, account) {
  const ref = account?.credentialRef ?? account?.id;
  if (!ref) return null;
  return getCredential(runtime, ref);
}

export async function updateAccountSyncStamp(runtime, accountId, timestamp) {
  const config = loadConfig(runtime);
  const accounts = config.email?.accounts ?? [];
  const nextAccounts = accounts.map((item) =>
    item.id === accountId ? { ...item, lastSyncAt: timestamp } : item
  );
  saveConfig(runtime, {
    ...config,
    email: {
      ...(config.email ?? {}),
      accounts: nextAccounts
    }
  });
}
