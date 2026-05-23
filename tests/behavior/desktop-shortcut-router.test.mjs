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
      events.push(options?.includeSelection === false ? "capture:active:start" : "capture:selection:start");
      if (options?.includeSelection === false) {
        return Promise.resolve({
          processName: null,
          windowTitle: null,
          filePaths: [],
          selectedText: null,
          activeWindow: null
        });
      }
      return new Promise((resolve) => {
        resolveCapture = () => {
          events.push("capture:selection:resolve");
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

  assert.deepEqual(events.slice(0, 5), [
    "inFlight:true",
    "capture:selection:start",
    "capture:active:start",
    "show:overlay:false:true:true",
    "send:uca:shortcut-triggered"
  ]);
  assert.equal(captureInFlight, true);

  resolveCapture();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(events.indexOf("context:build") > events.indexOf("capture:selection:resolve"));
  assert.ok(events.includes("enqueue:overlay:uca:shell-context-received"));
  assert.ok(events.includes("show:overlay:true:false:true"));
  assert.equal(events.at(-1), "inFlight:false");
  assert.equal(captureInFlight, false);
  assert.equal(captureOptions[0]?.activeWindowEnabled, false);
  assert.equal(captureOptions[1]?.includeSelection, false);
  assert.equal(captureOptions[1]?.activeWindowEnabled, true);
  assert.equal(captureOptions[1]?.preferLastExternal, false);
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

  assert.equal(calls.length, 2, "active-window probe may start eagerly but delayed clipboard text should win");
  assert.equal(calls[1]?.includeSelection, false);
  assert.equal(calls[1]?.preferLastExternal, false);
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

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.activeWindowEnabled, false);
  assert.equal(calls[1]?.includeSelection, false);
  assert.equal(calls[1]?.preferLastExternal, false);
  assert.deepEqual(enqueued[0]?.payload?.file_paths, ["E:\\docs\\resume.docx"]);
  assert.ok(clipboardReads <= 2, "file captures may start a cheap clipboard race but must not wait for it");
});

test("capture-and-ask does not flash Explorer window preview before selected files arrive", async () => {
  const enqueued = [];
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() {} } }]
  ]);

  const router = createShortcutRouter({
    showWindow() {},
    async captureActiveWindowContext(options) {
      if (options?.includeSelection === false) {
        return {
          processName: "explorer",
          windowTitle: "Downloads",
          filePaths: [],
          selectedText: null,
          activeWindow: {
            process: "explorer",
            title: "Downloads",
            detectedKind: "window_title",
            blocked: false,
            extra: {}
          }
        };
      }
      await delay(80);
      return {
        processName: "explorer",
        windowTitle: "Downloads",
        filePaths: ["E:\\docs\\selected.xlsx"],
        selectedText: null,
        activeWindow: null
      };
    },
    buildShellContextPayload({ context }) {
      return context.filePaths?.length
        ? { targetWindow: "overlay", file_paths: context.filePaths }
        : { targetWindow: "overlay", active_window: context.activeWindow };
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
    captureAndAskClipboardPollMs: 5,
    captureAndAskSelectionTimeoutMs: 180
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await delay(40);
  assert.equal(enqueued.length, 0, "Explorer window preview must wait for the file selection race");

  await delay(90);
  assert.deepEqual(enqueued.map((entry) => entry.payload?.file_paths ?? null), [["E:\\docs\\selected.xlsx"]]);
  assert.equal(enqueued.some((entry) => entry.payload?.active_window?.process === "explorer"), false);
  assert.equal(captureInFlight, false);
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

test("capture-and-ask keeps browser active-window fallback alive long enough for cold URL probes", async () => {
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
      if (options?.includeSelection === false) {
        await delay(1100);
        return {
          processName: "chrome",
          windowTitle: "Example Domain - Google Chrome",
          filePaths: [],
          selectedText: null,
          activeWindow: {
            process: "chrome",
            title: "Example Domain - Google Chrome",
            detectedKind: "web_url",
            url: "https://example.com",
            blocked: false,
            extra: {}
          }
        };
      }
      return {
        processName: "chrome",
        windowTitle: "Example Domain - Google Chrome",
        filePaths: [],
        selectedText: null,
        activeWindow: null
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
    captureAndAskClipboardPollMs: 5,
    captureAndAskSelectionTimeoutMs: 30
  });

  router.buildShortcutHandler({ id: "capture-and-ask", accelerator: "Ctrl+Shift+Space" })();
  await delay(1250);

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.includeSelection, false);
  assert.equal(calls[1]?.activeWindowEnabled, true);
  assert.equal(enqueued[0]?.payload?.active_window?.url, "https://example.com");
  assert.equal(enqueued[0]?.payload?.active_window?.filePath, undefined);
  assert.equal(captureInFlight, false);
});

test("capture-and-ask starts active-window probe before overlay focus and never reuses stale external context", async () => {
  const events = [];
  const calls = [];
  const enqueued = [];
  let captureInFlight = false;
  const windows = new Map([
    ["overlay", { webContents: { send() { events.push("shortcut:sent"); } } }]
  ]);

  const router = createShortcutRouter({
    showWindow(windowId, options = {}) {
      events.push(`show:${windowId}:${options?.focus !== false}`);
    },
    async captureActiveWindowContext(options) {
      calls.push(options);
      events.push(options?.includeSelection === false ? "capture:active" : "capture:selection");
      if (options?.includeSelection === false) {
        assert.equal(options.preferLastExternal, false);
        return {
          processName: "chrome",
          windowTitle: "Current Article - Chrome",
          filePaths: [],
          selectedText: null,
          activeWindow: {
            process: "chrome",
            title: "Current Article - Chrome",
            detectedKind: "web_url",
            url: "https://example.test/current-article",
            blocked: false,
            extra: {}
          }
        };
      }
      return {
        processName: "explorer",
        windowTitle: "Old folder",
        filePaths: [],
        selectedText: null,
        activeWindow: null
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

  const activeCaptureIndex = events.indexOf("capture:active");
  const showIndex = events.findIndex((entry) => entry.startsWith("show:overlay"));
  assert.ok(activeCaptureIndex >= 0 && showIndex > activeCaptureIndex,
    "active-window probe must begin while the user's original app is still foreground");
  assert.equal(calls[1]?.preferLastExternal, false);
  assert.equal(enqueued[0]?.payload?.active_window?.url, "https://example.test/current-article");
  assert.equal(enqueued[0]?.payload?.active_window?.filePath, undefined);
  assert.equal(captureInFlight, false);
});
