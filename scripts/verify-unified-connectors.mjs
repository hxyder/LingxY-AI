import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createSqliteStore } from "../src/service/core/store/sqlite-store.mjs";
import {
  googleScopesToCapabilities,
  microsoftScopesToCapabilities
} from "../src/service/connectors/core/capability-mapper.mjs";
import {
  getAccountById,
  getOAuthTokenRecord,
  listUserAccounts,
  saveOAuthTokenRecord,
  setDefaultAccount,
  upsertConnectedAccount,
  upsertReauthRequest
} from "../src/service/connectors/core/account-registry.mjs";
import {
  getValidAccessToken,
  migrateLegacyConnectorTokens
} from "../src/service/connectors/core/token-manager.mjs";
import { resolveAccount } from "../src/service/connectors/core/account-router.mjs";
import {
  ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL,
  ACCOUNT_LIST_EMAILS_TOOL
} from "../src/service/connectors/tools/read-tools.mjs";
import {
  ACCOUNT_CREATE_EVENT_TOOL,
  ACCOUNT_SEND_EMAIL_TOOL,
  ACCOUNT_UPLOAD_FILE_TOOL
} from "../src/service/connectors/tools/write-tools.mjs";
import { evaluateToolRisk } from "../src/service/capabilities/registry/risk_matrix.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tmpRoot = path.join(repoRoot, ".tmp", "verify-unified-connectors");

function createRuntime(store, extras = {}) {
  return {
    store,
    configStore: {
      load() {
        return {
          connectors: {
            google: { clientId: "google-client", clientSecret: "google-secret" },
            microsoft: { clientId: "ms-client" }
          }
        };
      }
    },
    ...extras
  };
}

async function runRegistryCases(store) {
  const runtime = createRuntime(store);
  const google = upsertConnectedAccount(runtime, {
    userId: "local",
    provider: "google",
    providerAccountId: "g-1",
    email: "g@example.com",
    displayName: "Google User",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.file"
    ],
    capabilities: googleScopesToCapabilities([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/drive.file"
    ])
  });
  const microsoft = upsertConnectedAccount(runtime, {
    userId: "local",
    provider: "microsoft",
    providerAccountId: "m-1",
    email: "m@example.com",
    scopes: ["Mail.ReadWrite", "Files.ReadWrite", "Calendars.Read"],
    capabilities: microsoftScopesToCapabilities(["Mail.ReadWrite", "Files.ReadWrite", "Calendars.Read"])
  });

  assert.equal(listUserAccounts(runtime).length, 2);
  assert.equal(getAccountById(runtime, google.id).email, "g@example.com");
  assert.equal(google.capabilities.emailRead, true);
  assert.equal(google.capabilities.emailWrite, false);
  assert.equal(google.capabilities.fileWrite, true);
  assert.equal(microsoft.capabilities.emailWrite, true);
  assert.equal(microsoft.capabilities.calendarWrite, false);

  setDefaultAccount(runtime, "email", google.id);
  assert.equal(getAccountById(runtime, google.id).isDefaultForEmail, true);
  assert.equal(getAccountById(runtime, microsoft.id).isDefaultForEmail, false);
  setDefaultAccount(runtime, "email", microsoft.id);
  assert.equal(getAccountById(runtime, google.id).isDefaultForEmail, false);
  assert.equal(getAccountById(runtime, microsoft.id).isDefaultForEmail, true);

  saveOAuthTokenRecord(runtime, {
    accountId: google.id,
    accessTokenEncrypted: "access",
    refreshTokenEncrypted: "refresh",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    scopes: google.scopes
  });
  assert.equal(getOAuthTokenRecord(runtime, google.id).accessTokenEncrypted, "access");

  const reauth = upsertReauthRequest(runtime, {
    requestId: "reauth-1",
    userId: "local",
    accountId: google.id,
    provider: "google",
    missingCapabilities: ["emailWrite"],
    missingScopes: ["https://www.googleapis.com/auth/gmail.send"],
    reason: "send_email"
  });
  assert.equal(reauth.status, "pending");
}

