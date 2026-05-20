import test from "node:test";
import assert from "node:assert/strict";

import { createShortcutRouter } from "../../src/desktop/shell/desktop-shortcut-router.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("capture-and-ask shows overlay immediately and hydrates context asynchronously", async () => {
  const events = [];
  const captureOptions = [];
  let captureInFlight = false;
  let resolveCapture;
  const windowMessages = [];
  const windows = new Map([
    ["overlay", {
      webContents: {
        send(channel, payload) {
          events.push(`send:${channel}`);
          windowMessages.push({ channel, payload });
        }
      }
    }]
  ]);

  const router = createShortcutRouter({
    showWindow(windowId, options = {}) {
      events.push(`show:${windowId}:${options?.focus !== false}:${options?.moveTop === true}:${options?.forceForeground === true}`);
    },
    captureActiveWindowContext(options) {
      captureOptions.push(options);
      events.push("capture:start");
      return new Promise((resolve) => {
        resolveCapture = () => {
          events.push("capture:resolve");
          resolve({
            processName: "notepad",
            windowTitle: "notes.txt - Notepad",
            filePaths: [],
            selectedText: "selected text",
            activeWindow: {
              process: "notepad",
              title: "notes.txt - Notepad",
              detectedKind: "window_title",
              blocked: false,
              extra: {}
            }
          });
        };
      });
    },
    buildShellContextPayload({ context }) {
      events.push("context:build");
      return { targetWindow: "overlay", capture: { text: context.selectedText } };
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) {
      captureInFlight = value;
      events.push(`inFlight:${value}`);
    },
    clipboard: { readText: () => "" },
    enqueueWindowMessage(windowId, channel, payload) {
      events.push(`enqueue:${windowId}:${channel}`);
      windowMessages.push({ channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskClipboardPollMs: 5
  });

  const handler = router.buildShortcutHandler({
    id: "capture-and-ask",
    accelerator: "Ctrl+Shift+Space"
  });
  handler();

  assert.deepEqual(events.slice(0, 4), [
    "inFlight:true",
    "capture:start",
    "show:overlay:false:true:true",
    "send:uca:shortcut-triggered"
  ]);
  assert.equal(captureInFlight, true);

  resolveCapture();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(events.indexOf("context:build") > events.indexOf("capture:resolve"));
  assert.ok(events.includes("enqueue:overlay:uca:shell-context-received"));
  assert.ok(events.includes("show:overlay:true:false:true"));
  assert.equal(events.at(-1), "inFlight:false");
  assert.equal(captureInFlight, false);
  assert.equal(captureOptions[0]?.activeWindowEnabled, false);
  assert.equal(windowMessages.filter((message) => message.channel === "uca:shortcut-triggered").length, 1);
});

test("capture-and-ask reports an empty capture instead of leaving overlay pending", async () => {
  const calls = [];
  const enqueued = [];
  const shown = [];
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow(windowId, options = {}) {
      shown.push({ windowId, focus: options?.focus !== false, forceForeground: options?.forceForeground === true });
    },
    async captureActiveWindowContext(options) {
      calls.push(options);
      return {
        processName: null,
        windowTitle: null,
        filePaths: [],
        selectedText: null,
        activeWindow: null
      };
    },
    buildShellContextPayload() {
      throw new Error("empty capture should not build a context payload");
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) { captureInFlight = value; },
    clipboard: { readText: () => "" },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskActivePreviewDelayMs: 1,
    captureAndAskClipboardPollMs: 5
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await delay(30);

  assert.equal(calls.length, 2);
  assert.deepEqual(shown.map((entry) => entry.focus), [false, true]);
  assert.deepEqual(shown.map((entry) => entry.forceForeground), [true, true]);
  assert.equal(enqueued[0]?.payload?.capture_status, "empty");
  assert.match(enqueued[0]?.payload?.error, /没有捕获到选中内容/);
  assert.equal(captureInFlight, false);
});

test("capture-and-ask times out a stuck selection capture and releases the hotkey", async () => {
  const enqueued = [];
  const shown = [];
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow(windowId, options = {}) {
      shown.push({ windowId, focus: options?.focus !== false, forceForeground: options?.forceForeground === true });
    },
    captureActiveWindowContext() {
      return new Promise(() => {});
    },
    buildShellContextPayload() {
      throw new Error("timed-out capture should not build a context payload");
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) { captureInFlight = value; },
    clipboard: { readText: () => "" },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskSelectionTimeoutMs: 20,
    captureAndAskWindowTimeoutMs: 20,
    captureAndAskActivePreviewDelayMs: 1,
    captureAndAskClipboardPollMs: 5
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  assert.equal(captureInFlight, true);
  await delay(40);

  assert.deepEqual(shown.map((entry) => entry.focus), [false, true]);
  assert.deepEqual(shown.map((entry) => entry.forceForeground), [true, true]);
  assert.equal(enqueued[0]?.payload?.capture_status, "timeout");
  assert.match(enqueued[0]?.payload?.error, /超时/);
  assert.equal(captureInFlight, false);
});

test("capture-and-ask waits briefly for delayed clipboard selection after simulated copy", async () => {
  const calls = [];
  const enqueued = [];
  let captureInFlight = false;
  let clipboardText = "old clipboard";
  setTimeout(() => {
    clipboardText = "fresh selected text from the foreground app";
  }, 20);
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow() {},
    async captureActiveWindowContext(options) {
      calls.push(options);
      return {
        processName: "chrome",
        windowTitle: "Example",
        filePaths: [],
        selectedText: null,
        activeWindow: null
      };
    },
    buildShellContextPayload({ context }) {
      return { targetWindow: "overlay", capture: { text: context.selectedText } };
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) { captureInFlight = value; },
    clipboard: { readText: () => clipboardText },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskClipboardPollMs: 120
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await delay(90);

  assert.equal(calls.length, 1, "delayed clipboard text should avoid active-window fallback");
  assert.equal(enqueued[0]?.payload?.capture?.text, "fresh selected text from the foreground app");
  assert.equal(captureInFlight, false);
});

test("capture-and-ask sends selected files without waiting for active-window fallback", async () => {
  const calls = [];
  const enqueued = [];
  let clipboardReads = 0;
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow() {},
    async captureActiveWindowContext(options) {
      calls.push(options);
      return {
        processName: "explorer",
        windowTitle: "Documents",
        filePaths: ["E:\\docs\\resume.docx"],
        selectedText: null,
        activeWindow: null
      };
    },
    buildShellContextPayload({ context }) {
      return { targetWindow: "overlay", file_paths: context.filePaths };
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) { captureInFlight = value; },
    clipboard: {
      readText: () => {
        clipboardReads += 1;
        return "";
      }
    },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskClipboardPollMs: 5
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.activeWindowEnabled, false);
  assert.deepEqual(enqueued[0]?.payload?.file_paths, ["E:\\docs\\resume.docx"]);
  assert.ok(clipboardReads <= 2, "file captures may start a cheap clipboard race but must not wait for it");
});

