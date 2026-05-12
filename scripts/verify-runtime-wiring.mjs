import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { createPersistentRuntime } from "../src/service/core/persistent-runtime.mjs";
import { createDesktopRuntimeHost } from "../src/desktop/tray/runtime-host.mjs";
import { pathToElectronMain } from "../src/desktop/tray/bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".tmp", "verify-runtime-wiring");

await rm(runtimeDir, {
  recursive: true,
  force: true
});

const runtime = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: "\\\\.\\pipe\\uca-helper-verify-runtime-wiring"
});

const listening = await runtime.start();
assert.equal(listening.port > 0, true);

const healthResponse = await fetch(`${listening.baseUrl}/health`);
assert.equal(healthResponse.ok, true);
const health = await healthResponse.json();
assert.equal(health.ok, true);
assert.equal(health.db_path.endsWith("uca.db"), true);

const capabilityInventoryResponse = await fetch(`${listening.baseUrl}/capabilities/inventory`);
assert.equal(capabilityInventoryResponse.ok, true);
const capabilityInventoryPayload = await capabilityInventoryResponse.json();
assert.equal(capabilityInventoryPayload.inventory.schemaVersion, "capability-inventory.v1");
assert.equal(capabilityInventoryPayload.inventory.groups.some((group) => group.id === "built_in_tools"), true);
assert.equal(capabilityInventoryPayload.inventory.entries.some((entry) => entry.group === "built_in_tools"), true);

const capabilityLifecycleResponse = await fetch(`${listening.baseUrl}/capabilities/lifecycle`);
assert.equal(capabilityLifecycleResponse.ok, true);
const capabilityLifecyclePayload = await capabilityLifecycleResponse.json();
assert.equal(capabilityLifecyclePayload.lifecycle.schemaVersion, "capability-creation-lifecycle.v1");
assert.equal(capabilityLifecyclePayload.lifecycle.families.some((family) => family.id === "connector_plugin"), true);

const createResponse = await fetch(`${listening.baseUrl}/task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    userCommand: "请总结这段内容",
    contextPacket: {
      source_type: "clipboard",
      source_app: "verify-runtime",
      capture_mode: "manual",
      text: "This is a runtime verification payload."
    }
  })
});
assert.equal(createResponse.ok, true);
const created = await createResponse.json();
assert.equal(created.task.status, "success");

const taskResponse = await fetch(`${listening.baseUrl}/task/${created.task.task_id}`);
assert.equal(taskResponse.ok, true);
const taskPayload = await taskResponse.json();
assert.equal(taskPayload.task.task_id, created.task.task_id);
assert.equal(taskPayload.events.length >= 2, true);

const eventsResponse = await fetch(`${listening.baseUrl}/task/${created.task.task_id}/events`);
assert.equal(eventsResponse.ok, true);
const eventsPayload = await eventsResponse.json();
assert.equal(eventsPayload.events.length >= 2, true);

const metricsResponse = await fetch(`${listening.baseUrl}/metrics`);
assert.equal(metricsResponse.ok, true);
const metricsText = await metricsResponse.text();
assert.equal(metricsText.includes("uca_task_total"), true);

const securityPatchResponse = await fetch(`${listening.baseUrl}/security/state`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({
    offline_mode: true
  })
});
assert.equal(securityPatchResponse.ok, true);
const securityPayload = await securityPatchResponse.json();
assert.equal(securityPayload.security.offline_mode, true);

const scheduleWithoutActorResponse = await fetch(`${listening.baseUrl}/schedules`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    name: "unguarded schedule",
    trigger: { type: "interval", seconds: 60 },
    message: "should not be created"
  })
});
assert.equal(scheduleWithoutActorResponse.status, 403);

const scheduleCreateResponse = await fetch(`${listening.baseUrl}/schedules`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({
    name: "runtime schedule",
    trigger: { type: "interval", seconds: 60 },
    message: "runtime smoke reminder",
    oneShot: true
  })
});
assert.equal(scheduleCreateResponse.ok, true);
const scheduleCreatePayload = await scheduleCreateResponse.json();
const scheduleId = scheduleCreatePayload.schedule.schedule_id;
assert.equal(scheduleCreatePayload.schedule.created_by, "desktop_console");

const schedulePatchResponse = await fetch(`${listening.baseUrl}/schedules/${encodeURIComponent(scheduleId)}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({ name: "runtime schedule updated" })
});
assert.equal(schedulePatchResponse.ok, true);

