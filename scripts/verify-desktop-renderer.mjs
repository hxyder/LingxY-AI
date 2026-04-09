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

const preload = await read("src/desktop/renderer/preload.cjs");
assert.equal(preload.includes(IPC_CHANNELS.shellStatus), true);
assert.equal(preload.includes(IPC_CHANNELS.shellShowWindow), true);
assert.equal(preload.includes(IPC_CHANNELS.shellHideWindow), true);

const consoleHtml = await read("src/desktop/renderer/console.html");
assert.equal(consoleHtml.includes("主控工作台"), true);
assert.equal(consoleHtml.includes("首启引导"), true);
assert.equal(consoleHtml.includes("审批中心"), true);
assert.equal(consoleHtml.includes("DAG 工作流"), true);
assert.equal(consoleHtml.includes("隐私与安全"), true);
assert.equal(consoleHtml.includes("审计日志"), true);
assert.equal(consoleHtml.includes("模板工作区"), true);

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("快速输入"), true);
assert.equal(overlayHtml.includes("立即执行"), true);

const dockHtml = await read("src/desktop/renderer/dock.html");
assert.equal(dockHtml.includes("拖文件到这里"), true);

const mainProcess = await read("src/desktop/tray/electron-main.mjs");
assert.equal(mainProcess.includes("preload: PRELOAD_PATH"), true);
assert.equal(mainProcess.includes("buildWindowUrl"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.shellSubmitDroppedFiles"), true);

console.log("Desktop renderer verification passed.");
