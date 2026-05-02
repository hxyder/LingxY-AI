/**
 * Account Connectors — Microsoft 365 and Google OAuth integration.
 *
 * Flow:
 *   1. UI calls POST /connectors/accounts/:type/auth/start
 *      → backend generates PKCE verifier + challenge, stores in-memory pending state,
 *        returns { authUrl, state } to UI.
 *   2. Electron opens authUrl in the default browser.
 *   3. Provider redirects to http://localhost:4310/auth/callback?code=…&state=…
 *   4. Backend exchanges the code for tokens, saves them via credential-store.
 *   5. UI polls GET /connectors/accounts and sees the connector is now "connected".
 *
 * Supported types: "microsoft" | "google"
 */

import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { scopesToCapabilities } from "./core/capability-mapper.mjs";
import {
  deleteConnectedAccount,
  listUserAccounts,
  saveOAuthTokenRecord,
  upsertConnectedAccount
} from "./core/account-registry.mjs";
import { fetchExternal } from "../core/external-call.mjs";

const SERVICE_NAME = "UCA.AccountConnector";
const ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS = 120_000;
const MICROSOFT_SCOPES = Object.freeze([
  "openid",
  "profile",
  "email",
  "User.Read",
  "Files.Read.All",
  "Mail.Read",
  "Calendars.Read",
  "offline_access"
]);
const GOOGLE_SCOPES = Object.freeze([
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events"
]);

// ── In-memory pending OAuth states (keyed by random state string) ─────────────
// Each entry: { type, verifier, clientId, clientSecret, expiresAt }
const _pendingStates = new Map();

// Expire pending states after 10 minutes
function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of _pendingStates) {
    if (v.expiresAt < now) _pendingStates.delete(k);
  }
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateVerifier() {
  return crypto.randomBytes(64).toString("base64url");
}

function generateChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState() {
  return crypto.randomBytes(20).toString("hex");
}

// ── Credential persistence (reuses keytar via fallback pattern) ───────────────

async function loadKeytar() {
  try {
    const mod = await import("keytar");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

function resolveFallbackPath(runtime) {
  const base = runtime?.paths?.dataDir
    ?? (process.env.APPDATA ? path.join(process.env.APPDATA, "UCA") : path.join(os.homedir(), ".uca-runtime"));
  return path.join(base, "account-tokens.json");
}

async function readFallback(runtime) {
  try {
    const raw = await readFile(resolveFallbackPath(runtime), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeFallback(runtime, store) {
  const p = resolveFallbackPath(runtime);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function saveTokens(runtime, type, tokens) {
  const key = `${type}:tokens`;
  const kt = await loadKeytar();
  if (kt) {
    await kt.setPassword(SERVICE_NAME, key, JSON.stringify(tokens));
    return;
  }
  const store = await readFallback(runtime);
  store[key] = tokens;
  await writeFallback(runtime, store);
}

async function loadTokens(runtime, type) {
  const key = `${type}:tokens`;
  const kt = await loadKeytar();
  if (kt) {
    const raw = await kt.getPassword(SERVICE_NAME, key);
    return raw ? JSON.parse(raw) : null;
  }
  const store = await readFallback(runtime);
  return store[key] ?? null;
}

async function deleteTokens(runtime, type) {
  const key = `${type}:tokens`;
  const kt = await loadKeytar();
  if (kt) {
    await kt.deletePassword(SERVICE_NAME, key);
    return;
  }
  const store = await readFallback(runtime);
  delete store[key];
  await writeFallback(runtime, store);
}

// ── Config persistence (client_id / client_secret stored in runtime config) ───

export function loadConnectorConfig(runtime, type) {
  const config = runtime.configStore?.load?.() ?? {};
  return config.connectors?.[type] ?? {};
}

export function saveConnectorConfig(runtime, type, updates) {
  const config = runtime.configStore?.load?.() ?? {};
  const next = {
    ...config,
    connectors: {
      ...(config.connectors ?? {}),
      [type]: { ...(config.connectors?.[type] ?? {}), ...updates }
    }
  };
  runtime.configStore?.save?.(next);
}

// ── Token refresh helpers ─────────────────────────────────────────────────────

function isExpired(tokens) {
  if (!tokens?.expires_at) return false;
  return Date.now() >= tokens.expires_at - 60_000; // 60s buffer
}

function attachExpiry(tokens) {
  const expiresIn = Number(tokens.expires_in ?? 3600);
  return { ...tokens, expires_at: Date.now() + expiresIn * 1000 };
}

async function refreshMicrosoftTokens(tokens, clientId) {
  if (!tokens?.refresh_token) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    scope: MICROSOFT_SCOPES.join(" ")
  });
  try {
    const r = await fetchExternal("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    }, {
      timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
      label: "account_connectors.microsoft_refresh",
      httpErrorPrefix: "Microsoft token refresh error"
    });
    return attachExpiry(await r.json());
  } catch {
    return null;
  }
}

async function refreshGoogleTokens(tokens, clientId, clientSecret) {
  if (!tokens?.refresh_token) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token
  });
  try {
    const r = await fetchExternal("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    }, {
      timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
      label: "account_connectors.google_refresh",
      httpErrorPrefix: "Google token refresh error"
    });
    const fresh = await r.json();
    // Google doesn't re-issue refresh_token — keep the original
    return attachExpiry({ refresh_token: tokens.refresh_token, ...fresh });
  } catch {
    return null;
  }
}

