import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { tryHandleAudioRoute } from "../../src/service/core/http-routes/audio-routes.mjs";
import { tryHandleConfigProviderRoute } from "../../src/service/core/http-routes/config-provider-routes.mjs";
import { tryHandleConnectorRoute } from "../../src/service/core/http-routes/connector-routes.mjs";
import { tryHandleNoteProjectConversationRoute } from "../../src/service/core/http-routes/note-project-conversation-routes.mjs";
import { tryHandleOfficeRoute } from "../../src/service/core/http-routes/office-routes.mjs";
import { tryHandlePreviewFileRoute } from "../../src/service/core/http-routes/preview-file-routes.mjs";
import { tryHandleRuntimeAdminRoute } from "../../src/service/core/http-routes/runtime-admin-routes.mjs";
import { tryHandleTaskRoute } from "../../src/service/core/http-routes/task-routes.mjs";

const ACTOR_HEADER = "x-lingxy-desktop-actor";

function jsonRequest(body, headers = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body ?? {}), "utf8")]);
  request.headers = headers;
  return request;
}

function rawRequest(text, headers = {}) {
  const chunks = Array.isArray(text) ? text : [text ?? ""];
  const request = Readable.from(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "", "utf8")));
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
    flushHeaders() {},
    write(chunk = "") {
      this.body += chunk;
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
      softDeleteTask(taskId, options) {
        calls.push({ method: "store.softDeleteTask", taskId, options });
        if (taskId === task.task_id) task.deleted = true;
        return { ...task, deleted_at: "2026-01-01T00:00:00.000Z", deleted_by: options?.actor ?? null };
      },
      restoreTask(taskId, options) {
        calls.push({ method: "store.restoreTask", taskId, options });
        if (taskId === task.task_id) task.deleted = false;
        return { ...task, restored_at: "2026-01-01T00:00:00.000Z", restored_by: options?.actor ?? null };
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

function makeNotesRuntime() {
  const calls = [];
  const notes = [];
  return {
    calls,
    notesStore: {
      listNotes() {
        calls.push({ method: "notes.listNotes" });
        return notes;
      },
      saveNotes(nextNotes) {
        calls.push({ method: "notes.saveNotes", notes: nextNotes });
        notes.splice(0, notes.length, ...nextNotes);
        return notes;
      },
      upsertNote(note) {
        calls.push({ method: "notes.upsertNote", note });
        notes.unshift(note);
        return note;
      },
      deleteNote(id) {
        calls.push({ method: "notes.deleteNote", id });
        return { id, deleted_at: "2026-01-01T00:00:00.000Z" };
      },
      restoreNote(id) {
        calls.push({ method: "notes.restoreNote", id });
        return { id, restored_at: "2026-01-01T00:00:00.000Z" };
      },
      appendChip(payload) {
        calls.push({ method: "notes.appendChip", payload });
        const note = {
          id: payload.noteId === "__new__" ? "note_created" : payload.noteId,
          title: payload.title ?? "Demo Note"
        };
        return { ok: true, created: payload.noteId === "__new__", note };
      }
    }
  };
}

function makeProjectStoreRuntime(initialConfig = {}) {
  const calls = [];
  let config = initialConfig;
  return {
    calls,
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

function makeConversationMutationRuntime({ allowHardDelete = false } = {}) {
  const calls = [];
  const conversation = {
    conversation_id: "conv_demo",
    title: "Demo",
    archived: false
  };
  return {
    calls,
    config: { allowHardDelete },
    store: {
      updateConversation(conversationId, patch) {
        calls.push({ method: "store.updateConversation", conversationId, patch });
        if (conversationId !== conversation.conversation_id) return null;
        Object.assign(conversation, patch);
        return { ...conversation };
      },
      softDeleteConversation(conversationId) {
        calls.push({ method: "store.softDeleteConversation", conversationId });
        if (conversationId !== conversation.conversation_id) return null;
        conversation.archived = true;
        return { ...conversation };
      },
      hardDeleteConversation(conversationId) {
        calls.push({ method: "store.hardDeleteConversation", conversationId });
        return conversationId === conversation.conversation_id;
      }
    }
  };
}

async function noteProjectConversationRoute({
  method,
  pathname,
  actor = "desktop_console",
  body = {},
  runtime = makeNotesRuntime()
}) {
  const response = captureResponse();
  const handled = await tryHandleNoteProjectConversationRoute({
    request: jsonRequest(body, actor ? { [ACTOR_HEADER]: actor } : {}),
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

async function previewFileRoute({
  method,
  pathname,
  actor = "desktop_console",
  runtime
}) {
  const response = captureResponse();
  const handled = await tryHandlePreviewFileRoute({
    request: jsonRequest({}, actor ? { [ACTOR_HEADER]: actor } : {}),
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

function makeOfficeSetupRuntime() {
  const calls = [];
  return {
    calls,
    officeAddinSetup: {
      async runOfficeAddinSetup(options = {}) {
        calls.push(options);
        return {
          status: {
            ok: true,
            elevate: options.elevate === true,
            resetCache: options.resetCache === true
          }
        };
      }
    }
  };
}

async function officeRoute({
  method,
  pathname,
  actor = "desktop_console",
  body = {},
  rawBody = null,
  runtime = makeOfficeSetupRuntime()
}) {
  const response = captureResponse();
  const headers = actor ? { [ACTOR_HEADER]: actor } : {};
  const request = rawBody === null ? jsonRequest(body, headers) : rawRequest(rawBody, headers);
  const handled = await tryHandleOfficeRoute({
    request,
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

function makeEchoAudioRuntime({ keywordDir = null } = {}) {
  const calls = [];
  return {
    calls,
    audio: {
      async hasUserEnrollment() {
        calls.push({ method: "audio.hasUserEnrollment" });
        return true;
      },
      async detectWakeKeywordLocally(audioBuffer, options = {}) {
        calls.push({
          method: "audio.detectWakeKeywordLocally",
          bytes: audioBuffer.length,
          options
        });
        return {
          ok: true,
          matched: true,
          keyword: "linxi",
          audio_seconds: 1.5
        };
      },
      async transcribeAudioLocally(audioBuffer, options = {}) {
        calls.push({
          method: "audio.transcribeAudioLocally",
          bytes: audioBuffer.length,
          options
        });
        return {
          ok: true,
          transcript: "linxi",
          language: "zh",
          provider: { model: "fake-whisper" }
        };
      },
      async transcribeAudioLocallyStream(audioBuffer, options = {}, onEvent = () => {}) {
        calls.push({
          method: "audio.transcribeAudioLocallyStream",
          bytes: audioBuffer.length,
          options
        });
        onEvent({ type: "segment", start: 0, end: 1, text: "linxi" });
        return { ok: true };
      },
      async writeEnrollmentSample(record = {}) {
        calls.push({
          method: "audio.writeEnrollmentSample",
          record
        });
        return {
          enabled: true,
          completed: true,
          matchedCount: 3,
          sampleCount: 3,
          requiredMatches: 2,
          requiredSamples: 3,
          profile: { personalized: true }
        };
      },
      getUserKeywordDir() {
        calls.push({ method: "audio.getUserKeywordDir" });
        return keywordDir ?? path.join(os.tmpdir(), "uca-audio-guard-unused");
      }
    }
  };
}

async function audioRoute({
  method,
  pathname,
  actor = "desktop_shell",
  rawBody = "fake-audio",
  contentType = "audio/webm",
  runtime = makeEchoAudioRuntime()
}) {
  const response = captureResponse();
  const headers = actor ? {
    [ACTOR_HEADER]: actor,
    "content-type": contentType
  } : {
    "content-type": contentType
  };
  const handled = await tryHandleAudioRoute({
    request: rawRequest(rawBody, headers),
    response,
    method,
    url: new URL(`http://127.0.0.1${pathname}`),
    runtime
  });
  return {
    handled,
    statusCode: response.statusCode,
    body: response.body,
    payload: response.body.trim().startsWith("{") ? parsePayload(response) : null,
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

  const readRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const blockedRead = await configProviderRoute({
    method: "GET",
    pathname: `/skills/read?entryPath=${encodeURIComponent(editablePath)}`,
    actor: "browser_page",
    runtime: readRuntime
  });
  assert.equal(blockedRead.statusCode, 403);
  assert.equal(blockedRead.payload.error, "desktop_actor_required");

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

  const blockedCreate = await configProviderRoute({
    method: "POST",
    pathname: "/skills/create",
    actor: "browser_page",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { name: "Blocked Skill" }
  });
  assert.equal(blockedCreate.statusCode, 403);
  assert.equal(blockedCreate.payload.error, "desktop_actor_required");

  const blockedDuplicate = await configProviderRoute({
    method: "POST",
    pathname: "/skills/duplicate",
    actor: "desktop_overlay",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: editablePath }
  });
  assert.equal(blockedDuplicate.statusCode, 403);
  assert.equal(blockedDuplicate.payload.error, "desktop_actor_required");

  const blockedRollback = await configProviderRoute({
    method: "POST",
    pathname: "/skills/rollback",
    actor: "desktop_overlay",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: editablePath }
  });
  assert.equal(blockedRollback.statusCode, 403);
  assert.equal(blockedRollback.payload.error, "desktop_actor_required");

  const blockedTest = await configProviderRoute({
    method: "POST",
    pathname: "/skills/test",
    actor: "desktop_overlay",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: editablePath }
  });
  assert.equal(blockedTest.statusCode, 403);
  assert.equal(blockedTest.payload.error, "desktop_actor_required");
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
  const readRuntime = makeSkillRuntime({ skillsDir, skillPatternsPath });
  const read = await configProviderRoute({
    method: "GET",
    pathname: `/skills/read?entryPath=${encodeURIComponent(editablePath)}`,
    actor: "desktop_console",
    runtime: readRuntime
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.payload.markdown, "# Original\n");

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

  const created = await configProviderRoute({
    method: "POST",
    pathname: "/skills/create",
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { name: "Created Skill", description: "Created from console." }
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.payload.id, "created-skill");

  const tested = await configProviderRoute({
    method: "POST",
    pathname: "/skills/test",
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: created.payload.entryPath }
  });
  assert.equal(tested.statusCode, 200);
  assert.equal(tested.payload.ok, true);
  assert.equal(tested.payload.discovery.checked, false);

  const rejectedTestPath = await configProviderRoute({
    method: "POST",
    pathname: "/skills/test",
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: path.join(tempRoot, "outside", "SKILL.md") }
  });
  assert.equal(rejectedTestPath.statusCode, 403);
  assert.equal(rejectedTestPath.payload.error, "skill_path_not_allowed");

  const duplicated = await configProviderRoute({
    method: "POST",
    pathname: "/skills/duplicate",
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: editablePath, name: "Editable Copy" }
  });
  assert.equal(duplicated.statusCode, 200);
  assert.match(await readFile(duplicated.payload.entryPath, "utf8"), /# Editable Copy/);

  const history = await configProviderRoute({
    method: "GET",
    pathname: `/skills/history?entryPath=${encodeURIComponent(editablePath)}`,
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath })
  });
  assert.equal(history.statusCode, 200);
  assert.ok(history.payload.history.length >= 1);

  const rolledBack = await configProviderRoute({
    method: "POST",
    pathname: "/skills/rollback",
    actor: "desktop_console",
    runtime: makeSkillRuntime({ skillsDir, skillPatternsPath }),
    body: { entryPath: editablePath }
  });
  assert.equal(rolledBack.statusCode, 200);
  assert.match(rolledBack.payload.markdown, /# Original/);
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
    { method: "POST", pathname: "/task/task_demo/restore" },
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
  assert.equal(deletion.payload.soft, true);
  assert.ok(deletion.runtime.calls.some((entry) => entry.method === "store.softDeleteTask" && entry.taskId === "task_demo"));

  const restoreRuntime = makeTaskControlRuntime();
  const restored = await taskControlRoute({
    method: "POST",
    pathname: "/task/task_demo/restore",
    actor: "desktop_console",
    runtime: restoreRuntime
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.payload.restored, true);
  assert.ok(restored.runtime.calls.some((entry) => entry.method === "store.restoreTask" && entry.taskId === "task_demo"));
});

test("notes mutation routes reject unknown desktop actors before local note writes", async () => {
  const cases = [
    { method: "POST", pathname: "/notes", body: { notes: [{ id: "n1" }] } },
    { method: "POST", pathname: "/notes/upsert", body: { note: { id: "n2", title: "Demo" } } },
    { method: "POST", pathname: "/notes/delete", body: { id: "n2" } },
    { method: "POST", pathname: "/notes/restore", body: { id: "n2" } },
    { method: "POST", pathname: "/notes/append-chip", body: { noteId: "__new__", text: "clip" } }
  ];

  for (const entry of cases) {
    const result = await noteProjectConversationRoute({
      ...entry,
      actor: "browser_page"
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(result.runtime.calls, [], `${entry.method} ${entry.pathname} must not touch notes store`);
  }
});

test("notes editor routes are console-only while append-chip allows overlay", async () => {
  for (const entry of [
    { method: "POST", pathname: "/notes", body: { notes: [{ id: "n1" }] } },
    { method: "POST", pathname: "/notes/upsert", body: { note: { id: "n2", title: "Demo" } } },
    { method: "POST", pathname: "/notes/delete", body: { id: "n2" } },
    { method: "POST", pathname: "/notes/restore", body: { id: "n2" } }
  ]) {
    const result = await noteProjectConversationRoute({
      ...entry,
      actor: "desktop_overlay"
    });
    assert.equal(result.statusCode, 403, `${entry.pathname} should reject overlay`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(result.runtime.calls, [], `${entry.pathname} must not touch notes store`);
  }

  const append = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/notes/append-chip",
    actor: "desktop_overlay",
    body: { noteId: "__new__", text: "clip", sourceLabel: "From overlay" }
  });
  assert.equal(append.statusCode, 200);
  assert.equal(append.payload.created, true);
  assert.equal(append.runtime.calls[0].method, "notes.appendChip");
});

test("notes mutation routes allow console and overlay note writers", async () => {
  const save = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/notes",
    actor: "desktop_console",
    body: { notes: [{ id: "n1", title: "Seed" }] }
  });
  assert.equal(save.statusCode, 200);
  assert.deepEqual(save.runtime.calls, [
    { method: "notes.saveNotes", notes: [{ id: "n1", title: "Seed" }] }
  ]);

  const deletion = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/notes/delete",
    actor: "desktop_console",
    body: { id: "n1" }
  });
  assert.equal(deletion.statusCode, 200);
  assert.equal(deletion.payload.ok, true);
  assert.equal(deletion.runtime.calls[0].method, "notes.deleteNote");

  const restore = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/notes/restore",
    actor: "desktop_console",
    body: { id: "n1" }
  });
  assert.equal(restore.statusCode, 200);
  assert.equal(restore.payload.ok, true);
  assert.equal(restore.runtime.calls[0].method, "notes.restoreNote");

  const append = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/notes/append-chip",
    actor: "desktop_overlay",
    body: { noteId: "__new__", text: "clip", sourceLabel: "From overlay", title: "Clip Note" }
  });
  assert.equal(append.statusCode, 200);
  assert.equal(append.payload.note.title, "Clip Note");
  assert.deepEqual(append.runtime.calls, [
    {
      method: "notes.appendChip",
      payload: {
        noteId: "__new__",
        text: "clip",
        sourceLabel: "From overlay",
        title: "Clip Note"
      }
    }
  ]);
});

test("project store mutation rejects non-desktop actors before config writes", async () => {
  const runtime = makeProjectStoreRuntime({
    ui: {
      projectStore: {
        currentProjectId: "proj_existing",
        projects: [{ id: "proj_existing", name: "Existing" }],
        conversations: []
      }
    }
  });
  const result = await noteProjectConversationRoute({
    method: "POST",
    pathname: "/projects/store",
    actor: "browser_page",
    runtime,
    body: {
      store: {
        currentProjectId: "proj_mutated",
        projects: [{ id: "proj_mutated", name: "Mutated" }],
        conversations: []
      }
    }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(runtime.calls, []);
});

test("project store mutation allows console and overlay project writers", async () => {
  for (const actor of ["desktop_console", "desktop_overlay"]) {
    const runtime = makeProjectStoreRuntime();
    const result = await noteProjectConversationRoute({
      method: "POST",
      pathname: "/projects/store",
      actor,
      runtime,
      body: {
        store: {
          currentProjectId: "proj_demo",
          projects: [{ id: "proj_demo", name: "Demo" }],
          conversations: []
        }
      }
    });

    assert.equal(result.statusCode, 200, `${actor} should be allowed`);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.store.currentProjectId, "proj_demo");
    assert.deepEqual(runtime.calls.map((entry) => entry.method), ["config.load", "config.save"]);
    assert.equal(runtime.calls[1].value.ui.projectStore.currentProjectId, "proj_demo");
    assert.ok(runtime.calls[1].value.ui.projectStore.projects.some((project) => project.id === "proj_demo"));
  }
});

test("conversation mutation routes reject non-console actors before store writes", async () => {
  const cases = [
    { method: "PATCH", pathname: "/conversation/conv_demo", actor: "browser_page", body: { title: "Renamed" } },
    { method: "PATCH", pathname: "/conversation/conv_demo", actor: "desktop_overlay", body: { archived: true } },
    { method: "DELETE", pathname: "/conversation/conv_demo", actor: "browser_page" },
    { method: "DELETE", pathname: "/conversation/conv_demo?hard=true", actor: "desktop_overlay" }
  ];

  for (const entry of cases) {
    const runtime = makeConversationMutationRuntime({ allowHardDelete: true });
    const result = await noteProjectConversationRoute({
      ...entry,
      runtime
    });
    assert.equal(result.handled, true, `${entry.method} ${entry.pathname} should be handled`);
    assert.equal(result.statusCode, 403, `${entry.method} ${entry.pathname} should reject`);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.deepEqual(runtime.calls, [], `${entry.method} ${entry.pathname} must not touch conversation store`);
  }
});

test("conversation mutation routes allow console actor for metadata and deletes", async () => {
  const patchRuntime = makeConversationMutationRuntime();
  const patched = await noteProjectConversationRoute({
    method: "PATCH",
    pathname: "/conversation/conv_demo",
    actor: "desktop_console",
    runtime: patchRuntime,
    body: { title: "Renamed", archived: true }
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.payload.conversation.title, "Renamed");
  assert.deepEqual(patchRuntime.calls, [
    {
      method: "store.updateConversation",
      conversationId: "conv_demo",
      patch: { title: "Renamed", archived: true }
    }
  ]);

  const softRuntime = makeConversationMutationRuntime();
  const softDeleted = await noteProjectConversationRoute({
    method: "DELETE",
    pathname: "/conversation/conv_demo",
    actor: "desktop_console",
    runtime: softRuntime
  });
  assert.equal(softDeleted.statusCode, 200);
  assert.equal(softDeleted.payload.conversation.archived, true);
  assert.deepEqual(softRuntime.calls, [
    { method: "store.softDeleteConversation", conversationId: "conv_demo" }
  ]);

  const hardRuntime = makeConversationMutationRuntime({ allowHardDelete: true });
  const hardDeleted = await noteProjectConversationRoute({
    method: "DELETE",
    pathname: "/conversation/conv_demo?hard=true",
    actor: "desktop_console",
    runtime: hardRuntime
  });
  assert.equal(hardDeleted.statusCode, 200);
  assert.equal(hardDeleted.payload.hard, true);
  assert.deepEqual(hardRuntime.calls, [
    { method: "store.hardDeleteConversation", conversationId: "conv_demo" }
  ]);
});

test("preview cache clear rejects non-console actors before deleting cache files", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-preview-cache-guard-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const cacheFile = path.join(tempRoot, "preview.html");
  await writeFile(cacheFile, "<p>cached</p>", "utf8");

  for (const actor of ["browser_page", "desktop_overlay"]) {
    await writeFile(cacheFile, "<p>cached</p>", "utf8");
    const result = await previewFileRoute({
      method: "POST",
      pathname: "/preview/cache/clear",
      actor,
      runtime: { paths: { previewCacheDir: tempRoot } }
    });
    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 403);
    assert.equal(result.payload.error, "desktop_actor_required");
    assert.equal(await readFile(cacheFile, "utf8"), "<p>cached</p>");
  }
});

test("preview cache clear allows the console actor", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-preview-cache-guard-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const cacheFile = path.join(tempRoot, "preview.html");
  await writeFile(cacheFile, "<p>cached</p>", "utf8");

  const result = await previewFileRoute({
    method: "POST",
    pathname: "/preview/cache/clear",
    actor: "desktop_console",
    runtime: { paths: { previewCacheDir: tempRoot } }
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.removed, 1);
  await assert.rejects(readFile(cacheFile, "utf8"), /ENOENT/);
});

test("office add-in setup rejects non-console actors before parsing or running setup", async () => {
  const runtime = makeOfficeSetupRuntime();
  const result = await officeRoute({
    method: "POST",
    pathname: "/setup/office-addins",
    actor: "browser_page",
    rawBody: "{not-json",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(runtime.calls, []);
});

test("office add-in setup allows the console actor through the setup runner", async () => {
  const runtime = makeOfficeSetupRuntime();
  const result = await officeRoute({
    method: "POST",
    pathname: "/setup/office-addins",
    actor: "desktop_console",
    body: { elevate: true, resetCache: true },
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(runtime.calls, [{ elevate: true, resetCache: true }]);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.elevate, true);
  assert.equal(result.payload.resetCache, true);
});

test("echo KWS rejects non-shell actors before local audio processing", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/kws",
    actor: "browser_page",
    rawBody: "",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(runtime.calls, []);
});

test("echo KWS allows the dock shell actor through the injected audio runtime", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/kws",
    actor: "desktop_shell",
    rawBody: "abc",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.matched, true);
  assert.equal(result.payload.personalized, true);
  assert.deepEqual(runtime.calls.map((call) => call.method), [
    "audio.hasUserEnrollment",
    "audio.detectWakeKeywordLocally"
  ]);
  assert.equal(runtime.calls[1].bytes, 3);
  assert.equal(runtime.calls[1].options.personalized, true);
});

test("echo KWS rejects oversized audio before local audio processing", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/kws",
    actor: "desktop_shell",
    rawBody: [Buffer.alloc(1024 * 1024 * 12), Buffer.from("x")],
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 413);
  assert.equal(result.payload.reason, "audio_too_large");
  assert.deepEqual(runtime.calls, []);
});

test("echo enrollment rejects non-shell actors before writing samples", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/enroll-keyword?sample=1&session=s1",
    actor: "desktop_overlay",
    rawBody: "",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(runtime.calls, []);
});

