import assert from "node:assert/strict";
import test from "node:test";

import { registerShellOpenUrlIpc } from "../../src/desktop/main/ipc/register-shell-open-url-ipc.mjs";

function makeWindow({ visible = true } = {}) {
  return {
    shown: false,
    focused: false,
    isDestroyed: () => false,
    isVisible: () => visible,
    show() {
      this.shown = true;
    },
    focus() {
      this.focused = true;
    }
  };
}

function registerHarness({
  senderWindow = null,
  focusedWindow = null,
  choiceResponse = 1
} = {}) {
  let handler = null;
  const calls = {
    messageBoxes: [],
    openExternal: [],
    linkBrowser: []
  };
  const ipcMain = {
    handle(channel, callback) {
      assert.equal(channel, "uca:shell-open-url");
      handler = callback;
    }
  };
  const BrowserWindow = {
    fromWebContents(sender) {
      assert.equal(sender, "sender");
      return senderWindow;
    },
    getFocusedWindow() {
      return focusedWindow;
    }
  };
  registerShellOpenUrlIpc({
    ipcMain,
    IPC_CHANNELS: { shellOpenUrl: "uca:shell-open-url" },
    BrowserWindow,
    brandIcons: {
      showBrandedMessageBox(...args) {
        calls.messageBoxes.push(args);
        return { response: choiceResponse };
      }
    },
    dialog: {},
    shell: {
      async openExternal(url) {
        calls.openExternal.push(url);
      }
    },
    normalizeOpenableUrl(value) {
      return new URL(String(value)).toString();
    },
    readLinkOpenPreference() {
      return "system";
    },
    showLinkBrowserWindow(url) {
      calls.linkBrowser.push(url);
      return { ok: true, mode: "lingxy_browser" };
    }
  });
  return { handler, calls };
}

test("ask-before-open uses a visible focused owner when the sender window is hidden", async () => {
  const senderWindow = makeWindow({ visible: false });
  const focusedWindow = makeWindow({ visible: true });
  const { handler, calls } = registerHarness({ senderWindow, focusedWindow, choiceResponse: 1 });

  const result = await handler({ sender: "sender" }, { url: "https://example.com", ask: true });

  assert.deepEqual(result, { ok: true, mode: "system" });
  assert.equal(calls.messageBoxes.length, 1);
  assert.equal(calls.messageBoxes[0][1], focusedWindow);
  assert.deepEqual(calls.openExternal, ["https://example.com/"]);
  assert.equal(senderWindow.shown, false);
});

test("ask-before-open falls back to the no-owner dialog overload when no visible owner exists", async () => {
  const senderWindow = makeWindow({ visible: false });
  const { handler, calls } = registerHarness({ senderWindow, focusedWindow: null, choiceResponse: 2 });

  const result = await handler({ sender: "sender" }, { url: "https://example.com", ask: true });

  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.equal(calls.messageBoxes.length, 1);
  assert.equal(calls.messageBoxes[0].length, 2);
  assert.equal(calls.messageBoxes[0][1].message, "用什么方式打开这个链接？");
  assert.deepEqual(calls.openExternal, []);
  assert.deepEqual(calls.linkBrowser, []);
});
