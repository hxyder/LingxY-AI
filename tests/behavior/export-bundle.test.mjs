import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntimeExportBundle } from "../../src/service/core/export-bundle.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createPersistentRuntime } from "../../src/service/core/persistent-runtime.mjs";

function nowIso() {
  return new Date().toISOString();
}

async function withTempRuntime(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runtime export bundle includes core user data and redacts secrets", () => {
  const store = createInMemoryStoreScaffold();
  const task = {
    task_id: "task_export",
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "success",
    user_command: "Export me",
    context_packet: {
      authorization: "Bearer should-not-export"
    }
  };
  store.insertTask(task);
  store.appendEvent({
    event_id: "evt_export",
    task_id: task.task_id,
    ts: nowIso(),
    event_type: "tool_call_completed",
    payload: {
      accessToken: "token-should-not-export",
      result: "ok"
    }
  });
  store.appendArtifact({
    artifact_id: "artifact_export",
    task_id: task.task_id,
    path: "C:/Users/me/report.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    created_at: nowIso()
  });
  const conversation = store.insertConversation({
    conversation_id: "conv_export",
    title: "Export conversation"
  });
  store.appendMessage({
    conversation_id: conversation.conversation_id,
    role: "user",
    content: "hello"
  });
  store.appendAuditLog({
    audit_id: "audit_export",
    ts: nowIso(),
    event_subtype: "test.audit",
    payload: { apiKey: "audit-secret", ok: true }
  });

  const runtime = {
    store,
    configStore: {
      load() {
        return {
          ai: {
            customProviders: [{
              id: "openai",
              kind: "openai",
              name: "OpenAI",
              apiKeyRef: "secret://lingxy/provider/openai/apiKey",
              defaultModel: "gpt-5.4-mini"
            }]
          },
          ui: {
            projectStore: {
              projects: [{ id: "project_export", name: "Project" }]
            }
          }
        };
      }
    },
    notesStore: {
      listNotes() {
        return [{ id: "note_export", title: "Note", body_html: "<p>Body</p>" }];
      }
    }
  };

  const bundle = buildRuntimeExportBundle(runtime);
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.schema_version, 1);
  assert.equal(bundle.notes.length, 1);
  assert.equal(bundle.conversations[0].messages.length, 1);
  assert.equal(bundle.tasks[0].artifacts[0].artifact_id, "artifact_export");
  assert.equal(bundle.config.ai.customProviders[0].requiresApiKey, true);
  assert.equal(bundle.config.ai.customProviders[0].apiKeyRef, undefined);
  assert.equal(serialized.includes("secret://"), false);
  assert.equal(serialized.includes("should-not-export"), false);
  assert.equal(serialized.includes("token-should-not-export"), false);
  assert.equal(serialized.includes("audit-secret"), false);
  assert.equal(bundle.manifest.excludes.includes("secret_store"), true);
});

test("export bundle HTTP route is desktop-actor guarded", async () => {
  await withTempRuntime("lingxy-export-bundle-", async (dir) => {
    const runtime = createPersistentRuntime({
      baseDir: dir,
      port: 0,
      pipeName: `\\\\.\\pipe\\lingxy-export-bundle-${crypto.randomUUID()}`
    });
    const listening = await runtime.start();
    try {
      const blocked = await fetch(`${listening.baseUrl}/export/bundle`, {
        method: "POST"
      });
      assert.equal(blocked.status, 403);

      const allowed = await fetch(`${listening.baseUrl}/export/bundle`, {
        method: "POST",
        headers: { "X-Lingxy-Desktop-Actor": "desktop_console" }
      });
      assert.equal(allowed.ok, true);
      const payload = await allowed.json();
      assert.equal(payload.bundle.schema_version, 1);
      assert.equal(payload.bundle.manifest.excludes.includes("provider_api_keys"), true);
    } finally {
      await runtime.stop();
    }
  });
});
