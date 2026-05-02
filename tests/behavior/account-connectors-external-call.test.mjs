import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getValidAccessToken } from "../../src/service/connectors/account-connectors.mjs";

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
