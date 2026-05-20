import test from "node:test";
import assert from "node:assert/strict";

import { createDesktopWindowActions } from "../../src/desktop/shell/desktop-window-actions.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeWindow(events) {
  return {
    isMinimized: () => false,
    isVisible: () => false,
    isDestroyed: () => false,
    showInactive() { events.push("showInactive"); },
    show() { events.push("show"); },
    moveTop() { events.push("moveTop"); },
    focus() { events.push("focus"); },
    setAlwaysOnTop(value, level) { events.push(`alwaysOnTop:${value}:${level}`); }
  };
}

function createActions(events, windows) {
  return createDesktopWindowActions({
    windows,
    DESKTOP_SHELL_MANIFEST: {
      windows: [{ id: "overlay", width: 640, height: 480 }]
    },
    DOCK_WINDOW_ID: "dock",
    getWindowPreferences: () => ({}),
    setManagedWindowBounds() { events.push("bounds"); },
    resolveWindowBounds: () => ({ x: 0, y: 0, width: 640, height: 480 }),
    enforceDockWindowInvariants() { events.push("dockInvariant"); },
    applyWindowPresentation(windowId) { events.push(`presentation:${windowId}`); },
    enqueueWindowMessage() {},
    IPC_CHANNELS: {},
    foregroundRestoreMs: 1
  });
}

test("showWindow forceForeground temporarily raises an inactive overlay without stealing focus", async () => {
  const events = [];
  const overlay = createFakeWindow(events);
  const windows = new Map([["overlay", overlay]]);
  const { showWindow } = createActions(events, windows);

  assert.equal(showWindow("overlay", { focus: false, moveTop: true, forceForeground: true }), true);

  assert.deepEqual(events.slice(0, 5), [
    "bounds",
    "presentation:overlay",
    "alwaysOnTop:true:screen-saver",
    "showInactive",
    "moveTop"
  ]);
  assert.equal(events.includes("focus"), false);

  await delay(10);
  assert.equal(events.filter((event) => event === "presentation:overlay").length, 2);
});

test("showWindow forceForeground focuses the overlay when focus is allowed", () => {
  const events = [];
  const overlay = createFakeWindow(events);
  const windows = new Map([["overlay", overlay]]);
  const { showWindow } = createActions(events, windows);

  assert.equal(showWindow("overlay", { forceForeground: true }), true);

  assert.ok(events.indexOf("alwaysOnTop:true:screen-saver") < events.indexOf("show"));
  assert.ok(events.indexOf("moveTop") < events.indexOf("focus"));
});
