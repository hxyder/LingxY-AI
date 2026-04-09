import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const packageJson = JSON.parse(await read("package.json"));
assert.equal(packageJson.main, "index.cjs");

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("文件上下文"), true);
assert.equal(overlayHtml.includes("pendingFilesSummary"), true);

const overlayJs = await read("src/desktop/renderer/overlay.js");
assert.equal(overlayJs.includes("applyExplorerHandoff"), true);
assert.equal(overlayJs.includes("filePaths"), true);
assert.equal(overlayJs.includes("onContextReceived"), true);

const preload = await read("src/desktop/renderer/preload.cjs");
assert.equal(preload.includes("onContextReceived"), true);

const mainProcess = await read("src/desktop/tray/electron-main.mjs");
assert.equal(mainProcess.includes("requestSingleInstanceLock"), true);
assert.equal(mainProcess.includes("--uca-handoff-file"), true);
assert.equal(mainProcess.includes("shellContextReceived"), true);

const helperProgram = await read("src/helper/explorer_selection/UcaExplorerSelectionHelper/Program.cs");
assert.equal(helperProgram.includes("overlay_prompt"), true);
assert.equal(helperProgram.includes("--uca-open-overlay"), true);
assert.equal(helperProgram.includes("explorer-selection-batch.json"), true);
assert.equal(helperProgram.includes("--electron-cli"), true);

const installScript = await read("scripts/install-explorer-entry.ps1");
assert.equal(installScript.includes("UcaExplorerSelectionHelper.exe"), true);
assert.equal(installScript.includes("--launch-mode overlay_prompt"), true);
assert.equal(installScript.includes("--electron-cli"), true);

console.log("Context handoff UI verification passed.");
