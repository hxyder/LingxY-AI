import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  getAccountById,
  getOAuthTokenRecord,
  markAccountTokenStatus,
  saveOAuthTokenRecord,
  upsertConnectedAccount
} from "./account-registry.mjs";
import { scopesToCapabilities } from "./capability-mapper.mjs";
import { resolveConnectorOAuthConfig } from "../oauth-defaults.mjs";

const MICROSOFT_READ_SCOPES = "openid profile email User.Read Files.Read.All Mail.Read Calendars.Read offline_access";

function loadConnectorConfig(runtime, provider) {
  return resolveConnectorOAuthConfig(runtime, provider);
}

function tokenValue(record, field) {
  if (!record) return null;
  if (field === "access") return record.accessTokenEncrypted ?? record.accessToken ?? null;
  if (field === "refresh") return record.refreshTokenEncrypted ?? record.refreshToken ?? null;
  if (field === "id") return record.idTokenEncrypted ?? record.idToken ?? null;
  return null;
}

function isExpired(record) {
  if (!record?.expiresAt) return false;
  const ts = typeof record.expiresAt === "number"
    ? record.expiresAt
    : new Date(record.expiresAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() >= ts - 60_000;
}

function expiresAtFromSeconds(expiresIn) {
  const seconds = Number(expiresIn ?? 3600);
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeScopes(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return fallback;
}

async function refreshMicrosoftToken({ tokenRecord, clientId, fetchImpl }) {
  const refreshToken = tokenValue(tokenRecord, "refresh");
  if (!refreshToken || !clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MICROSOFT_READ_SCOPES
  });
  const response = await fetchImpl("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    accessTokenEncrypted: data.access_token,
    refreshTokenEncrypted: data.refresh_token ?? refreshToken,
    idTokenEncrypted: data.id_token ?? tokenValue(tokenRecord, "id"),
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: normalizeScopes(data.scope, tokenRecord.scopes ?? [])
  };
}

async function refreshGoogleToken({ tokenRecord, clientId, clientSecret, fetchImpl }) {
  const refreshToken = tokenValue(tokenRecord, "refresh");
  if (!refreshToken || !clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  if (clientSecret) params.set("client_secret", clientSecret);
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    accessTokenEncrypted: data.access_token,
    refreshTokenEncrypted: refreshToken,
    idTokenEncrypted: data.id_token ?? tokenValue(tokenRecord, "id"),
    expiresAt: expiresAtFromSeconds(data.expires_in),
    scopes: normalizeScopes(data.scope, tokenRecord.scopes ?? [])
  };
}

export async function refreshTokenIfNeeded(runtime, accountId, { fetchImpl = fetch } = {}) {
  const account = getAccountById(runtime, accountId);
  if (!account) {
    throw new Error("account_not_found");
  }
  const tokenRecord = getOAuthTokenRecord(runtime, accountId);
  if (!tokenRecord) {
    markAccountTokenStatus(runtime, accountId, "reauth_required");
    return null;
  }
  if (!isExpired(tokenRecord) && tokenValue(tokenRecord, "access")) {
    return tokenRecord;
  }

  const cfg = loadConnectorConfig(runtime, account.provider);
  const fresh = account.provider === "microsoft"
    ? await refreshMicrosoftToken({ tokenRecord, clientId: cfg.clientId, fetchImpl })
    : await refreshGoogleToken({ tokenRecord, clientId: cfg.clientId, clientSecret: cfg.clientSecret, fetchImpl });

  if (!fresh?.accessTokenEncrypted) {
    markAccountTokenStatus(runtime, accountId, "reauth_required");
    return null;
  }

  const scopes = fresh.scopes?.length ? fresh.scopes : account.scopes;
  const saved = saveOAuthTokenRecord(runtime, {
    accountId,
    ...fresh,
    scopes
  });
  upsertConnectedAccount(runtime, {
    ...account,
    scopes,
    capabilities: scopesToCapabilities(account.provider, scopes),
    tokenStatus: "active"
  });
  return saved;
}

export async function getValidAccessToken(runtime, accountId, options = {}) {
  const record = await refreshTokenIfNeeded(runtime, accountId, options);
  return tokenValue(record, "access");
}

function resolveLegacyFallbackPath(runtime) {
  const base = runtime?.paths?.dataDir
    ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "UCA") : path.join(os.homedir(), ".uca-runtime"));
  return path.join(base, "account-tokens.json");
}

async function readLegacyTokenStore(runtime) {
  try {
    const raw = await readFile(resolveLegacyFallbackPath(runtime), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function getProviderUserInfo(provider, accessToken, fetchImpl) {
  if (provider === "microsoft") {
    const response = await fetchImpl("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      providerAccountId: data.id ?? data.userPrincipalName ?? data.mail,
      email: data.mail ?? data.userPrincipalName ?? "",
      displayName: data.displayName ?? ""
    };
  }
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const data = await response.json();
  return {
    providerAccountId: data.id ?? data.email,
    email: data.email ?? "",
    displayName: data.name ?? ""
  };
}

export async function migrateLegacyConnectorTokens(runtime, { fetchImpl = fetch, userId = "local" } = {}) {
  const legacyStore = await readLegacyTokenStore(runtime);
  const migrated = [];
  for (const provider of ["google", "microsoft"]) {
    const legacyTokens = legacyStore[`${provider}:tokens`];
    if (!legacyTokens?.access_token && !legacyTokens?.refresh_token) continue;

    const accessToken = legacyTokens.access_token;
    const userInfo = accessToken ? await getProviderUserInfo(provider, accessToken, fetchImpl) : null;
    const scopes = normalizeScopes(legacyTokens.scope);
    const account = upsertConnectedAccount(runtime, {
      userId,
      provider,
      providerAccountId: userInfo?.providerAccountId ?? `legacy-${provider}`,
      email: userInfo?.email ?? `${provider}-reauth-required@local`,
      displayName: userInfo?.displayName ?? `${provider} legacy connector`,
      scopes,
      capabilities: scopesToCapabilities(provider, scopes),
      tokenStatus: userInfo ? "active" : "reauth_required"
    });
    saveOAuthTokenRecord(runtime, {
      accountId: account.id,
      accessTokenEncrypted: legacyTokens.access_token ?? null,
      refreshTokenEncrypted: legacyTokens.refresh_token ?? null,
      idTokenEncrypted: legacyTokens.id_token ?? null,
      expiresAt: legacyTokens.expires_at ? new Date(legacyTokens.expires_at).toISOString() : null,
      scopes
    });
    migrated.push(account);
  }
  return migrated;
}
