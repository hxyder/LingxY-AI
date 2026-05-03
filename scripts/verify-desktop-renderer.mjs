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
assert.equal(preload.includes("previewMcpInstall"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpInstallPreview), true);
assert.equal(preload.includes("runMcpInstall"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpInstallRun), true);

const consoleHtml = await read("src/desktop/renderer/console.html");
// Brand renamed: UCA → LingxY. Accept either the old title (still
// shipped in older builds) or the new LingxY title.
assert.ok(
  consoleHtml.includes("LingxY Console") || consoleHtml.includes("UCA Console"),
  "console must carry a LingxY Console (or legacy UCA Console) title"
);
assert.equal(consoleHtml.includes("Tasks"), true);
assert.equal(consoleHtml.includes("Settings"), true);
assert.equal(consoleHtml.includes("data-tab=\"projects\""), true);
assert.equal(consoleHtml.includes("panel-projects"), true);
assert.equal(consoleHtml.includes("projectList"), true);
assert.equal(consoleHtml.includes("projectConversationList"), true);
assert.equal(consoleHtml.includes("DAG Workflow"), true);
assert.equal(consoleHtml.includes("Privacy & Security"), true);
assert.equal(consoleHtml.includes("Audit Log"), true);
assert.equal(consoleHtml.includes("Templates"), true);
assert.equal(consoleHtml.includes("One-click Setup"), true);
// Files tab (artifact manager)
assert.equal(consoleHtml.includes("data-tab=\"files\""), true);
assert.equal(consoleHtml.includes("panel-files"), true);
assert.equal(consoleHtml.includes("filesList"), true);
assert.equal(consoleHtml.includes("filesPreviewBody"), true);

const consoleJs = await read("src/desktop/renderer/console.js");
assert.equal(consoleJs.includes("loadAllArtifacts"), true);
assert.equal(consoleJs.includes("renderFilesList"), true);
assert.equal(consoleJs.includes("selectFileArtifact"), true);
assert.equal(consoleJs.includes("CODE_EXTENSIONS"), true);
assert.equal(consoleJs.includes("PROJECT_STORE_KEY"), true);
assert.equal(consoleJs.includes("syncConsoleProjectStoreFromService"), true);
assert.equal(consoleJs.includes("/projects/store"), true);
assert.equal(consoleJs.includes("renderProjectsWorkspace"), true);
assert.equal(consoleJs.includes("projectCreateForm"), true);
assert.equal(consoleJs.includes('from "./console-task-event-stream.mjs"'), true);
assert.equal(
  /let\s+selectedTaskEventStream\b/.test(consoleJs),
  false,
  "console.js must keep selected task SSE state inside console-task-event-stream.mjs"
);

const overlayJs = await read("src/desktop/renderer/overlay.js");
for (const [fileName, source] of [
  ["console.js", consoleJs],
  ["overlay.js", overlayJs]
]) {
  assert.equal(
    /(?:function|const|let|var)\s+escapeHtml\b/.test(source),
    false,
    `${fileName} must use shared-ui escapeHtml instead of redefining it`
  );
  assert.equal(
    /(?:function|const|let|var)\s+createBottomPinController\b/.test(source),
    false,
    `${fileName} must use shared-ui createBottomPinController instead of redefining it`
  );
}
assert.equal(consoleJs.includes("from \"./shared-ui.mjs\""), true);
assert.equal(overlayJs.includes("from \"./shared-ui.mjs\""), true);

// UCA-048: console settings has output path + feature toggles
assert.equal(consoleHtml.includes("outputDirInput"), true);
assert.equal(consoleHtml.includes("featureToggleList"), true);
assert.equal(consoleHtml.includes("saveFeatureTogglesBtn"), true);
assert.equal(consoleHtml.includes("settings-output"), true);
assert.equal(consoleHtml.includes("settings-features"), true);
assert.equal(consoleJs.includes("renderFeatureToggles"), true);
assert.equal(consoleJs.includes("renderOutputDir"), true);
assert.equal(consoleJs.includes("FEATURE_DEFINITIONS"), true);
assert.equal(consoleJs.includes("data-feature-id"), true);

const overlayHtml = await read("src/desktop/renderer/overlay.html");
assert.equal(overlayHtml.includes("commandInput"), true);
assert.equal(overlayHtml.includes("sendBtn"), true);

const dockHtml = await read("src/desktop/renderer/dock.html");
assert.equal(dockHtml.includes("dockButton"), true);

// UCA-182 Phase 8: notification.html retired. In-app toasts now render
// inside the popup-card window (popup-card.html); assert that file
// is still present instead.
const popupCardHtml = await read("src/desktop/renderer/popup-card.html");
assert.equal(popupCardHtml.includes("pc-card"), true);

const mainProcess = await read("src/desktop/tray/electron-main.mjs");
assert.equal(mainProcess.includes("preload: PRELOAD_PATH"), true);
assert.equal(mainProcess.includes("buildWindowUrl"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.shellSubmitDroppedFiles"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpInstallPreview"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpInstallRun"), true);
assert.equal(mainProcess.includes("X-Lingxy-Desktop-Actor"), true);
assert.equal(mainProcess.includes("/config/mcp/install/preview"), true);
assert.equal(mainProcess.includes("/config/mcp/install/run"), true);
assert.equal(mainProcess.includes("showDesktopNotification"), true);
// Permission handler for the Web Speech API mic access
assert.equal(mainProcess.includes("setPermissionRequestHandler"), true);
assert.equal(mainProcess.includes("setPermissionCheckHandler"), true);

console.log("Desktop renderer verification passed.");
