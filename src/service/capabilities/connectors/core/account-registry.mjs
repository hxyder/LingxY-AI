import crypto from "node:crypto";
import { normalizeConnectedAccount } from "./types.mjs";

const PURPOSE_TO_FIELD = Object.freeze({
  email: "isDefaultForEmail",
  files: "isDefaultForFiles",
  calendar: "isDefaultForCalendar"
});

function requireStore(runtime) {
  if (!runtime?.store) {
    throw new Error("connector_registry_missing_store");
  }
  return runtime.store;
}

function newAccountId() {
  return `acct_${crypto.randomUUID()}`;
}

export function listUserAccounts(runtime, userId = "local") {
  const store = requireStore(runtime);
  return (store.listConnectedAccounts?.() ?? [])
    .map(normalizeConnectedAccount)
    .filter((account) => account.userId === userId);
}

export function getAccountById(runtime, accountId) {
  const store = requireStore(runtime);
  const account = store.getConnectedAccount?.(accountId);
  return account ? normalizeConnectedAccount(account) : null;
}

export function findAccountByProviderAccountId(runtime, provider, providerAccountId) {
  const store = requireStore(runtime);
  return (store.listConnectedAccounts?.() ?? [])
    .map(normalizeConnectedAccount)
    .find((account) => account.provider === provider && account.providerAccountId === providerAccountId)
    ?? null;
}

export function upsertConnectedAccount(runtime, account) {
  const store = requireStore(runtime);
  const existing = account.id || account.accountId
    ? store.getConnectedAccount?.(account.id ?? account.accountId)
    : findAccountByProviderAccountId(runtime, account.provider, account.providerAccountId);
  const now = new Date().toISOString();
  const normalized = normalizeConnectedAccount({
    ...existing,
    ...account,
    id: account.id ?? account.accountId ?? existing?.id ?? newAccountId(),
    createdAt: account.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now
  });
  return normalizeConnectedAccount(store.upsertConnectedAccount(normalized));
}

export function deleteConnectedAccount(runtime, accountId) {
  const store = requireStore(runtime);
  store.deleteOAuthToken?.(accountId);
  const deleted = store.deleteConnectedAccount?.(accountId);
  return deleted ? normalizeConnectedAccount(deleted) : null;
}

export function markAccountTokenStatus(runtime, accountId, status) {
  const account = getAccountById(runtime, accountId);
  if (!account) return null;
  return upsertConnectedAccount(runtime, {
    ...account,
    tokenStatus: status
  });
}

export function updateAccountLastUsed(runtime, accountId, when = new Date().toISOString()) {
  const account = getAccountById(runtime, accountId);
  if (!account) return null;
  return upsertConnectedAccount(runtime, {
    ...account,
    lastUsedAt: when
  });
}

export function setDefaultAccount(runtime, purpose, accountId) {
  const field = PURPOSE_TO_FIELD[purpose];
  if (!field) {
    throw new Error(`unknown_default_account_purpose:${purpose}`);
  }
  const target = getAccountById(runtime, accountId);
  if (!target) {
    throw new Error("account_not_found");
  }
  const accounts = listUserAccounts(runtime, target.userId);
  for (const account of accounts) {
    upsertConnectedAccount(runtime, {
      ...account,
      [field]: account.id === accountId
    });
  }
  return getAccountById(runtime, accountId);
}

export function saveOAuthTokenRecord(runtime, record) {
  const store = requireStore(runtime);
  const now = new Date().toISOString();
  return store.upsertOAuthToken({
    ...record,
    updatedAt: record.updatedAt ?? now
  });
}

export function getOAuthTokenRecord(runtime, accountId) {
  const store = requireStore(runtime);
  return store.getOAuthToken?.(accountId) ?? null;
}

export function deleteOAuthTokenRecord(runtime, accountId) {
  const store = requireStore(runtime);
  return store.deleteOAuthToken?.(accountId) ?? null;
}

export function upsertReauthRequest(runtime, request) {
  const store = requireStore(runtime);
  const now = new Date().toISOString();
  return store.upsertReauthRequest({
    ...request,
    status: request.status ?? "pending",
    createdAt: request.createdAt ?? now
  });
}

export function getReauthRequest(runtime, requestId) {
  const store = requireStore(runtime);
  return store.getReauthRequest?.(requestId) ?? null;
}

export function listReauthRequests(runtime) {
  const store = requireStore(runtime);
  return store.listReauthRequests?.() ?? [];
}