test("capture-and-ask falls back to active window only when no selection exists", async () => {
  const calls = [];
  const enqueued = [];
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow() {},
    async captureActiveWindowContext(options) {
      calls.push(options);
      if (calls.length === 1) {
        return {
          processName: null,
          windowTitle: null,
          filePaths: [],
          selectedText: null,
          activeWindow: null
        };
      }
      return {
        processName: "winword",
        windowTitle: "Resume.docx - Word",
        filePaths: [],
        selectedText: null,
        activeWindow: {
          process: "winword",
          title: "Resume.docx - Word",
          detectedKind: "file_path",
          filePath: "E:\\docs\\resume.docx",
          blocked: false,
          extra: {}
        }
      };
    },
    buildShellContextPayload({ context }) {
      return { targetWindow: "overlay", active_window: context.activeWindow };
    },
    getCaptureInFlight: () => captureInFlight,
    setCaptureInFlight(value) { captureInFlight = value; },
    clipboard: { readText: () => "" },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows,
    captureAndAskActivePreviewDelayMs: 1,
    captureAndAskClipboardPollMs: 5
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await delay(30);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.activeWindowEnabled, false);
  assert.equal(calls[1]?.includeSelection, false);
  assert.equal(calls[1]?.activeWindowEnabled, true);
  assert.equal(enqueued[0]?.payload?.active_window?.process, "winword");
});
