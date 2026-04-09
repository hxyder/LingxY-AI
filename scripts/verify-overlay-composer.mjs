import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS } from "../src/desktop/shared/manifest.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("读取剪贴板"), true);
assert.equal(overlayHtml.includes("清空上下文"), true);
assert.equal(overlayHtml.includes("最近任务"), true);

const overlayJs = await read("src/desktop/renderer/overlay.js");
assert.equal(overlayJs.includes("loadClipboardIntoContext"), true);
assert.equal(overlayJs.includes("refreshActiveTask"), true);
assert.equal(overlayJs.includes("onWindowFocused"), true);

const preload = await read("src/desktop/renderer/preload.cjs");
assert.equal(preload.includes("readClipboardText"), true);
assert.equal(preload.includes(IPC_CHANNELS.shellReady), true);
assert.equal(preload.includes(IPC_CHANNELS.shellWindowFocused), true);

const mainProcess = await read("src/desktop/tray/electron-main.mjs");
assert.equal(mainProcess.includes("did-finish-load"), true);
assert.equal(mainProcess.includes("browserWindow.on(\"focus\""), true);
assert.equal(mainProcess.includes("webContents.send(IPC_CHANNELS.shellReady"), true);

console.log("Overlay composer verification passed.");
