import test from "node:test";
import assert from "node:assert/strict";

import { createShortcutRouter } from "../../src/desktop/shell/desktop-shortcut-router.mjs";

test("capture-and-ask starts capture before showing overlay and hydrates context asynchronously", async () => {
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
    showWindow(windowId) {
      events.push(`show:${windowId}`);
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
    windows
  });

  const handler = router.buildShortcutHandler({
    id: "capture-and-ask",
    accelerator: "Ctrl+Shift+Space"
  });
  handler();

  assert.deepEqual(events.slice(0, 4), [
    "inFlight:true",
    "capture:start",
    "show:overlay",
    "send:uca:shortcut-triggered"
  ]);
  assert.equal(captureInFlight, true);

  resolveCapture();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(events.indexOf("context:build") > events.indexOf("capture:resolve"));
  assert.ok(events.includes("enqueue:overlay:uca:shell-context-received"));
  assert.equal(events.at(-1), "inFlight:false");
  assert.equal(captureInFlight, false);
  assert.equal(captureOptions[0]?.activeWindowEnabled, false);
  assert.equal(windowMessages.filter((message) => message.channel === "uca:shortcut-triggered").length, 1);
});

test("capture-and-ask sends selected files without waiting for active-window fallback", async () => {
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
    clipboard: { readText: () => "" },
    enqueueWindowMessage(windowId, channel, payload) {
      enqueued.push({ windowId, channel, payload });
    },
    IPC_CHANNELS: {
      shortcutTriggered: "uca:shortcut-triggered",
      shellContextReceived: "uca:shell-context-received"
    },
    windows
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.activeWindowEnabled, false);
  assert.deepEqual(enqueued[0]?.payload?.file_paths, ["E:\\docs\\resume.docx"]);
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
    windows
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.activeWindowEnabled, false);
  assert.equal(calls[1]?.includeSelection, false);
  assert.equal(calls[1]?.activeWindowEnabled, true);
  assert.equal(enqueued[0]?.payload?.active_window?.process, "winword");
});