// Returns a valid access_token, refreshing if needed. Returns null if unavailable.
export async function getValidAccessToken(runtime, type) {
  let tokens = await loadTokens(runtime, type);
  if (!tokens) return null;

  if (!isExpired(tokens)) return tokens.access_token;

  const cfg = loadConnectorConfig(runtime, type);
  let fresh;
  if (type === "microsoft") {
    fresh = await refreshMicrosoftTokens(tokens, cfg.clientId);
  } else if (type === "google") {
    fresh = await refreshGoogleTokens(tokens, cfg.clientId, cfg.clientSecret);
  }

  if (!fresh?.access_token) return null;
  await saveTokens(runtime, type, fresh);
  return fresh.access_token;
}

// ── OAuth flow: start ─────────────────────────────────────────────────────────

const REDIRECT_URI = "http://localhost:4310/auth/callback";

export function startMicrosoftAuth(clientId) {
  if (!clientId) throw new Error("missing_client_id");
  pruneExpired();
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = generateState();
  _pendingStates.set(state, {
    type: "microsoft",
    verifier,
    clientId,
    scopes: MICROSOFT_SCOPES,
    expiresAt: Date.now() + 10 * 60_000
  });
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return { authUrl: url.toString(), state };
}

export function startGoogleAuth(clientId) {
  if (!clientId) throw new Error("missing_client_id");
  pruneExpired();
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = generateState();
  _pendingStates.set(state, {
    type: "google",
    verifier,
    clientId,
    scopes: GOOGLE_SCOPES,
    expiresAt: Date.now() + 10 * 60_000
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  return { authUrl: url.toString(), state };
}

// ── OAuth flow: complete (called by /auth/callback handler) ──────────────────

export async function completeOAuthCallback(runtime, code, state) {
  pruneExpired();
  const pending = _pendingStates.get(state);
  if (!pending) return { ok: false, error: "invalid_state" };
  _pendingStates.delete(state);

  const { type, verifier, clientId, scopes: requestedScopes = [] } = pending;
  const cfg = loadConnectorConfig(runtime, type);

  let tokenRes;
  if (type === "microsoft") {
    const params = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    });
    try {
      tokenRes = await fetchExternal("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      }, {
        timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
        label: "account_connectors.microsoft_token_exchange",
        httpErrorPrefix: "Microsoft token exchange error"
      });
    } catch (err) {
      return { ok: false, error: "token_exchange_failed", detail: err?.body ?? err?.message ?? String(err) };
    }
  } else if (type === "google") {
    const clientSecret = cfg.clientSecret ?? "";
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    });
    try {
      tokenRes = await fetchExternal("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
      }, {
        timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
        label: "account_connectors.google_token_exchange",
        httpErrorPrefix: "Google token exchange error"
      });
    } catch (err) {
      return { ok: false, error: "token_exchange_failed", detail: err?.body ?? err?.message ?? String(err) };
    }
  } else {
    return { ok: false, error: "unknown_type" };
  }

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return { ok: false, error: "token_exchange_failed", detail: err };
  }

  const tokens = attachExpiry(await tokenRes.json());
  await saveTokens(runtime, type, tokens);
  const scopes = (tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : requestedScopes);
  let account = null;
  try {
    const accessToken = tokens.access_token;
    const info = accessToken ? await getUserInfo(type, accessToken) : null;
    if (info?.email) {
      account = upsertConnectedAccount(runtime, {
        userId: "local",
        provider: type,
        providerAccountId: info.providerAccountId ?? info.email,
        email: info.email,
        displayName: info.displayName,
        scopes,
        capabilities: scopesToCapabilities(type, scopes),
        tokenStatus: "active"
      });
      saveOAuthTokenRecord(runtime, {
        accountId: account.id,
        accessTokenEncrypted: tokens.access_token ?? null,
        refreshTokenEncrypted: tokens.refresh_token ?? null,
        idTokenEncrypted: tokens.id_token ?? null,
        expiresAt: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null,
        scopes
      });
    }
  } catch {
    // Keep the legacy provider-level token path working even if account
    // registration metadata cannot be fetched yet. The UI can ask the user to
    // reauth once canonical account status becomes required.
  }
  return { ok: true, type, account };
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export async function disconnectAccount(runtime, type) {
  await deleteTokens(runtime, type);
  for (const account of listUserAccounts(runtime).filter((item) => item.provider === type)) {
    deleteConnectedAccount(runtime, account.id);
  }
  return { ok: true };
}

