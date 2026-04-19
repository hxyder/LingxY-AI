export const CONNECTOR_PROVIDERS = Object.freeze(["google", "microsoft"]);

export const CONNECTOR_CAPABILITIES = Object.freeze([
  "emailRead",
  "emailWrite",
  "fileRead",
  "fileWrite",
  "calendarRead",
  "calendarWrite"
]);

export const TOKEN_STATUSES = Object.freeze([
  "active",
  "expired",
  "reauth_required",
  "revoked",
  "error"
]);

export const EMPTY_CAPABILITY_MAP = Object.freeze({
  emailRead: false,
  emailWrite: false,
  fileRead: false,
  fileWrite: false,
  calendarRead: false,
  calendarWrite: false
});

export function createCapabilityMap(patch = {}) {
  return {
    ...EMPTY_CAPABILITY_MAP,
    ...(patch ?? {})
  };
}

export function isConnectorProvider(value) {
  return CONNECTOR_PROVIDERS.includes(value);
}

export function isConnectorCapability(value) {
  return CONNECTOR_CAPABILITIES.includes(value);
}

export function normalizeConnectedAccount(account) {
  const now = new Date().toISOString();
  const id = account.id ?? account.accountId;
  return {
    id,
    accountId: id,
    userId: account.userId ?? "local",
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    email: account.email ?? "",
    displayName: account.displayName ?? undefined,
    scopes: Array.isArray(account.scopes) ? [...account.scopes] : [],
    capabilities: createCapabilityMap(account.capabilities),
    tokenStatus: account.tokenStatus ?? "active",
    isDefaultForEmail: account.isDefaultForEmail === true,
    isDefaultForFiles: account.isDefaultForFiles === true,
    isDefaultForCalendar: account.isDefaultForCalendar === true,
    lastUsedAt: account.lastUsedAt ?? null,
    createdAt: account.createdAt ?? now,
    updatedAt: account.updatedAt ?? now
  };
}

