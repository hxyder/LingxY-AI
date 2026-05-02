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
