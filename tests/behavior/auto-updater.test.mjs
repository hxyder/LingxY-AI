/**
 * Behavior tests for auto-updater.mjs (P0-1).
 *
 * Validates the 4-tier strategy ladder (off / manual / notify / auto)
 * by stubbing autoUpdater with a minimal EventEmitter shim — no
 * Electron, no network. Each test asserts the externally-observable
 * effect (notify call shape, autoUpdater method invocations,
 * downloadUpdate triggers) rather than internal state, so refactors
 * that preserve behavior don't break the gate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { createAutoUpdater, UPDATE_STRATEGIES, DEFAULT_UPDATE_STRATEGY } from "../../src/desktop/tray/auto-updater.mjs";

function makeFakeAutoUpdater() {
  const emitter = new EventEmitter();
  const calls = {
    checkForUpdates: 0,
    downloadUpdate: 0,
    quitAndInstall: []
  };
  return {
    emitter,
    calls,
    fake: {
      autoDownload: true,           // electron-updater default; wrapper must flip to false
      autoInstallOnAppQuit: true,   // ditto
      on: emitter.on.bind(emitter),
      checkForUpdates: async () => {
        calls.checkForUpdates += 1;
        return { updateInfo: { version: "1.2.3" } };
      },
      downloadUpdate: async () => {
        calls.downloadUpdate += 1;
        return ["lingxy-Setup-1.2.3.exe"];
      },
      quitAndInstall: (silent, restart) => {
        calls.quitAndInstall.push({ silent, restart });
      }
    }
  };
}

test("constructor forces autoDownload + autoInstallOnAppQuit to false", () => {
  const { fake } = makeFakeAutoUpdater();
  assert.equal(fake.autoDownload, true);
  assert.equal(fake.autoInstallOnAppQuit, true);
  createAutoUpdater({ autoUpdater: fake, getStrategy: () => "off" });
  assert.equal(fake.autoDownload, false, "autoDownload must be forced false (codex round-1: silent action source)");
  assert.equal(fake.autoInstallOnAppQuit, false, "autoInstallOnAppQuit must be forced false");
});

test("constructor rejects missing autoUpdater", () => {
  assert.throws(
    () => createAutoUpdater({ getStrategy: () => "off" }),
    /requires `autoUpdater` injection/
  );
});

test("constructor rejects missing getStrategy (no hardcoded default)", () => {
  const { fake } = makeFakeAutoUpdater();
  assert.throws(
    () => createAutoUpdater({ autoUpdater: fake }),
    /requires `getStrategy` injection/
  );
});

test("strategy off — checkForUpdates is a no-op for both scheduled and user triggers", async () => {
  const { fake, calls } = makeFakeAutoUpdater();
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "off" });
  const r1 = await u.checkForUpdates({ trigger: "scheduled" });
  const r2 = await u.checkForUpdates({ trigger: "user" });
  assert.equal(calls.checkForUpdates, 0);
  assert.equal(r1.skipped, "off");
  assert.equal(r2.skipped, "off");
});

test("strategy manual — scheduled triggers skip, user triggers run", async () => {
  const { fake, calls } = makeFakeAutoUpdater();
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "manual" });
  const skipped = await u.checkForUpdates({ trigger: "scheduled" });
  assert.equal(skipped.skipped, "manual_skips_scheduled");
  assert.equal(calls.checkForUpdates, 0);
  const ran = await u.checkForUpdates({ trigger: "user" });
  assert.equal(ran.ok, true);
  assert.equal(calls.checkForUpdates, 1);
});

test("strategy notify — scheduled check runs but downloadUpdate is NOT called on update-available", async () => {
  const { fake, calls, emitter } = makeFakeAutoUpdater();
  const notifyCalls = [];
  createAutoUpdater({
    autoUpdater: fake,
    getStrategy: () => "notify",
    notify: async (msg) => { notifyCalls.push(msg); }
  });
  emitter.emit("update-available", { version: "1.2.3" });
  // notify must run; downloadUpdate must NOT.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.downloadUpdate, 0, "notify strategy must not auto-download");
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].kind, "update-available");
  assert.equal(notifyCalls[0].payload.autoDownload, false);
});

test("strategy auto — update-available triggers downloadUpdate and notify with autoDownload:true", async () => {
  const { fake, calls, emitter } = makeFakeAutoUpdater();
  const notifyCalls = [];
  createAutoUpdater({
    autoUpdater: fake,
    getStrategy: () => "auto",
    notify: async (msg) => { notifyCalls.push(msg); }
  });
  emitter.emit("update-available", { version: "1.2.3" });
  // Wait for the async chain (notify → downloadUpdate).
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.downloadUpdate, 1, "auto strategy must auto-download");
  assert.equal(notifyCalls[0].payload.autoDownload, true);
});

test("update-downloaded fires update-ready notification", async () => {
  const { fake, emitter } = makeFakeAutoUpdater();
  const notifyCalls = [];
  createAutoUpdater({
    autoUpdater: fake,
    getStrategy: () => "auto",
    notify: async (msg) => { notifyCalls.push(msg); }
  });
  emitter.emit("update-downloaded", { version: "1.2.3", releaseDate: "2026-05-07" });
  await new Promise(resolve => setImmediate(resolve));
  const readyMsg = notifyCalls.find(m => m.kind === "update-ready");
  assert.ok(readyMsg, "update-downloaded must trigger update-ready");
  assert.equal(readyMsg.payload.info.version, "1.2.3");
});

test("autoUpdater error event is captured into diagnostics, never thrown", async () => {
  const { fake, emitter } = makeFakeAutoUpdater();
  const diagCalls = [];
  createAutoUpdater({
    autoUpdater: fake,
    getStrategy: () => "auto",
    appendDiagnostic: (event, error, ctx) => { diagCalls.push({ event, errorMsg: error?.message, ctx }); }
  });
  emitter.emit("error", new Error("network timeout"));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(diagCalls.find(c => c.event === "auto_updater_runtime_error"));
});

test("applyUpdate before any download throws (caller bug surface)", async () => {
  const { fake } = makeFakeAutoUpdater();
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "auto" });
  assert.throws(
    () => u.applyUpdate(),
    /no update has been downloaded yet/
  );
});

test("applyUpdate after download routes to autoUpdater.quitAndInstall", async () => {
  const { fake, calls, emitter } = makeFakeAutoUpdater();
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "auto" });
  emitter.emit("update-downloaded", { version: "1.2.3" });
  await new Promise(resolve => setImmediate(resolve));
  u.applyUpdate({ silent: false, restart: true });
  assert.equal(calls.quitAndInstall.length, 1);
  assert.deepEqual(calls.quitAndInstall[0], { silent: false, restart: true });
});

test("UPDATE_STRATEGIES is the canonical list", () => {
  assert.deepEqual(UPDATE_STRATEGIES, ["off", "manual", "notify", "auto"]);
  assert.equal(DEFAULT_UPDATE_STRATEGY, "off", "default must be off — first-run consent flow turns it up");
});

test("two concurrent checkForUpdates calls coalesce — autoUpdater.checkForUpdates fires once", async () => {
  let resolveCheck;
  let upstreamCalls = 0;
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: () => {},
    checkForUpdates: () => {
      upstreamCalls += 1;
      return new Promise(r => { resolveCheck = r; });
    },
    downloadUpdate: async () => {},
    quitAndInstall: () => {}
  };
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "manual" });
  const p1 = u.checkForUpdates({ trigger: "user" });
  const p2 = u.checkForUpdates({ trigger: "user" });
  // Let the first call register `pendingCheck` and queue the second.
  await new Promise(resolve => setImmediate(resolve));
  resolveCheck({ updateInfo: { version: "1.2.3" } });
  await Promise.all([p1, p2]);
  assert.equal(upstreamCalls, 1, "in-flight check must coalesce — autoUpdater.checkForUpdates should be called exactly once for two overlapping triggers");
});

test("getStatus returns strategy + lastCheckedAt + downloaded info", async () => {
  const { fake, emitter } = makeFakeAutoUpdater();
  const u = createAutoUpdater({ autoUpdater: fake, getStrategy: () => "manual" });
  let status = u.getStatus();
  assert.equal(status.strategy, "manual");
  assert.equal(status.lastCheckedAt, null);
  assert.equal(status.downloaded, null);
  await u.checkForUpdates({ trigger: "user" });
  status = u.getStatus();
  assert.ok(status.lastCheckedAt, "lastCheckedAt must be set after a check");
  emitter.emit("update-downloaded", { version: "1.2.3", releaseDate: "2026-05-07" });
  await new Promise(resolve => setImmediate(resolve));
  status = u.getStatus();
  assert.equal(status.downloaded.version, "1.2.3");
});