async function runTokenRefreshCases() {
  const runtime = createRuntime(createInMemoryStoreScaffold());
  const account = upsertConnectedAccount(runtime, {
    userId: "local",
    provider: "google",
    providerAccountId: "g-refresh",
    email: "refresh@example.com",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    capabilities: googleScopesToCapabilities(["https://www.googleapis.com/auth/gmail.readonly"])
  });
  saveOAuthTokenRecord(runtime, {
    accountId: account.id,
    accessTokenEncrypted: "old-access",
    refreshTokenEncrypted: "refresh-token",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    scopes: account.scopes
  });

  const refreshed = await getValidAccessToken(runtime, account.id, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const body = new URLSearchParams(options.body);
      assert.equal(body.get("refresh_token"), "refresh-token");
      return {
        ok: true,
        async json() {
          return {
            access_token: "new-access",
            expires_in: 3600,
            scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send"
          };
        }
      };
    }
  });
  assert.equal(refreshed, "new-access");
  assert.equal(getAccountById(runtime, account.id).capabilities.emailWrite, true);

  const failing = upsertConnectedAccount(runtime, {
    userId: "local",
    provider: "microsoft",
    providerAccountId: "m-refresh",
    email: "fail@example.com",
    scopes: ["Mail.Read"],
    capabilities: microsoftScopesToCapabilities(["Mail.Read"])
  });
  saveOAuthTokenRecord(runtime, {
    accountId: failing.id,
    accessTokenEncrypted: "old",
    refreshTokenEncrypted: "bad-refresh",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    scopes: failing.scopes
  });
  const failed = await getValidAccessToken(runtime, failing.id, {
    fetchImpl: async () => ({ ok: false, async json() { return {}; } })
  });
  assert.equal(failed, null);
  assert.equal(getAccountById(runtime, failing.id).tokenStatus, "reauth_required");
}

