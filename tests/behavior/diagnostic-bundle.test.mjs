import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildRuntimeDiagnosticBundle } from "../../src/service/core/diagnostic-bundle.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { createPersistentRuntime } from "../../src/service/core/persistent-runtime.mjs";

function nowIso() {
  return new Date().toISOString();
}

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("runtime diagnostic bundle is local, bounded, and redacts secrets", async () => {
  await withTempDir("lingxy-diagnostics-", async (dir) => {
    const logsDir = path.join(dir, "logs");
    await mkdir(path.join(logsDir, "crash-dumps"), { recursive: true });
    await writeFile(
      path.join(logsDir, "desktop-errors.jsonl"),
      `${JSON.stringify({ kind: "renderer", accessToken: "token-should-not-export", message: "boom" })}\n`,
      "utf8"
    );
    await writeFile(path.join(logsDir, "crash-dumps", "renderer.dmp"), "dump", "utf8");

    const store = createInMemoryStoreScaffold();
    const task = {
      task_id: "task_diag",
      created_at: nowIso(),
      updated_at: nowIso(),
      status: "failed",
      intent: "tool_using",
      executor: "tool_using",
      user_command: "use Bearer should-not-export in prompt",
      failure_user_message: "provider failed",
      context_packet: { source_type: "desktop_console" }
    };
    store.insertTask(task);
    store.appendEvent({
      event_id: "evt_diag",
      task_id: task.task_id,
      ts: nowIso(),
      event_type: "tool_call_completed",
      payload: { apiKey: "event-secret", ok: false }
    });
    store.appendAuditLog({
      audit_id: "audit_diag",
      ts: nowIso(),
      event_subtype: "diagnostic.test",
      payload: { refreshToken: "audit-secret" }
    });

    const bundle = await buildRuntimeDiagnosticBundle({
      store,
      paths: {
        baseDir: dir,
        dataDir: path.join(dir, "data"),
        logsDir,
        outputsDir: path.join(dir, "outputs"),
        dbPath: path.join(dir, "data", "uca.db")
      },
      configStore: {
        load() {
          return {
            ai: {
              customProviders: [{
                id: "openai",
                kind: "openai",
                apiKeyRef: "secret://lingxy/provider/openai/apiKey"
              }]
            }
          };
        }
      }
    });

    const serialized = JSON.stringify(bundle);
    assert.equal(bundle.schema_version, 1);
    assert.equal(bundle.app.telemetry, "none");
    assert.equal(bundle.counts.failedTasks, 1);
    assert.equal(bundle.recentTasks[0].task_id, "task_diag");
    assert.equal(bundle.desktopErrors.length, 1);
    assert.equal(bundle.crashDumps[0].name, "renderer.dmp");
    assert.equal(bundle.config.ai.customProviders[0].requiresApiKey, true);
    assert.equal(serialized.includes("secret://"), false);
    assert.equal(serialized.includes("token-should-not-export"), false);
    assert.equal(serialized.includes("event-secret"), false);
    assert.equal(serialized.includes("audit-secret"), false);
  });
});

test("diagnostic bundle HTTP route is desktop-actor guarded", async () => {
  await withTempDir("lingxy-diagnostics-route-", async (dir) => {
    const runtime = createPersistentRuntime({
      baseDir: dir,
      port: 0,
      pipeName: `\\\\.\\pipe\\lingxy-diagnostics-${crypto.randomUUID()}`
    });
    const listening = await runtime.start();
    try {
      const blocked = await fetch(`${listening.baseUrl}/diagnostics/bundle`, {
        method: "POST"
      });
      assert.equal(blocked.status, 403);

      const allowed = await fetch(`${listening.baseUrl}/diagnostics/bundle`, {
        method: "POST",
        headers: { "X-Lingxy-Desktop-Actor": "desktop_console" }
      });
      assert.equal(allowed.ok, true);
      const payload = await allowed.json();
      assert.equal(payload.bundle.schema_version, 1);
      assert.equal(payload.bundle.manifest.excludes.includes("raw_crash_dump_files"), true);
    } finally {
      await runtime.stop();
    }
  });
});