test("echo enrollment allows the dock shell actor and writes through injected audio runtime", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "uca-echo-enroll-guard-"));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });
  const runtime = makeEchoAudioRuntime({ keywordDir: tempRoot });
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/enroll-keyword?sample=2&session=s1",
    actor: "desktop_shell",
    rawBody: "voice",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.transcript, "linxi");
  assert.equal(result.payload.savedAudio, "sample-02.webm");
  assert.equal(await readFile(path.join(tempRoot, "sample-02.webm"), "utf8"), "voice");
  assert.deepEqual(runtime.calls.map((call) => call.method), [
    "audio.getUserKeywordDir",
    "audio.transcribeAudioLocally",
    "audio.detectWakeKeywordLocally",
    "audio.writeEnrollmentSample"
  ]);
  assert.equal(runtime.calls[3].record.sampleKey, "2");
  assert.equal(runtime.calls[3].record.sessionId, "s1");
});

test("echo enrollment rejects oversized audio before writing samples", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/echo/enroll-keyword?sample=1&session=s1",
    actor: "desktop_shell",
    rawBody: [Buffer.alloc(1024 * 1024 * 12), Buffer.from("x")],
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 413);
  assert.equal(result.payload.reason, "audio_too_large");
  assert.deepEqual(runtime.calls, []);
});

