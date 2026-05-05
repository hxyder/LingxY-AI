import test from "node:test";
import assert from "node:assert/strict";
import {
  DESKTOP_CONSOLE_ACTOR,
  DESKTOP_OVERLAY_ACTOR,
  DESKTOP_POPUP_CARD_ACTOR,
  DESKTOP_SHELL_ACTOR,
  DESKTOP_UNKNOWN_ACTOR,
  desktopActorForSender,
  desktopActorForWindowId
} from "../../src/desktop/tray/desktop-actor.mjs";

test("desktop actor mapping keeps known windows narrow", () => {
  assert.equal(desktopActorForWindowId("console"), DESKTOP_CONSOLE_ACTOR);
  assert.equal(desktopActorForWindowId("overlay"), DESKTOP_OVERLAY_ACTOR);
  assert.equal(desktopActorForWindowId("popup-card"), DESKTOP_POPUP_CARD_ACTOR);
  assert.equal(desktopActorForWindowId("dock"), DESKTOP_SHELL_ACTOR);
  assert.equal(desktopActorForWindowId("echo-bubble"), DESKTOP_SHELL_ACTOR);
});

test("desktop actor mapping fails closed for unknown windows and senders", () => {
  assert.equal(desktopActorForWindowId("preview"), DESKTOP_UNKNOWN_ACTOR);
  assert.equal(desktopActorForWindowId("unknown-window"), DESKTOP_UNKNOWN_ACTOR);
  assert.equal(desktopActorForWindowId(""), DESKTOP_UNKNOWN_ACTOR);
  assert.equal(desktopActorForSender(null), DESKTOP_UNKNOWN_ACTOR);
  assert.equal(desktopActorForSender({ id: "sender" }, new Map()), DESKTOP_UNKNOWN_ACTOR);
});

test("desktop actor lookup resolves from registered BrowserWindow webContents only", () => {
  const consoleSender = { id: "console-webcontents" };
  const unknownSender = { id: "detached-webcontents" };
  const windows = new Map([
    ["console", { webContents: consoleSender }],
    ["dock", { webContents: { id: "dock-webcontents" } }]
  ]);

  assert.equal(desktopActorForSender(consoleSender, windows), DESKTOP_CONSOLE_ACTOR);
  assert.equal(desktopActorForSender(unknownSender, windows), DESKTOP_UNKNOWN_ACTOR);
});