async function runLegacyMigrationCase() {
  const dataDir = path.join(tmpRoot, "legacy-data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "account-tokens.json"), `${JSON.stringify({
    "google:tokens": {
      access_token: "legacy-google-access",
      refresh_token: "legacy-google-refresh",
      expires_at: Date.now() + 3600_000,
      scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly"
    }
  }, null, 2)}\n`, "utf8");

  const runtime = createRuntime(createInMemoryStoreScaffold(), {
    paths: { dataDir }
  });
  const migrated = await migrateLegacyConnectorTokens(runtime, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://www.googleapis.com/oauth2/v2/userinfo");
      assert.equal(options.headers.Authorization, "Bearer legacy-google-access");
      return {
        ok: true,
        async json() {
          return {
            id: "legacy-google-id",
            email: "legacy@example.com",
            name: "Legacy Google"
          };
        }
      };
    }
  });
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].email, "legacy@example.com");
  assert.equal(getOAuthTokenRecord(runtime, migrated[0].id).refreshTokenEncrypted, "legacy-google-refresh");
  assert.deepEqual(runtime.store.listAuditLogs(), []);
}

function runRouterCases() {
  const runtime = createRuntime(createInMemoryStoreScaffold());
  const first = upsertConnectedAccount(runtime, {
    provider: "google",
    providerAccountId: "router-g",
    email: "router-g@example.com",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    capabilities: googleScopesToCapabilities(["https://www.googleapis.com/auth/gmail.readonly"]),
    lastUsedAt: "2026-04-19T10:00:00.000Z"
  });
  const second = upsertConnectedAccount(runtime, {
    provider: "microsoft",
    providerAccountId: "router-m",
    email: "router-m@example.com",
    scopes: ["Mail.Read"],
    capabilities: microsoftScopesToCapabilities(["Mail.Read"]),
    lastUsedAt: "2026-04-19T11:00:00.000Z"
  });
  const accounts = listUserAccounts(runtime);

  assert.equal(resolveAccount({ connectedAccounts: accounts }, { provider: "google" }, "emailRead").id, first.id);
  assert.equal(resolveAccount({ connectedAccounts: accounts, userUtterance: "read Outlook mail" }, {}, "emailRead").id, second.id);
  assert.equal(resolveAccount({ connectedAccounts: accounts }, { accountId: first.id }, "emailWrite").status, "reauth_required");
  assert.equal(resolveAccount({ connectedAccounts: accounts }, {}, "emailRead").status, "account_selection_required");
  setDefaultAccount(runtime, "email", first.id);
  assert.equal(resolveAccount({ connectedAccounts: listUserAccounts(runtime) }, {}, "emailRead").id, first.id);
}

async function runReadToolCase() {
  const runtime = createRuntime(createInMemoryStoreScaffold());
  const account = upsertConnectedAccount(runtime, {
    provider: "google",
    providerAccountId: "tool-g",
    email: "tool-g@example.com",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    capabilities: googleScopesToCapabilities(["https://www.googleapis.com/auth/gmail.readonly"])
  });
  saveOAuthTokenRecord(runtime, {
    accountId: account.id,
    accessTokenEncrypted: "gmail-access",
    refreshTokenEncrypted: "gmail-refresh",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scopes: account.scopes
  });

  const result = await ACCOUNT_LIST_EMAILS_TOOL.execute({ accountId: account.id, limit: 1 }, {
    runtime,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer gmail-access");
      if (url.includes("/messages?")) {
        return {
          ok: true,
          async json() {
            return { messages: [{ id: "msg-1" }] };
          }
        };
      }
      if (url.includes("/messages/msg-1")) {
        return {
          ok: true,
          async json() {
            return {
              labelIds: ["INBOX"],
              payload: {
                headers: [
                  { name: "Subject", value: "Hello" },
                  { name: "From", value: "sender@example.com" },
                  { name: "Date", value: "Sun, 19 Apr 2026 10:00:00 GMT" }
                ]
              }
            };
          }
        };
      }
      throw new Error(`unexpected fetch url: ${url}`);
    }
  });
  assert.equal(result.success, true);
  assert.equal(result.metadata.connector_status, "success");
  assert.equal(result.metadata.result_kind, "record_list");
  assert.equal(result.metadata.record_type, "email");
  assert.equal(result.metadata.record_count, 1);
  assert.deepEqual(result.metadata.synthesis_affordances, ["summarize_collection", "extract_action_items"]);
  assert.equal(result.metadata.emails[0].subject, "Hello");
  assert.equal(result.metadata.account.email, "tool-g@example.com");
  assert.equal(result.observation.includes("Hello"), true);
  assert.equal(result.observation.includes("tool-g@example.com"), true);
  assert.equal(getAccountById(runtime, account.id).lastUsedAt !== null, true);

  const accounts = await ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL.execute({ provider: "google" }, { runtime });
  assert.equal(accounts.success, true);
  assert.equal(accounts.metadata.accounts.length, 1);
  assert.equal(accounts.metadata.accounts[0].email, "tool-g@example.com");
  assert.equal(accounts.observation.includes("tool-g@example.com"), true);
}

async function runWriteToolCases() {
  const runtime = createRuntime(createInMemoryStoreScaffold());
  const account = upsertConnectedAccount(runtime, {
    provider: "microsoft",
    providerAccountId: "write-m",
    email: "writer@example.com",
    scopes: ["Mail.Send", "Files.ReadWrite", "Calendars.ReadWrite"],
    capabilities: microsoftScopesToCapabilities(["Mail.Send", "Files.ReadWrite", "Calendars.ReadWrite"])
  });
  saveOAuthTokenRecord(runtime, {
    accountId: account.id,
    accessTokenEncrypted: "write-access",
    refreshTokenEncrypted: "write-refresh",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scopes: account.scopes
  });

  const risk = evaluateToolRisk(ACCOUNT_SEND_EMAIL_TOOL, {
    accountId: account.id,
    to: ["ops@example.com"],
    subject: "Check",
    body: "Hello"
  }, {});
  assert.equal(risk.risk_level, "high");
  assert.equal(risk.requires_confirmation, true);

  const send = await ACCOUNT_SEND_EMAIL_TOOL.execute({
    accountId: account.id,
    to: ["ops@example.com"],
    subject: "Check",
    body: "Hello"
  }, {
    runtime,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://graph.microsoft.com/v1.0/me/sendMail");
      assert.equal(options.headers.Authorization, "Bearer write-access");
      const payload = JSON.parse(options.body);
      assert.equal(payload.message.subject, "Check");
      return { ok: true, async json() { return {}; } };
    }
  });
  assert.equal(send.success, true);

  const uploadPath = path.join(tmpRoot, "upload.txt");
  await writeFile(uploadPath, "upload body", "utf8");
  const upload = await ACCOUNT_UPLOAD_FILE_TOOL.execute({
    accountId: account.id,
    localPath: uploadPath,
    newFileName: "uploaded.txt"
  }, {
    runtime,
    fetchImpl: async (url, options) => {
      assert.equal(url.includes("/me/drive/root:/uploaded.txt:/content"), true);
      assert.equal(options.method, "PUT");
      return {
        ok: true,
        async json() {
          return { id: "file-1", name: "uploaded.txt", webUrl: "https://example.com/file" };
        }
      };
    }
  });
  assert.equal(upload.success, true);
  assert.equal(upload.metadata.file.id, "file-1");

  const event = await ACCOUNT_CREATE_EVENT_TOOL.execute({
    accountId: account.id,
    title: "Planning",
    startTime: "2026-04-20T10:00:00",
    endTime: "2026-04-20T10:30:00",
    attendees: ["ops@example.com"]
  }, {
    runtime,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://graph.microsoft.com/v1.0/me/events");
      const payload = JSON.parse(options.body);
      assert.equal(payload.subject, "Planning");
      return {
        ok: true,
        async json() {
          return { id: "event-1", subject: "Planning", webLink: "https://example.com/event" };
        }
      };
    }
  });
  assert.equal(event.success, true);
  assert.equal(event.metadata.event.id, "event-1");
}

await rm(tmpRoot, { recursive: true, force: true });
await mkdir(tmpRoot, { recursive: true });

assert.equal(googleScopesToCapabilities(["https://www.googleapis.com/auth/calendar"]).calendarWrite, true);
// UCA-096 follow-up: calendar.events is the scope GOOGLE_SCOPES actually
// requests; it grants event read+write. Previously this scope produced
// calendarWrite:false because the mapper only matched the broader
// /auth/calendar scope, which made every calendar-write request fail with
// "缺少 calendarWrite 能力".
assert.equal(
  googleScopesToCapabilities(["https://www.googleapis.com/auth/calendar.events"]).calendarWrite,
  true
);
assert.equal(
  googleScopesToCapabilities(["https://www.googleapis.com/auth/calendar.events"]).calendarRead,
  true
);
// calendar.readonly must NOT imply write.
assert.equal(
  googleScopesToCapabilities(["https://www.googleapis.com/auth/calendar.readonly"]).calendarWrite,
  false
);
assert.equal(microsoftScopesToCapabilities(["Files.Read"]).fileWrite, false);
assert.equal(microsoftScopesToCapabilities(["Files.Read.All"]).fileRead, true);

await runRegistryCases(createInMemoryStoreScaffold());

const sqlitePath = path.join(tmpRoot, "connectors.sqlite");
const sqliteStore = createSqliteStore({ dbPath: sqlitePath });
try {
  await runRegistryCases(sqliteStore);
} finally {
  sqliteStore.close();
}

await runTokenRefreshCases();
await runLegacyMigrationCase();
runRouterCases();
await runReadToolCase();
await runWriteToolCases();

console.log("Unified connectors verification passed.");