// ── Status check ──────────────────────────────────────────────────────────────

export async function getConnectorStatus(runtime, type) {
  const tokens = await loadTokens(runtime, type);
  const cfg = loadConnectorConfig(runtime, type);
  if (!tokens) {
    return {
      type,
      connected: false,
      configured: Boolean(cfg.clientId),
      email: null,
      displayName: null,
      photoUrl: null
    };
  }
  // Try to get user info with the stored token (may be expired — try refresh too)
  const accessToken = await getValidAccessToken(runtime, type);
  if (!accessToken) {
    return {
      type,
      connected: false,
      configured: Boolean(cfg.clientId),
      email: null,
      displayName: null,
      tokenExpired: true
    };
  }
  try {
    const info = await getUserInfo(type, accessToken);
    return {
      type,
      connected: true,
      configured: true,
      email: info.email,
      displayName: info.displayName,
      photoUrl: info.photoUrl ?? null
    };
  } catch {
    return { type, connected: true, configured: true, email: null, displayName: null };
  }
}

// ── User info ─────────────────────────────────────────────────────────────────

async function getUserInfo(type, accessToken) {
  if (type === "microsoft") {
    const r = await fetchExternal("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${accessToken}` }
    }, {
      timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
      label: "account_connectors.microsoft_user_info",
      httpErrorPrefix: "Microsoft user info error"
    });
    const d = await r.json();
    return { providerAccountId: d.id ?? d.userPrincipalName ?? d.mail, displayName: d.displayName, email: d.mail ?? d.userPrincipalName };
  } else {
    const r = await fetchExternal("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` }
    }, {
      timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
      label: "account_connectors.google_user_info",
      httpErrorPrefix: "Google user info error"
    });
    const d = await r.json();
    return { providerAccountId: d.id ?? d.email, displayName: d.name, email: d.email, photoUrl: d.picture };
  }
}

// ── Resource listing (exposed to the AI via action tools) ─────────────────────

