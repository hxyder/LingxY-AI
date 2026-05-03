import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleConfigProviderRoute } from "../../src/service/core/http-routes/config-provider-routes.mjs";
import { tryHandleRuntimeAdminRoute } from "../../src/service/core/http-routes/runtime-admin-routes.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function jsonRequest(body, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body ?? {}), "utf8")]);
  request.headers = headers;
  return request;
}

function captureResponse() {
  return {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    }
  };
}

function parsePayload(response) {
  return response.body ? JSON.parse(response.body) : null;
}

function makeConfigRuntime() {
  const patches = [];
  return {
    patches,
    configStore: {
      load() {
        return {};
      },
      patch(value) {
        patches.push(value);
      },
      save(value) {
        patches.push(value);
      }
    }
  };
}

async function postConfigRoute({ pathname, body = {}, actor = "desktop_console", runtime = makeConfigRuntime() }) {
  const response = captureResponse();
  const headers = actor ? { [ACTOR_HEADER]: actor } : {};
  const handled = await tryHandleConfigProviderRoute({
    request: jsonRequest(body, headers),
    response,
    method: "POST",
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime,
    saveRuntimeConfig(targetRuntime, updater) {
      targetRuntime.configStore.save(updater(targetRuntime.configStore.load()));
    }
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response),
    runtime
  };
}

async function postApprovalReject({ actor = "desktop_console", body = {} } = {}) {
  const calls = [];
  const response = captureResponse();
  const handled = await tryHandleRuntimeAdminRoute({
    request: jsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method: "POST",
    url: new URL("http://127.0.0.1/approvals/appr_guard_test/reject"),
    runtime: {
      scheduler: {
        rejectPendingApproval(approvalId, options) {
          calls.push({ approvalId, options });
          return {
            approval_id: approvalId,
            status: "rejected",
            decided_by: options.actor,
            reason: options.reason ?? null
          };
        }
      }
    }
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response),
    calls
  };
}

test("local mutation guard rejects misspelled desktop actors before mutating config", async () => {
  const result = await postConfigRoute({
    pathname: "/config/output",
    actor: "desktop_consoel",
    body: { defaultDir: "E:/linxiDoc" }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(result.runtime.patches, []);
});

test("console-only config mutations reject other trusted desktop surfaces", async () => {
  const blocked = await postConfigRoute({
    pathname: "/config/output",
    actor: "desktop_overlay",
    body: { defaultDir: "E:/linxiDoc" }
  });
  assert.equal(blocked.statusCode, 403);
  assert.deepEqual(blocked.runtime.patches, []);

  const allowed = await postConfigRoute({
    pathname: "/config/output",
    actor: "desktop_console",
    body: { defaultDir: "E:/linxiDoc", autoCreateDirs: false }
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.payload.ok, true);
  assert.deepEqual(allowed.runtime.patches, [
    { output: { defaultDir: "E:/linxiDoc", autoCreateDirs: false } }
  ]);
});

test("approval mutation routes trust the desktop actor header over any body actor", async () => {
  const result = await postApprovalReject({
    actor: "desktop_overlay",
    body: {
      actor: "forged_body_actor",
      reason: "not_needed"
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].approvalId, "appr_guard_test");
  assert.equal(result.calls[0].options.actor, "desktop_overlay");
  assert.equal(result.payload.approval.decided_by, "desktop_overlay");
  assert.equal(result.payload.approval.reason, "not_needed");
});

test("approval mutation routes reject unknown desktop actors before scheduler calls", async () => {
  const result = await postApprovalReject({
    actor: "desktop_consoel",
    body: { reason: "not_needed" }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(result.calls, []);
});
