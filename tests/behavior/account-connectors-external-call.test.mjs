import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  completeOAuthCallback,
  getConnectorStatus,
  getValidAccessToken,
  listFiles,
  listEmails,
  listCalendarEvents,
  startGoogleAuth,
  startMicrosoftAuth
} from "../../src/service/connectors/account-connectors.mjs";

async function withTokenRuntime(type, tokens, connectorConfig, fn) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "uca-account-connectors-"));
  const tokenPath = path.join(dataDir, "account-tokens.json");
  await mkdir(path.dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, JSON.stringify({ [`${type}:tokens`]: tokens }, null, 2), "utf8");

  const runtime = {
    paths: { dataDir },
    configStore: {
      load() {
        return { connectors: { [type]: connectorConfig } };
      }
    }
  };

  try {
    return await fn({ runtime, tokenPath });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("account connector Microsoft refresh retries a transient token endpoint failure", async () => {
  await withTokenRuntime(
    "microsoft",
    {
      access_token: "expired-token",
      refresh_token: "refresh-token",
      expires_at: Date.now() - 10_000
    },
    { clientId: "microsoft-client-id" },
    async ({ runtime, tokenPath }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            body: String(init.body),
            contentType: init.headers["Content-Type"],
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary token endpoint failure", { status: 502 });
          }
          return Response.json({
            access_token: "fresh-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600
          });
        };

        const accessToken = await getValidAccessToken(runtime, "microsoft");

        assert.equal(accessToken, "fresh-token");
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
        assert.match(calls[0].body, /grant_type=refresh_token/);
        assert.match(calls[0].body, /client_id=microsoft-client-id/);
        assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);

        const saved = JSON.parse(await readFile(tokenPath, "utf8"));
        assert.equal(saved["microsoft:tokens"].access_token, "fresh-token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Google refresh retries a transient token endpoint failure", async () => {
  await withTokenRuntime(
    "google",
    {
      access_token: "expired-token",
      refresh_token: "google-refresh-token",
      expires_at: Date.now() - 10_000
    },
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime, tokenPath }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            body: String(init.body),
            contentType: init.headers["Content-Type"],
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary token endpoint failure", { status: 502 });
          }
          return Response.json({
            access_token: "fresh-google-token",
            expires_in: 3600
          });
        };

        const accessToken = await getValidAccessToken(runtime, "google");

        assert.equal(accessToken, "fresh-google-token");
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
        assert.match(calls[0].body, /grant_type=refresh_token/);
        assert.match(calls[0].body, /client_id=google-client-id/);
        assert.match(calls[0].body, /client_secret=google-client-secret/);
        assert.equal(calls[0].contentType, "application/x-www-form-urlencoded");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);

        const saved = JSON.parse(await readFile(tokenPath, "utf8"));
        assert.equal(saved["google:tokens"].access_token, "fresh-google-token");
        assert.equal(saved["google:tokens"].refresh_token, "google-refresh-token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Microsoft OAuth callback retries a transient token exchange failure", async () => {
  const auth = startMicrosoftAuth("microsoft-client-id");

  await withTokenRuntime(
    "microsoft",
    {},
    { clientId: "microsoft-client-id" },
    async ({ runtime, tokenPath }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            body: String(init.body ?? ""),
            contentType: init.headers?.["Content-Type"] ?? null,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (String(url).includes("/oauth2/v2.0/token")) {
            if (calls.filter((call) => String(call.url).includes("/oauth2/v2.0/token")).length === 1) {
              return new Response("temporary token exchange failure", { status: 502 });
            }
            return Response.json({
              access_token: "callback-access-token",
              refresh_token: "callback-refresh-token",
              scope: "openid profile email User.Read",
              expires_in: 3600
            });
          }
          return Response.json({
            id: "microsoft-user-id",
            displayName: "Test User",
            mail: "test@example.com"
          });
        };

        const result = await completeOAuthCallback(runtime, "auth-code", auth.state);

        const tokenCalls = calls.filter((call) => String(call.url).includes("/oauth2/v2.0/token"));
        assert.equal(result.ok, true);
        assert.equal(result.type, "microsoft");
        assert.equal(tokenCalls.length, 2);
        assert.equal(tokenCalls[0].url, "https://login.microsoftonline.com/common/oauth2/v2.0/token");
        assert.match(tokenCalls[0].body, /grant_type=authorization_code/);
        assert.match(tokenCalls[0].body, /client_id=microsoft-client-id/);
        assert.match(tokenCalls[0].body, /code=auth-code/);
        assert.equal(tokenCalls[0].contentType, "application/x-www-form-urlencoded");
        assert.equal(tokenCalls.every((call) => call.hasAbortSignal), true);

        const saved = JSON.parse(await readFile(tokenPath, "utf8"));
        assert.equal(saved["microsoft:tokens"].access_token, "callback-access-token");
        assert.equal(saved["microsoft:tokens"].refresh_token, "callback-refresh-token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Google OAuth callback retries a transient token exchange failure", async () => {
  const auth = startGoogleAuth("google-client-id");

  await withTokenRuntime(
    "google",
    {},
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime, tokenPath }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            body: String(init.body ?? ""),
            contentType: init.headers?.["Content-Type"] ?? null,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (String(url) === "https://oauth2.googleapis.com/token") {
            if (calls.filter((call) => String(call.url) === "https://oauth2.googleapis.com/token").length === 1) {
              return new Response("temporary token exchange failure", { status: 502 });
            }
            return Response.json({
              access_token: "callback-google-access-token",
              refresh_token: "callback-google-refresh-token",
              scope: "openid email profile",
              expires_in: 3600
            });
          }
          return Response.json({
            id: "google-user-id",
            name: "Google User",
            email: "google@example.com"
          });
        };

        const result = await completeOAuthCallback(runtime, "google-auth-code", auth.state);

        const tokenCalls = calls.filter((call) => String(call.url) === "https://oauth2.googleapis.com/token");
        assert.equal(result.ok, true);
        assert.equal(result.type, "google");
        assert.equal(tokenCalls.length, 2);
        assert.equal(tokenCalls[0].url, "https://oauth2.googleapis.com/token");
        assert.match(tokenCalls[0].body, /grant_type=authorization_code/);
        assert.match(tokenCalls[0].body, /client_id=google-client-id/);
        assert.match(tokenCalls[0].body, /client_secret=google-client-secret/);
        assert.match(tokenCalls[0].body, /code=google-auth-code/);
        assert.equal(tokenCalls[0].contentType, "application/x-www-form-urlencoded");
        assert.equal(tokenCalls.every((call) => call.hasAbortSignal), true);

        const saved = JSON.parse(await readFile(tokenPath, "utf8"));
        assert.equal(saved["google:tokens"].access_token, "callback-google-access-token");
        assert.equal(saved["google:tokens"].refresh_token, "callback-google-refresh-token");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Microsoft user info retries a transient profile endpoint failure", async () => {
  await withTokenRuntime(
    "microsoft",
    {
      access_token: "profile-access-token",
      refresh_token: "profile-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "microsoft-client-id" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary profile endpoint failure", { status: 502 });
          }
          return Response.json({
            id: "profile-user-id",
            displayName: "Profile User",
            mail: "profile@example.com"
          });
        };

        const status = await getConnectorStatus(runtime, "microsoft");

        assert.equal(status.connected, true);
        assert.equal(status.email, "profile@example.com");
        assert.equal(status.displayName, "Profile User");
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName");
        assert.equal(calls[0].authorization, "Bearer profile-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Google user info retries a transient profile endpoint failure", async () => {
  await withTokenRuntime(
    "google",
    {
      access_token: "google-profile-access-token",
      refresh_token: "google-profile-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary profile endpoint failure", { status: 502 });
          }
          return Response.json({
            id: "google-profile-user-id",
            name: "Google Profile User",
            email: "google-profile@example.com",
            picture: "https://example.com/profile.png"
          });
        };

        const status = await getConnectorStatus(runtime, "google");

        assert.equal(status.connected, true);
        assert.equal(status.email, "google-profile@example.com");
        assert.equal(status.displayName, "Google Profile User");
        assert.equal(status.photoUrl, "https://example.com/profile.png");
        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, "https://www.googleapis.com/oauth2/v2/userinfo");
        assert.equal(calls[0].authorization, "Bearer google-profile-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Microsoft files retries a transient Drive endpoint failure", async () => {
  await withTokenRuntime(
    "microsoft",
    {
      access_token: "files-access-token",
      refresh_token: "files-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "microsoft-client-id" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary drive endpoint failure", { status: 502 });
          }
          return Response.json({
            value: [{
              id: "file-1",
              name: "Plan.docx",
              webUrl: "https://example.com/plan",
              lastModifiedDateTime: "2026-05-01T12:00:00Z",
              size: 42,
              file: {}
            }]
          });
        };

        const result = await listFiles(runtime, "microsoft", { limit: 2 });

        assert.equal(result.ok, true);
        assert.equal(result.files.length, 1);
        assert.deepEqual(result.files[0], {
          id: "file-1",
          name: "Plan.docx",
          url: "https://example.com/plan",
          modified: "2026-05-01T12:00:00Z",
          size: 42,
          isFolder: false
        });
        assert.equal(calls.length, 2);
        assert.equal(
          calls[0].url,
          "https://graph.microsoft.com/v1.0/me/drive/root/children?$top=2&$orderby=lastModifiedDateTime desc&$select=name,id,webUrl,lastModifiedDateTime,size,file"
        );
        assert.equal(calls[0].authorization, "Bearer files-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Google files retries a transient Drive endpoint failure", async () => {
  await withTokenRuntime(
    "google",
    {
      access_token: "google-files-access-token",
      refresh_token: "google-files-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary drive endpoint failure", { status: 502 });
          }
          return Response.json({
            files: [{
              id: "gfile-1",
              name: "Roadmap Sheet",
              webViewLink: "https://example.com/sheet",
              modifiedTime: "2026-05-01T13:00:00Z",
              size: "128",
              mimeType: "application/vnd.google-apps.spreadsheet"
            }]
          });
        };

        const result = await listFiles(runtime, "google", { limit: 2 });

        assert.equal(result.ok, true);
        assert.equal(result.files.length, 1);
        assert.deepEqual(result.files[0], {
          id: "gfile-1",
          name: "Roadmap Sheet",
          url: "https://example.com/sheet",
          modified: "2026-05-01T13:00:00Z",
          size: "128",
          isFolder: false
        });
        assert.equal(calls.length, 2);
        assert.match(String(calls[0].url), /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\?/);
        assert.match(String(calls[0].url), /pageSize=2/);
        assert.match(String(calls[0].url), /orderBy=modifiedTime\+desc/);
        assert.equal(calls[0].authorization, "Bearer google-files-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Microsoft emails retries a transient mail endpoint failure", async () => {
  await withTokenRuntime(
    "microsoft",
    {
      access_token: "mail-access-token",
      refresh_token: "mail-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "microsoft-client-id" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary mail endpoint failure", { status: 502 });
          }
          return Response.json({
            value: [{
              id: "mail-1",
              subject: "Status",
              from: { emailAddress: { address: "sender@example.com", name: "Sender" } },
              receivedDateTime: "2026-05-01T14:00:00Z",
              bodyPreview: "All good",
              isRead: false
            }]
          });
        };

        const result = await listEmails(runtime, "microsoft", { limit: 3 });

        assert.equal(result.ok, true);
        assert.equal(result.emails.length, 1);
        assert.deepEqual(result.emails[0], {
          id: "mail-1",
          subject: "Status",
          from: "sender@example.com",
          fromName: "Sender",
          received: "2026-05-01T14:00:00Z",
          preview: "All good",
          isRead: false
        });
        assert.equal(calls.length, 2);
        assert.equal(
          calls[0].url,
          "https://graph.microsoft.com/v1.0/me/messages?$top=3&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,isRead"
        );
        assert.equal(calls[0].authorization, "Bearer mail-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Gmail list retries a transient message-list endpoint failure", async () => {
  await withTokenRuntime(
    "google",
    {
      access_token: "gmail-access-token",
      refresh_token: "gmail-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      let listAttempts = 0;
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (String(url).includes("/gmail/v1/users/me/messages?")) {
            listAttempts += 1;
            if (listAttempts === 1) {
              return new Response("temporary gmail list endpoint failure", { status: 502 });
            }
            return Response.json({ messages: [{ id: "gmail-1" }] });
          }
          if (String(url).includes("/gmail/v1/users/me/messages/gmail-1?")) {
            return Response.json({
              labelIds: ["INBOX"],
              payload: {
                headers: [
                  { name: "Subject", value: "Gmail Status" },
                  { name: "From", value: "sender@example.com" },
                  { name: "Date", value: "Fri, 01 May 2026 14:00:00 GMT" }
                ]
              }
            });
          }
          return new Response("unexpected url", { status: 404 });
        };

        const result = await listEmails(runtime, "google", { limit: 2 });

        const listCalls = calls.filter((call) => String(call.url).includes("/gmail/v1/users/me/messages?"));
        assert.equal(result.ok, true);
        assert.deepEqual(result.emails, [{
          id: "gmail-1",
          subject: "Gmail Status",
          from: "sender@example.com",
          received: "Fri, 01 May 2026 14:00:00 GMT",
          isRead: true
        }]);
        assert.equal(listCalls.length, 2);
        assert.match(String(listCalls[0].url), /maxResults=2/);
        assert.match(String(listCalls[0].url), /labelIds=INBOX/);
        assert.equal(listCalls[0].authorization, "Bearer gmail-access-token");
        assert.equal(listCalls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Microsoft calendar retries a transient events endpoint failure", async () => {
  await withTokenRuntime(
    "microsoft",
    {
      access_token: "calendar-access-token",
      refresh_token: "calendar-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "microsoft-client-id" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary calendar endpoint failure", { status: 502 });
          }
          return Response.json({
            value: [{
              id: "event-1",
              subject: "Planning",
              start: { dateTime: "2026-05-02T15:00:00" },
              end: { dateTime: "2026-05-02T16:00:00" },
              organizer: { emailAddress: { name: "Organizer" } },
              location: { displayName: "Room 1" }
            }]
          });
        };

        const result = await listCalendarEvents(runtime, "microsoft", { limit: 4 });

        assert.equal(result.ok, true);
        assert.equal(result.events.length, 1);
        assert.deepEqual(result.events[0], {
          id: "event-1",
          title: "Planning",
          start: "2026-05-02T15:00:00",
          end: "2026-05-02T16:00:00",
          organizer: "Organizer",
          location: "Room 1"
        });
        assert.equal(calls.length, 2);
        assert.match(String(calls[0].url), /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/events\?/);
        assert.match(String(calls[0].url), /\$top=4/);
        assert.match(String(calls[0].url), /\$orderby=start\/dateTime/);
        assert.equal(calls[0].authorization, "Bearer calendar-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});

test("account connector Google calendar retries a transient events endpoint failure", async () => {
  await withTokenRuntime(
    "google",
    {
      access_token: "google-calendar-access-token",
      refresh_token: "google-calendar-refresh-token",
      expires_at: Date.now() + 3600_000
    },
    { clientId: "google-client-id", clientSecret: "google-client-secret" },
    async ({ runtime }) => {
      const originalFetch = globalThis.fetch;
      const calls = [];
      try {
        globalThis.fetch = async (url, init = {}) => {
          calls.push({
            url,
            authorization: init.headers?.Authorization ?? null,
            hasAbortSignal: Boolean(init.signal)
          });
          if (calls.length === 1) {
            return new Response("temporary calendar endpoint failure", { status: 502 });
          }
          return Response.json({
            items: [{
              id: "gevent-1",
              summary: "Google Planning",
              start: { dateTime: "2026-05-03T15:00:00" },
              end: { dateTime: "2026-05-03T16:00:00" },
              organizer: { displayName: "Google Organizer", email: "organizer@example.com" },
              location: "Meet"
            }]
          });
        };

        const result = await listCalendarEvents(runtime, "google", { limit: 4 });

        assert.equal(result.ok, true);
        assert.equal(result.events.length, 1);
        assert.deepEqual(result.events[0], {
          id: "gevent-1",
          title: "Google Planning",
          start: "2026-05-03T15:00:00",
          end: "2026-05-03T16:00:00",
          organizer: "Google Organizer",
          location: "Meet"
        });
        assert.equal(calls.length, 2);
        assert.match(String(calls[0].url), /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\?/);
        assert.match(String(calls[0].url), /maxResults=4/);
        assert.match(String(calls[0].url), /singleEvents=true/);
        assert.match(String(calls[0].url), /orderBy=startTime/);
        assert.equal(calls[0].authorization, "Bearer google-calendar-access-token");
        assert.equal(calls.every((call) => call.hasAbortSignal), true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );
});