test("note transcription rejects non-overlay actors before reading audio", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/note/transcribe",
    actor: "browser_page",
    rawBody: "",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "desktop_actor_required");
  assert.deepEqual(runtime.calls, []);
});

test("note transcription allows the overlay actor through the injected audio runtime", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/note/transcribe?lang=zh",
    actor: "desktop_overlay",
    rawBody: "note-audio",
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.transcript, "linxi");
  assert.deepEqual(runtime.calls.map((call) => call.method), [
    "audio.transcribeAudioLocally"
  ]);
  assert.equal(runtime.calls[0].bytes, "note-audio".length);
  assert.equal(runtime.calls[0].options.lang, "zh");
});

test("note transcription rejects oversized audio before transcription runtime", async () => {
  const runtime = makeEchoAudioRuntime();
  const result = await audioRoute({
    method: "POST",
    pathname: "/note/transcribe",
    actor: "desktop_overlay",
    rawBody: [Buffer.alloc(1024 * 1024 * 64), Buffer.from("x")],
    runtime
  });

  assert.equal(result.handled, true);
  assert.equal(result.statusCode, 413);
  assert.equal(result.payload.reason, "audio_too_large");
  assert.deepEqual(runtime.calls, []);
});

test("streaming note transcription sends local runtime SSE events and ends normally", async () => {
  const savedEnv = {
    UCA_TRANSCRIPTION_API_KEY: process.env.UCA_TRANSCRIPTION_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    UCA_OPENAI_API_KEY: process.env.UCA_OPENAI_API_KEY
  };
  delete process.env.UCA_TRANSCRIPTION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.UCA_OPENAI_API_KEY;
  try {
    const runtime = makeEchoAudioRuntime();
    const result = await audioRoute({
      method: "POST",
      pathname: "/note/transcribe?stream=1&lang=zh",
      actor: "desktop_overlay",
      rawBody: "note-audio",
      runtime
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /"type":"segment"/);
    assert.match(result.body, /"text":"linxi"/);
    assert.doesNotMatch(result.body, /stream_idle_timeout|stream_total_timeout/);
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.calls[0].method, "audio.transcribeAudioLocallyStream");
    assert.equal(runtime.calls[0].options.lang, "zh");
    assert.equal(runtime.calls[0].options.signal.aborted, false);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("streaming note transcription ends with a structured idle timeout when local runtime stalls", async () => {
  const savedEnv = {
    UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS: process.env.UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS,
    UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS: process.env.UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS,
    UCA_TRANSCRIPTION_API_KEY: process.env.UCA_TRANSCRIPTION_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    UCA_OPENAI_API_KEY: process.env.UCA_OPENAI_API_KEY
  };
  process.env.UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS = "20";
  process.env.UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS = "200";
  delete process.env.UCA_TRANSCRIPTION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.UCA_OPENAI_API_KEY;
  try {
    const runtime = makeEchoAudioRuntime();
    runtime.audio.transcribeAudioLocallyStream = async (audioBuffer, options = {}) => {
      runtime.calls.push({
        method: "audio.transcribeAudioLocallyStream",
        bytes: audioBuffer.length,
        options
      });
      return new Promise(() => {});
    };
    const result = await audioRoute({
      method: "POST",
      pathname: "/note/transcribe?stream=1&lang=zh",
      actor: "desktop_overlay",
      rawBody: "note-audio",
      runtime
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /"type":"error"/);
    assert.match(result.body, /"reason":"stream_idle_timeout"/);
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.calls[0].method, "audio.transcribeAudioLocallyStream");
    assert.equal(runtime.calls[0].bytes, "note-audio".length);
    assert.equal(runtime.calls[0].options.mimeType, "audio/webm");
    assert.equal(runtime.calls[0].options.lang, "zh");
    assert.equal(runtime.calls[0].options.signal.aborted, true);
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("streaming note transcription enforces a total timeout even when local runtime stays active", async () => {
  const savedEnv = {
    UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS: process.env.UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS,
    UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS: process.env.UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS,
    UCA_TRANSCRIPTION_API_KEY: process.env.UCA_TRANSCRIPTION_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    UCA_OPENAI_API_KEY: process.env.UCA_OPENAI_API_KEY
  };
  process.env.UCA_NOTE_TRANSCRIBE_STREAM_IDLE_TIMEOUT_MS = "200";
  process.env.UCA_NOTE_TRANSCRIBE_STREAM_TOTAL_TIMEOUT_MS = "35";
  delete process.env.UCA_TRANSCRIPTION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.UCA_OPENAI_API_KEY;
  let interval = null;
  try {
    const runtime = makeEchoAudioRuntime();
    runtime.audio.transcribeAudioLocallyStream = async (audioBuffer, options = {}, onEvent = () => {}) => {
      runtime.calls.push({
        method: "audio.transcribeAudioLocallyStream",
        bytes: audioBuffer.length,
        options
      });
      interval = setInterval(() => onEvent({ type: "segment", text: "still-working" }), 5);
      options.signal.addEventListener("abort", () => clearInterval(interval), { once: true });
      return new Promise(() => {});
    };
    const result = await audioRoute({
      method: "POST",
      pathname: "/note/transcribe?stream=1",
      actor: "desktop_overlay",
      rawBody: "note-audio",
      runtime
    });

    assert.equal(result.handled, true);
    assert.equal(result.statusCode, 200);
    assert.match(result.body, /"type":"segment"/);
    assert.match(result.body, /"reason":"stream_total_timeout"/);
    assert.equal(runtime.calls[0].options.signal.aborted, true);
  } finally {
    if (interval) clearInterval(interval);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
