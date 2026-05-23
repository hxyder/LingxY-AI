// Circular import is safe: capability-mapper imports createCapabilityMap
// from this file, but only uses it inside function bodies, and we likewise
// only call scopesToCapabilities inside normalizeConnectedAccount — by then
// both modules have finished evaluating.
import { scopesToCapabilities } from "./capability-mapper.mjs";

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
  const scopes = Array.isArray(account.scopes) ? [...account.scopes] : [];

  // UCA-096 follow-up: recompute capabilities from scopes at read time so
  // stored capability maps from older mapper versions auto-upgrade — no
  // re-auth needed when we teach the mapper about a new scope. The stored
  // capabilities_json stays authoritative only for fields the scope mapper
  // can't derive (none today); when scopes disagree with the stored map,
  // scopes win.
  const capabilities = scopes.length > 0
      && (account.provider === "google" || account.provider === "microsoft")
    ? scopesToCapabilities(account.provider, scopes)
    : createCapabilityMap(account.capabilities);

  return {
    id,
    accountId: id,
    userId: account.userId ?? "local",
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    email: account.email ?? "",
    displayName: account.displayName ?? undefined,
    scopes,
    capabilities,
    tokenStatus: account.tokenStatus ?? "active",
    isDefaultForEmail: account.isDefaultForEmail === true,
    isDefaultForFiles: account.isDefaultForFiles === true,
    isDefaultForCalendar: account.isDefaultForCalendar === true,
    lastUsedAt: account.lastUsedAt ?? null,
    createdAt: account.createdAt ?? now,
    updatedAt: account.updatedAt ?? now
  };
}

