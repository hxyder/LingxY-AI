import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readDesktopTrayIpcModules() {
  const ipcDir = path.join(repoRoot, "src/desktop/main/ipc");
  const entries = await readdir(ipcDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && /\.mjs$/u.test(entry.name))
      .map((entry) => readFile(path.join(ipcDir, entry.name), "utf8"))
  );
}

const packageJson = JSON.parse(await read("package.json"));
assert.equal(packageJson.main, "index.cjs");

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("bubbleArea"), true);
assert.equal(overlayHtml.includes("commandInput"), true);
assert.equal(overlayHtml.includes("clipboardBtn"), true);
assert.equal(
  overlayHtml.includes("resultToast") || overlayHtml.includes("result-toast retired"),
  true
);

const overlayJs = await read("src/desktop/renderer/overlay.js");
assert.equal(overlayJs.includes("applyShellHandoff"), true);
assert.equal(overlayJs.includes("pendingFileSelection"), true);
assert.equal(overlayJs.includes("onContextReceived"), true);
assert.equal(overlayJs.includes("pendingCapture"), true);
assert.equal(overlayJs.includes("showContextReceivedBubble"), true);
assert.equal(overlayJs.includes("hotkey_capture"), true);
assert.equal(overlayJs.includes("pendingActiveWindowContext"), true);
assert.equal(overlayJs.includes("resolveActiveWindowBrowserCapture"), true);
assert.equal(overlayJs.includes("/browser/context/recent?"), true);

const preload = await read("src/desktop/renderer/preload.cjs");
assert.equal(preload.includes("onContextReceived"), true);
assert.equal(preload.includes("resolveDroppedFilePaths"), true);
assert.equal(preload.includes("submitDroppedFiles"), true);

const mainProcess = [
  await read("src/desktop/tray/electron-main.mjs"),
  await read("src/desktop/tray/desktop-launch-args.mjs"),
  await read("src/desktop/tray/desktop-handoff-watcher.mjs"),
  await read("src/desktop/shell/desktop-shortcut-router.mjs"),
  ...(await readDesktopTrayIpcModules())
].join("\n");
const windowsPipeServer = await read("src/service/core/windows-pipe-server.mjs");
assert.equal(mainProcess.includes("requestSingleInstanceLock"), true);
assert.equal(mainProcess.includes("--uca-handoff-file"), true);
assert.equal(mainProcess.includes("shellContextReceived"), true);
assert.equal(mainProcess.includes("drainHandoffDirectory"), true);
assert.equal(mainProcess.includes("startHandoffWatcher"), true);
assert.equal(mainProcess.includes("await consumeHandoffFile(handoffFile)"), true);
assert.equal(mainProcess.includes("error?.code === \"ENOENT\""), true);
assert.equal(mainProcess.includes("captureActiveWindowContext"), true);
assert.equal(mainProcess.includes("capture-context.ps1"), true);
assert.equal(mainProcess.includes("shellSubmitDroppedFiles"), true);
assert.equal(mainProcess.includes("hotkey_preview"), true);
{
  const start = mainProcess.indexOf('if (shortcut.id === "capture-and-ask")');
  const end = mainProcess.indexOf('if (shortcut.id === "capture-screenshot")', start);
  const block = mainProcess.slice(start, end);
  const captureIndex = block.indexOf("captureActiveWindowContext({");
  const firstOverlayIndex = block.indexOf('showWindow("overlay")');
  assert.ok(start >= 0 && end > start, "capture-and-ask hotkey block must be present");
  assert.ok(captureIndex >= 0, "capture-and-ask must run active-window capture");
  assert.ok(firstOverlayIndex > captureIndex,
    "capture-and-ask must start foreground capture before focusing the overlay, then hydrate asynchronously");
}
assert.ok(mainProcess.includes("Dropping onto the dock is mode-aware:")
    && /shellSubmitDroppedFiles[\s\S]{0,700}const settings = await loadSettings\(\);[\s\S]{0,520}if \(!settings\?\.echoMode\)[\s\S]{0,80}showWindow\("overlay"\)[\s\S]{0,360}enqueueWindowMessage\(\s*"overlay"/.test(mainProcess),
  "dock file drop mode policy must live in main: normal opens overlay, Echo only hands off context");
assert.match(mainProcess,
  /surface:\s*settings\?\.echoMode \? "echo_receipt" : "overlay"/,
  "dock file drop must return a structured surface so the dock only renders feedback");
assert.doesNotMatch(overlayJs + await read("src/desktop/renderer/dock.js"),
  /announceDroppedFiles[\s\S]{0,700}showWindow\?\.\("overlay"\)/,
  "dock renderer must not duplicate the main-process overlay-open policy");

const helperProgram = await read("src/helper/explorer_selection/UcaExplorerSelectionHelper/Program.cs");
assert.equal(helperProgram.includes("overlay_prompt"), true);
assert.equal(helperProgram.includes("--uca-open-overlay"), true);
assert.equal(helperProgram.includes("explorer-selection-batch.json"), true);
assert.equal(helperProgram.includes("--electron-cli"), true);
assert.equal(helperProgram.includes("ELECTRON_RUN_AS_NODE"), true);
assert.match(windowsPipeServer,
  /submitFileTask\(\{[\s\S]{0,260}background:\s*true[\s\S]{0,80}runtime/,
  "Explorer/file-selection pipe must return after task creation instead of waiting for file ingest/execution");

const installScript = await read("scripts/install-explorer-entry.ps1");
assert.equal(installScript.includes("UcaExplorerSelectionHelper.exe"), true);
assert.equal(installScript.includes("--launch-mode overlay_prompt"), true);
assert.equal(installScript.includes("--electron-cli"), true);

console.log("Context handoff UI verification passed.");
