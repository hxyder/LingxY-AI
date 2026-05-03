import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleConfigProviderRoute } from "../../src/service/core/http-routes/config-provider-routes.mjs";
import { tryHandleConnectorRoute } from "../../src/service/core/http-routes/connector-routes.mjs";
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

function makePluginRuntime() {
  const calls = [];
  const plugins = [{ id: "demo", enabled: true }];
  return {
    calls,
    pluginRegistry: {
      list() {
        calls.push({ method: "list" });
        return plugins;
      },
      async install(body) {
        calls.push({ method: "install", body });
        return { id: "installed", enabled: true };
      },
      async uninstall(pluginId) {
        calls.push({ method: "uninstall", pluginId });
        return { id: pluginId };
      },
      setEnabled(pluginId, enabled) {
        calls.push({ method: "setEnabled", pluginId, enabled });
        return { id: pluginId, enabled };
      },
      reload() {
        calls.push({ method: "reload" });
      }
    }
  };
}

async function pluginRoute({ method, pathname, actor = "desktop_console", body = {}, runtime = makePluginRuntime() }) {
  const response = captureResponse();
  const handled = await tryHandleConnectorRoute({
    request: jsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
    response,
    method,
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime
  });
  return {
    handled,
    statusCode: response.statusCode,
    payload: parsePayload(response),
    runtime
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

test("plugin mutation routes reject unknown desktop actors before registry calls", async () => {
  const cases = [
    { method: "POST", pathname: "/plugins/install", body: { sourcePath: "E:/plugins/demo" } },
    { method: "DELETE", pathname: "/plugins/demo" },
    { method: "PATCH", pathname: "/plugins/demo/enabled", body: { enabled: false } },
    { method: "POST", pathname: "/plugins/reload" }
  ];

  for (const entry of cases) {
    const result = await pluginRoute({
      ...entry,
      actor: "desktop_consoel"
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(result.runtime.calls, [], `${entry.method} ${entry.pathname} must not touch registry`);
  }
});

test("plugin mutation routes allow trusted desktop actors", async () => {
  const install = await pluginRoute({
    method: "POST",
    pathname: "/plugins/install",
    actor: "desktop_console",
    body: { sourcePath: "E:/plugins/demo" }
  });
  assert.equal(install.statusCode, 200);
  assert.deepEqual(install.runtime.calls, [
    { method: "install", body: { sourcePath: "E:/plugins/demo" } }
  ]);

  const toggle = await pluginRoute({
    method: "PATCH",
    pathname: "/plugins/demo/enabled",
    actor: "desktop_overlay",
    body: { enabled: false }
  });
  assert.equal(toggle.statusCode, 200);
  assert.deepEqual(toggle.runtime.calls, [
    { method: "setEnabled", pluginId: "demo", enabled: false }
  ]);
});