const scheduleRunResponse = await fetch(`${listening.baseUrl}/schedules/${encodeURIComponent(scheduleId)}/runs`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({ triggerPayload: { source: "verify-runtime-wiring" } })
});
assert.equal(scheduleRunResponse.ok, true);

const scheduleDeleteResponse = await fetch(`${listening.baseUrl}/schedules/${encodeURIComponent(scheduleId)}`, {
  method: "DELETE",
  headers: {
    "X-Lingxy-Desktop-Actor": "desktop_console"
  }
});
assert.equal(scheduleDeleteResponse.ok, true);

const templateWithoutActorResponse = await fetch(`${listening.baseUrl}/templates`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    template: {
      schema_version: "1.0",
      id: "user.blocked.template",
      name: "Blocked Template",
      version: "1.0.0",
      steps: [{ id: "draft", kind: "executor", target: "fast", inputs: { prompt: "blocked" } }]
    }
  })
});
assert.equal(templateWithoutActorResponse.status, 403);

const templateSaveResponse = await fetch(`${listening.baseUrl}/templates`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({
    template: {
      schema_version: "1.0",
      id: "user.runtime.template",
      name: "Runtime Template",
      version: "1.0.0",
      steps: [{ id: "draft", kind: "executor", target: "fast", inputs: { prompt: "runtime" } }]
    }
  })
});
assert.equal(templateSaveResponse.ok, true);

const templateDeleteResponse = await fetch(`${listening.baseUrl}/templates/user.runtime.template`, {
  method: "DELETE",
  headers: {
    "X-Lingxy-Desktop-Actor": "desktop_console"
  }
});
assert.equal(templateDeleteResponse.ok, true);

const providerCreateResponse = await fetch(`${listening.baseUrl}/config/providers`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Lingxy-Desktop-Actor": "desktop_console"
  },
  body: JSON.stringify({
    id: "codex-options-test",
    name: "Codex Options Test",
    kind: "code_cli",
    command: "codex.exe",
    args: [],
    transport: "stream_json_print",
    defaultModel: ""
  })
});
assert.equal(providerCreateResponse.ok, true);

const modelOptionsResponse = await fetch(`${listening.baseUrl}/config/provider-model-options?providerId=codex-options-test`);
assert.equal(modelOptionsResponse.ok, true);
const modelOptionsPayload = await modelOptionsResponse.json();
assert.equal(modelOptionsPayload.option.models.some((model) => model.id === "gpt-5.5"), true);
assert.equal(modelOptionsPayload.option.reasoningEfforts.some((effort) => effort.id === "xhigh"), true);

const listResponse = await fetch(`${listening.baseUrl}/tasks`);
assert.equal(listResponse.ok, true);
const listPayload = await listResponse.json();
assert.equal(listPayload.tasks.length >= 1, true);

await runtime.stop();

const restarted = createPersistentRuntime({
  baseDir: runtimeDir,
  port: 0,
  pipeName: "\\\\.\\pipe\\uca-helper-verify-runtime-wiring-restart"
});
const restartedListening = await restarted.start();
const restartedTaskResponse = await fetch(`${restartedListening.baseUrl}/task/${created.task.task_id}`);
assert.equal(restartedTaskResponse.ok, true);
const restartedTaskPayload = await restartedTaskResponse.json();
assert.equal(restartedTaskPayload.task.task_id, created.task.task_id);

const restartedSecurityResponse = await fetch(`${restartedListening.baseUrl}/security/state`);
const restartedSecurity = await restartedSecurityResponse.json();
assert.equal(restartedSecurity.security.offline_mode, true);

const host = createDesktopRuntimeHost({
  serviceBaseUrl: restartedListening.baseUrl
});
const hostState = host.start();
assert.equal(hostState.trayReady, true);
assert.equal(host.openWindow("console").visible, true);
assert.equal(pathToElectronMain(), "src/desktop/tray/electron-main.mjs");

await restarted.stop();

console.log("Runtime wiring and persistence verification passed.");
