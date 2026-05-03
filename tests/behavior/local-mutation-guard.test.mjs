import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleConfigProviderRoute } from "../../src/service/core/http-routes/config-provider-routes.mjs";
import { tryHandleConnectorRoute } from "../../src/service/core/http-routes/connector-routes.mjs";
import { tryHandleRuntimeAdminRoute } from "../../src/service/core/http-routes/runtime-admin-routes.mjs";
import { tryHandleTaskRoute } from "../../src/service/core/http-routes/task-routes.mjs";

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

function makeEmailAccountRuntime(initialConfig = {}) {
  const calls = [];
  let config = initialConfig;
  return {
    calls,
    paths: {},
    configStore: {
      load() {
        calls.push({ method: "config.load" });
        return config;
      },
      save(value) {
        calls.push({ method: "config.save", value });
        config = value;
      }
    }
  };
}

function makeEmailDigestRuntime(initialConfig = {}) {
  const calls = [];
  return {
    calls,
    configStore: {
      load() {
        calls.push({ method: "config.load" });
        return initialConfig;
      }
    }
  };
}

function makeSkillRuntime({ skillsDir, skillPatternsPath, config = {} } = {}) {
  const calls = [];
  return {
    calls,
    paths: {
      skillsDir,
      skillPatternsPath
    },
    configStore: {
      load() {
        calls.push({ method: "config.load" });
        return config;
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

async function configProviderRoute({
  method,
  pathname,
  body = {},
  actor = "desktop_console",
  runtime = makeConfigRuntime()
}) {
  const response = captureResponse();
  const headers = actor ? { [ACTOR_HEADER]: actor } : {};
  const handled = await tryHandleConfigProviderRoute({
    request: jsonRequest(body, headers),
    response,
    method,
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

function makeConnectorAccountRuntime() {
  const calls = [];
  const config = {};
  const account = {
    id: "acct_demo",
    provider: "google",
    providerAccountId: "google-user",
    email: "demo@example.com",
    displayName: "Demo",
    scopes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  return {
    calls,
    configStore: {
      load() {
        calls.push({ method: "config.load" });
        return config;
      },
      save(next) {
        calls.push({ method: "config.save", value: next });
      }
    },
    store: {
      getConnectedAccount(accountId) {
        calls.push({ method: "store.getConnectedAccount", accountId });
        return accountId === account.id ? account : null;
      },
      listConnectedAccounts() {
        calls.push({ method: "store.listConnectedAccounts" });
        return [account];
      },
      upsertConnectedAccount(next) {
        calls.push({ method: "store.upsertConnectedAccount", account: next });
        return next;
      },
      deleteConnectedAccount(accountId) {
        calls.push({ method: "store.deleteConnectedAccount", accountId });
        return accountId === account.id ? account : null;
      },
      deleteOAuthToken(accountId) {
        calls.push({ method: "store.deleteOAuthToken", accountId });
      }
    }
  };
}

async function connectorAccountRoute({
  method,
  pathname,
  actor = "desktop_console",
  body = {},
  runtime = makeConnectorAccountRuntime()
}) {
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

function makeTaskControlRuntime() {
  const calls = [];
  const task = {
    task_id: "task_demo",
    status: "running",
    sub_status: "running",
    progress: 0,
    user_command: "demo task",
    context_packet: {
      source_type: "clipboard",
      source_app: "test",
      capture_mode: "manual",
      text: "demo",
      selection_metadata: {}
    },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
  };
  return {
    calls,
    activeExecutions: new Map(),
    paths: {},
    queue: {
      markFinished(taskId) {
        calls.push({ method: "queue.markFinished", taskId });
      }
    },
    eventBus: {
      publish(event) {
        calls.push({ method: "eventBus.publish", eventType: event.event_type });
      }
    },
    store: {
      getTask(taskId) {
        calls.push({ method: "store.getTask", taskId });
        return taskId === task.task_id && task.deleted !== true ? task : null;
      },
      updateTask(taskId, next) {
        calls.push({ method: "store.updateTask", taskId, status: next.status, subStatus: next.sub_status });
        Object.assign(task, next);
      },
      appendEvent(event) {
        calls.push({ method: "store.appendEvent", eventType: event.event_type });
      },
      deleteTask(taskId) {
        calls.push({ method: "store.deleteTask", taskId });
        if (taskId === task.task_id) task.deleted = true;
      }
    }
  };
}

async function taskControlRoute({
  method,
  pathname,
  actor = "desktop_console",
  body = {},
  runtime = makeTaskControlRuntime()
}) {
  const response = captureResponse();
  const handled = await tryHandleTaskRoute({
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

test("email account credential mutations reject non-console actors before local state changes", async () => {
  const cases = [
    { method: "POST", pathname: "/config/email/accounts", body: { id: "demo", email: "demo@example.com" } },
    { method: "DELETE", pathname: "/config/email/accounts/demo" }
  ];

  for (const entry of cases) {
    const runtime = makeEmailAccountRuntime({
      email: {
        accounts: [
          {
            id: "demo",
            email: "demo@example.com",
            provider: "imap"
          }
        ]
      }
    });
    const result = await configProviderRoute({
      ...entry,
      actor: "desktop_overlay",
      runtime
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(runtime.calls, [], `${entry.method} ${entry.pathname} must not touch email config`);
  }
});

test("email account credential mutations allow the console actor", async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "uca-email-guard-"));
  t.after(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  const saveRuntime = makeEmailAccountRuntime();
  saveRuntime.paths.dataDir = dataDir;
  const save = await configProviderRoute({
    method: "POST",
    pathname: "/config/email/accounts",
    actor: "desktop_console",
    runtime: saveRuntime,
    body: {
      id: "demo",
      email: "demo@example.com",
      displayName: "Demo Mail",
      provider: "imap",
      credentials: null
    }
  });
  assert.equal(save.statusCode, 200);
  assert.equal(save.payload.account.id, "demo");
  assert.equal(save.payload.account.email, "demo@example.com");
  assert.equal(saveRuntime.calls[0].method, "config.load");
  assert.equal(saveRuntime.calls[1].method, "config.save");
  assert.deepEqual(saveRuntime.calls[1].value.email.accounts.map((account) => account.id), ["demo"]);

  const deleteRuntime = makeEmailAccountRuntime({
    email: {
      accounts: [
        {
          id: "demo",
          email: "demo@example.com",
          provider: "imap"
        }
      ]
    }
  });
  deleteRuntime.paths.dataDir = dataDir;
  const deletion = await configProviderRoute({
    method: "DELETE",
    pathname: "/config/email/accounts/demo",
    actor: "desktop_console",
    runtime: deleteRuntime
  });
  assert.equal(deletion.statusCode, 200);
  assert.equal(deletion.payload.deleted, "demo");
  assert.equal(deleteRuntime.calls[0].method, "config.load");
  assert.equal(deleteRuntime.calls[1].method, "config.save");
  assert.deepEqual(deleteRuntime.calls[1].value.email.accounts, []);
});

test("email digest manual check requires console or shell actor before reading local config", async () => {
  const blockedRuntime = makeEmailDigestRuntime({
    features: { morning_digest: { enabled: false } }
  });
  const blocked = await configProviderRoute({
    method: "POST",
    pathname: "/email/digest/check",
    actor: "desktop_overlay",
    runtime: blockedRuntime,
    body: { force: true }
  });
  assert.equal(blocked.handled, true);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.payload.error, "desktop_actor_required");
  assert.deepEqual(blockedRuntime.calls, []);

  for (const actor of ["desktop_console", "desktop_shell"]) {
    const runtime = makeEmailDigestRuntime({
      features: { morning_digest: { enabled: false } }
    });
    const allowed = await configProviderRoute({
      method: "POST",
      pathname: "/email/digest/check",
      actor,
      runtime,
      body: {}
    });
    assert.equal(allowed.statusCode, 200, `${actor} should be allowed`);
    assert.equal(allowed.payload.reason, "feature_disabled");
    assert.deepEqual(runtime.calls, [
      { method: "config.load" },
      { method: "config.load" }
    ]);
  }
});

test("skills file mutation routes reject disallowed actors before local file writes", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-skills-guard-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const skillsDir = path.join(tempRoot, "skills");
  const skillPatternsPath = path.join(tempRoot, "skill-patterns.json");
  await mkdir(path.join(skillsDir, "editable"), { recursive: true });
  const editablePath = path.join(skillsDir, "editable", "SKILL.md");
  await writeFile(editablePath, "# Original\n", "utf8");

  const saveRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const blockedSave = await configProviderRoute({
    method: "POST",
    pathname: "/skills/save",
    actor: "browser_page",
    runtime: saveRuntime,
    body: {
      patternKey: "tool_a,tool_b",
      tools: ["tool_a", "tool_b"],
      examples: [{ command: "demo" }],
      suggestedId: "blocked-skill",
      suggestedName: "Blocked Skill"
    }
  });
  assert.equal(blockedSave.statusCode, 403);
  assert.equal(blockedSave.payload.error, "desktop_actor_required");
  await assert.rejects(readFile(path.join(skillsDir, "blocked-skill", "SKILL.md"), "utf8"), /ENOENT/);

  const writeRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const blockedWrite = await configProviderRoute({
    method: "POST",
    pathname: "/skills/write",
    actor: "desktop_overlay",
    runtime: writeRuntime,
    body: {
      entryPath: editablePath,
      markdown: "# Mutated\n"
    }
  });
  assert.equal(blockedWrite.statusCode, 403);
  assert.equal(blockedWrite.payload.error, "desktop_actor_required");
  assert.deepEqual(writeRuntime.calls, []);
  assert.equal(await readFile(editablePath, "utf8"), "# Original\n");
});

test("skills file mutation routes allow their intended desktop actors", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-skills-guard-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const skillsDir = path.join(tempRoot, "skills");
  const skillPatternsPath = path.join(tempRoot, "skill-patterns.json");
  const saveRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const saved = await configProviderRoute({
    method: "POST",
    pathname: "/skills/save",
    actor: "desktop_overlay",
    runtime: saveRuntime,
    body: {
      patternKey: "tool_a,tool_b",
      tools: ["tool_a", "tool_b"],
      examples: [{ command: "demo" }],
      suggestedId: "demo-skill",
      suggestedName: "Demo Skill"
    }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.payload.skillId, "demo-skill");
  const savedMarkdown = await readFile(path.join(skillsDir, "demo-skill", "SKILL.md"), "utf8");
  assert.match(savedMarkdown, /# Demo Skill/);

  const editableDir = path.join(skillsDir, "editable");
  await mkdir(editableDir, { recursive: true });
  const editablePath = path.join(editableDir, "SKILL.md");
  await writeFile(editablePath, "# Original\n", "utf8");
  const writeRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const written = await configProviderRoute({
    method: "POST",
    pathname: "/skills/write",
    actor: "desktop_console",
    runtime: writeRuntime,
    body: {
      entryPath: editablePath,
      markdown: "# Updated\n"
    }
  });
  assert.equal(written.statusCode, 200);
  assert.equal(written.payload.entryPath, editablePath);
  assert.equal(await readFile(editablePath, "utf8"), "# Updated\n");
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

test("connector account mutation routes reject unknown desktop actors before local state changes", async () => {
  const cases = [
    { method: "PATCH", pathname: "/connectors/accounts/google/config", body: { clientId: "id" } },
    { method: "DELETE", pathname: "/connectors/accounts/google" },
    { method: "PATCH", pathname: "/connectors/connected-accounts/acct_demo", body: { displayName: "Renamed" } },
    { method: "PATCH", pathname: "/connectors/connected-accounts/acct_demo/defaults", body: { purpose: "email" } },
    { method: "DELETE", pathname: "/connectors/connected-accounts/acct_demo" }
  ];

  for (const entry of cases) {
    const result = await connectorAccountRoute({
      ...entry,
      actor: "browser_page"
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(result.runtime.calls, [], `${entry.method} ${entry.pathname} must not touch connector state`);
  }
});

test("connector account mutation routes allow trusted desktop actors", async () => {
  const config = await connectorAccountRoute({
    method: "PATCH",
    pathname: "/connectors/accounts/google/config",
    actor: "desktop_console",
    body: { clientId: "client-id", clientSecret: "secret" }
  });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.runtime.calls, [
    { method: "config.load" },
    {
      method: "config.save",
      value: {
        connectors: {
          google: {
            clientId: "client-id",
            clientSecret: "secret"
          }
        }
      }
    }
  ]);

  const rename = await connectorAccountRoute({
    method: "PATCH",
    pathname: "/connectors/connected-accounts/acct_demo",
    actor: "desktop_overlay",
    body: { displayName: "Renamed" }
  });
  assert.equal(rename.statusCode, 200);
  assert.equal(rename.payload.account.displayName, "Renamed");
  assert.equal(rename.runtime.calls[0].method, "store.getConnectedAccount");
  assert.equal(rename.runtime.calls[1].method, "store.getConnectedAccount");
  assert.equal(rename.runtime.calls[2].method, "store.upsertConnectedAccount");
});

test("task control routes reject unknown desktop actors before task state changes", async () => {
  const cases = [
    { method: "POST", pathname: "/task/task_demo/cancel", body: { force: true } },
    { method: "POST", pathname: "/task/task_demo/retry", body: { mode: "retry_same" } },
    { method: "DELETE", pathname: "/task/task_demo" }
  ];

  for (const entry of cases) {
    const result = await taskControlRoute({
      ...entry,
      actor: "browser_page"
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(result.runtime.calls, [], `${entry.method} ${entry.pathname} must not touch task state`);
  }
});

test("task control routes allow trusted desktop actors for cancel and delete", async () => {
  const cancel = await taskControlRoute({
    method: "POST",
    pathname: "/task/task_demo/cancel",
    actor: "desktop_overlay",
    body: { force: true }
  });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.payload.task.status, "cancelled");
  assert.ok(cancel.runtime.calls.some((entry) => entry.method === "store.updateTask" && entry.status === "cancelled"));
  assert.ok(cancel.runtime.calls.some((entry) => entry.method === "queue.markFinished"));

  const deletionRuntime = makeTaskControlRuntime();
  const deletion = await taskControlRoute({
    method: "DELETE",
    pathname: "/task/task_demo",
    actor: "desktop_console",
    runtime: deletionRuntime
  });
  assert.equal(deletion.statusCode, 200);
  assert.equal(deletion.payload.deleted, true);
  assert.ok(deletion.runtime.calls.some((entry) => entry.method === "store.deleteTask" && entry.taskId === "task_demo"));
});
