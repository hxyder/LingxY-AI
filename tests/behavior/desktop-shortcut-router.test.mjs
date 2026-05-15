import test from "node:test";
import assert from "node:assert/strict";

import { createShortcutRouter } from "../../src/desktop/shell/desktop-shortcut-router.mjs";

test("capture-and-ask starts capture before showing overlay and hydrates context asynchronously", async () => {
  const events = [];
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
    captureActiveWindowContext() {
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
  assert.equal(windowMessages.filter((message) => message.channel === "uca:shortcut-triggered").length, 1);
});