export async function listFiles(runtime, type, { limit = 20, query = "" } = {}) {
  const accessToken = await getValidAccessToken(runtime, type);
  if (!accessToken) return { ok: false, error: "not_connected" };

  try {
    if (type === "microsoft") {
      const qs = query
        ? `search(q='${encodeURIComponent(query)}')?$top=${limit}&$select=name,id,webUrl,lastModifiedDateTime,size,file`
        : `root/children?$top=${limit}&$orderby=lastModifiedDateTime desc&$select=name,id,webUrl,lastModifiedDateTime,size,file`;
      let r;
      try {
        r = await fetchExternal(`https://graph.microsoft.com/v1.0/me/drive/${qs}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }, {
          timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
          label: "account_connectors.microsoft_files",
          httpErrorPrefix: "Microsoft files error"
        });
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`graph_files_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      return {
        ok: true, files: (d.value ?? []).map((f) => ({
          id: f.id, name: f.name, url: f.webUrl,
          modified: f.lastModifiedDateTime,
          size: f.size, isFolder: !f.file
        }))
      };
    } else {
      const qs = new URLSearchParams({
        pageSize: String(limit),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,webViewLink,modifiedTime,size,mimeType)",
        ...(query ? { q: `fullText contains '${query}'` } : {})
      });
      let r;
      try {
        r = await fetchExternal(`https://www.googleapis.com/drive/v3/files?${qs}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        }, {
          timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
          label: "account_connectors.google_files",
          httpErrorPrefix: "Google Drive files error"
        });
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`gdrive_files_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      return {
        ok: true, files: (d.files ?? []).map((f) => ({
          id: f.id, name: f.name, url: f.webViewLink,
          modified: f.modifiedTime,
          size: f.size,
          isFolder: f.mimeType === "application/vnd.google-apps.folder"
        }))
      };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function listEmails(runtime, type, { limit = 10 } = {}) {
  const accessToken = await getValidAccessToken(runtime, type);
  if (!accessToken) return { ok: false, error: "not_connected" };

  try {
    if (type === "microsoft") {
      let r;
      try {
        r = await fetchExternal(
          `https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,isRead`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
            label: "account_connectors.microsoft_mail",
            httpErrorPrefix: "Microsoft mail error"
          }
        );
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`graph_mail_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      return {
        ok: true, emails: (d.value ?? []).map((m) => ({
          id: m.id, subject: m.subject,
          from: m.from?.emailAddress?.address,
          fromName: m.from?.emailAddress?.name,
          received: m.receivedDateTime,
          preview: m.bodyPreview, isRead: m.isRead
        }))
      };
    } else {
      // Gmail: fetch message IDs, then get details for first few
      let r;
      try {
        r = await fetchExternal(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&labelIds=INBOX`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
            label: "account_connectors.gmail_list",
            httpErrorPrefix: "Gmail list error"
          }
        );
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`gmail_list_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      const ids = (d.messages ?? []).slice(0, limit).map((m) => m.id);
      const details = await Promise.all(ids.map(async (id) => {
        let dr;
        try {
          dr = await fetchExternal(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject,From,Date`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
            {
              timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
              label: "account_connectors.gmail_detail",
              httpErrorPrefix: "Gmail message detail error"
            }
          );
        } catch (err) {
          if (Number.isFinite(Number(err?.status))) return null;
          throw err;
        }
        const msg = await dr.json();
        const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h) => [h.name, h.value]));
        return {
          id, subject: headers.Subject,
          from: headers.From, received: headers.Date,
          isRead: !(msg.labelIds ?? []).includes("UNREAD")
        };
      }));
      return { ok: true, emails: details.filter(Boolean) };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function listCalendarEvents(runtime, type, { limit = 10 } = {}) {
  const accessToken = await getValidAccessToken(runtime, type);
  if (!accessToken) return { ok: false, error: "not_connected" };

  try {
    const now = new Date().toISOString();
    if (type === "microsoft") {
      let r;
      try {
        r = await fetchExternal(
          `https://graph.microsoft.com/v1.0/me/events?$top=${limit}&$filter=start/dateTime ge '${now}'&$orderby=start/dateTime&$select=subject,start,end,organizer,location`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
            label: "account_connectors.microsoft_calendar",
            httpErrorPrefix: "Microsoft calendar error"
          }
        );
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`graph_calendar_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      return {
        ok: true, events: (d.value ?? []).map((e) => ({
          id: e.id, title: e.subject,
          start: e.start?.dateTime, end: e.end?.dateTime,
          organizer: e.organizer?.emailAddress?.name,
          location: e.location?.displayName
        }))
      };
    } else {
      const timeMin = encodeURIComponent(now);
      let r;
      try {
        r = await fetchExternal(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${limit}&timeMin=${timeMin}&singleEvents=true&orderBy=startTime&fields=items(id,summary,start,end,organizer,location)`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            timeoutMs: ACCOUNT_CONNECTOR_FETCH_TIMEOUT_MS,
            label: "account_connectors.google_calendar",
            httpErrorPrefix: "Google calendar error"
          }
        );
      } catch (err) {
        if (Number.isFinite(Number(err?.status))) throw new Error(`gcal_error: ${err.status}`);
        throw err;
      }
      const d = await r.json();
      return {
        ok: true, events: (d.items ?? []).map((e) => ({
          id: e.id, title: e.summary,
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          organizer: e.organizer?.displayName ?? e.organizer?.email,
          location: e.location
        }))
      };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
