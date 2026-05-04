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
assert.equal(preload.includes("saveMcpServer"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpServerSave), true);
assert.equal(preload.includes("deleteMcpServer"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpServerDelete), true);
assert.equal(preload.includes("toggleMcpServer"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpServerToggle), true);
assert.equal(preload.includes("saveMcpServerConfig"), true);
assert.equal(preload.includes(IPC_CHANNELS.mcpServerConfig), true);
assert.equal(preload.includes("approveApproval"), true);
assert.equal(preload.includes(IPC_CHANNELS.approvalApprove), true);
assert.equal(preload.includes("rejectApproval"), true);
assert.equal(preload.includes(IPC_CHANNELS.approvalReject), true);
assert.equal(preload.includes("updateSecurityState"), true);
assert.equal(preload.includes(IPC_CHANNELS.securityStateUpdate), true);
assert.equal(preload.includes("updateBudget"), true);
assert.equal(preload.includes(IPC_CHANNELS.budgetUpdate), true);
assert.equal(preload.includes("createSchedule"), true);
assert.equal(preload.includes(IPC_CHANNELS.scheduleCreate), true);
assert.equal(preload.includes("updateSchedule"), true);
assert.equal(preload.includes(IPC_CHANNELS.scheduleUpdate), true);
assert.equal(preload.includes("deleteSchedule"), true);
assert.equal(preload.includes(IPC_CHANNELS.scheduleDelete), true);
assert.equal(preload.includes("runSchedule"), true);
assert.equal(preload.includes(IPC_CHANNELS.scheduleRun), true);
assert.equal(preload.includes("saveTemplate"), true);
assert.equal(preload.includes(IPC_CHANNELS.templateSave), true);
assert.equal(preload.includes("importTemplate"), true);
assert.equal(preload.includes(IPC_CHANNELS.templateImport), true);
assert.equal(preload.includes("deleteTemplate"), true);
assert.equal(preload.includes(IPC_CHANNELS.templateDelete), true);
assert.equal(preload.includes("resumeDagExecution"), true);
assert.equal(preload.includes(IPC_CHANNELS.dagResume), true);
assert.equal(preload.includes("saveProvider"), true);
assert.equal(preload.includes(IPC_CHANNELS.providerSave), true);
assert.equal(preload.includes("deleteProvider"), true);
assert.equal(preload.includes(IPC_CHANNELS.providerDelete), true);
assert.equal(preload.includes("saveCodeCliAdapter"), true);
assert.equal(preload.includes(IPC_CHANNELS.codeCliAdapterSave), true);
assert.equal(preload.includes("deleteCodeCliAdapter"), true);
assert.equal(preload.includes(IPC_CHANNELS.codeCliAdapterDelete), true);
assert.equal(preload.includes("saveSkillRegistry"), true);
assert.equal(preload.includes(IPC_CHANNELS.skillRegistrySave), true);
assert.equal(preload.includes("deleteSkillRegistry"), true);
assert.equal(preload.includes(IPC_CHANNELS.skillRegistryDelete), true);
assert.equal(preload.includes("saveAutoSkill"), true);
assert.equal(preload.includes(IPC_CHANNELS.autoSkillSave), true);
assert.equal(preload.includes("writeSkillMarkdown"), true);
assert.equal(preload.includes(IPC_CHANNELS.skillMarkdownWrite), true);
assert.equal(preload.includes("updateRoutingConfig"), true);
assert.equal(preload.includes(IPC_CHANNELS.routingConfigUpdate), true);
assert.equal(preload.includes("updateOutputConfig"), true);
assert.equal(preload.includes(IPC_CHANNELS.outputConfigUpdate), true);
assert.equal(preload.includes("updateFeatureConfig"), true);
assert.equal(preload.includes(IPC_CHANNELS.featureConfigUpdate), true);
assert.equal(preload.includes("updateEmailSettings"), true);
assert.equal(preload.includes(IPC_CHANNELS.emailSettingsUpdate), true);
assert.equal(preload.includes("saveEmailAccount"), true);
assert.equal(preload.includes(IPC_CHANNELS.emailAccountSave), true);
assert.equal(preload.includes("deleteEmailAccount"), true);
assert.equal(preload.includes(IPC_CHANNELS.emailAccountDelete), true);
assert.equal(preload.includes("checkEmailDigest"), true);
assert.equal(preload.includes(IPC_CHANNELS.emailDigestCheck), true);
assert.equal(preload.includes("saveNotes"), true);
assert.equal(preload.includes(IPC_CHANNELS.notesSave), true);
assert.equal(preload.includes("upsertNote"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteUpsert), true);
assert.equal(preload.includes("deleteNote"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteDelete), true);
assert.equal(preload.includes("restoreNote"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteRestore), true);
assert.equal(preload.includes("appendNoteChip"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteAppendChip), true);
assert.equal(preload.includes("saveProjectStore"), true);
assert.equal(preload.includes(IPC_CHANNELS.projectStoreSave), true);
assert.equal(preload.includes("clearPreviewCache"), true);
assert.equal(preload.includes(IPC_CHANNELS.previewCacheClear), true);
assert.equal(preload.includes("setupOfficeAddins"), true);
assert.equal(preload.includes(IPC_CHANNELS.officeAddinsSetup), true);
assert.equal(preload.includes("detectEchoKeyword"), true);
assert.equal(preload.includes(IPC_CHANNELS.echoKwsDetect), true);
assert.equal(preload.includes("enrollEchoKeyword"), true);
assert.equal(preload.includes(IPC_CHANNELS.echoKeywordEnroll), true);
assert.equal(preload.includes("transcribeNoteAudio"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteTranscribe), true);
assert.equal(preload.includes("transcribeNoteAudioStreaming"), true);
assert.equal(preload.includes(IPC_CHANNELS.noteTranscribeStream), true);
assert.equal(preload.includes(IPC_CHANNELS.noteTranscribeStreamEvent), true);
assert.equal(preload.includes("renameConnectedAccount"), true);
assert.equal(preload.includes(IPC_CHANNELS.connectedAccountRename), true);
assert.equal(preload.includes("setConnectedAccountDefault"), true);
assert.equal(preload.includes(IPC_CHANNELS.connectedAccountDefaultSet), true);
assert.equal(preload.includes("disconnectConnectedAccount"), true);
assert.equal(preload.includes(IPC_CHANNELS.connectedAccountDisconnect), true);
assert.equal(preload.includes("disconnectConnectorAccount"), true);
assert.equal(preload.includes(IPC_CHANNELS.connectorAccountDisconnect), true);
assert.equal(preload.includes("saveConnectorAccountConfig"), true);
assert.equal(preload.includes(IPC_CHANNELS.connectorAccountConfigSave), true);
assert.equal(preload.includes("cancelTask"), true);
assert.equal(preload.includes(IPC_CHANNELS.taskCancel), true);
assert.equal(preload.includes("retryTask"), true);
assert.equal(preload.includes(IPC_CHANNELS.taskRetry), true);
assert.equal(preload.includes("deleteTask"), true);
assert.equal(preload.includes(IPC_CHANNELS.taskDelete), true);
assert.equal(preload.includes("restoreTask"), true);
assert.equal(preload.includes(IPC_CHANNELS.taskRestore), true);

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
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpServerSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpServerDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpServerToggle"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.mcpServerConfig"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.approvalApprove"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.approvalReject"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.securityStateUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.budgetUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.scheduleCreate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.scheduleUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.scheduleDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.scheduleRun"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.templateSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.templateImport"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.templateDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.dagResume"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.providerSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.providerDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.codeCliAdapterSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.codeCliAdapterDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.skillRegistrySave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.skillRegistryDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.autoSkillSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.skillMarkdownWrite"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.routingConfigUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.outputConfigUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.featureConfigUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.emailSettingsUpdate"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.emailAccountSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.emailAccountDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.emailDigestCheck"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.notesSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteUpsert"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteRestore"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteAppendChip"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.projectStoreSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.previewCacheClear"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.officeAddinsSetup"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.echoKwsDetect"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.echoKeywordEnroll"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteTranscribe"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteTranscribeStream"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.noteTranscribeStreamEvent"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.connectedAccountRename"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.connectedAccountDefaultSet"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.connectedAccountDisconnect"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.connectorAccountDisconnect"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.connectorAccountConfigSave"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.taskCancel"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.taskRetry"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.taskDelete"), true);
assert.equal(mainProcess.includes("IPC_CHANNELS.taskRestore"), true);
assert.equal(mainProcess.includes("X-Lingxy-Desktop-Actor"), true);
assert.equal(mainProcess.includes("/config/mcp/install/preview"), true);
assert.equal(mainProcess.includes("/config/mcp/install/run"), true);
assert.equal(mainProcess.includes("/config/mcp/servers"), true);
assert.equal(mainProcess.includes("/toggle"), true);
assert.equal(mainProcess.includes("/config"), true);
assert.equal(mainProcess.includes("/approve"), true);
assert.equal(mainProcess.includes("/reject"), true);
assert.equal(mainProcess.includes("/security/state"), true);
assert.equal(mainProcess.includes("/budget"), true);
assert.equal(mainProcess.includes("/schedules"), true);
assert.equal(mainProcess.includes("/templates"), true);
assert.equal(mainProcess.includes("/dag/executions"), true);
assert.equal(mainProcess.includes("/config/providers"), true);
assert.equal(mainProcess.includes("/config/code-cli/adapters"), true);
assert.equal(mainProcess.includes("/config/skills/registries"), true);
assert.equal(mainProcess.includes("/skills/save"), true);
assert.equal(mainProcess.includes("/skills/write"), true);
assert.equal(mainProcess.includes("/config/routing"), true);
assert.equal(mainProcess.includes("/config/output"), true);
assert.equal(mainProcess.includes("/config/features"), true);
assert.equal(mainProcess.includes("/config/email/settings"), true);
assert.equal(mainProcess.includes("/config/email/accounts"), true);
assert.equal(mainProcess.includes("/email/digest/check"), true);
assert.equal(mainProcess.includes("/notes"), true);
assert.equal(mainProcess.includes("/notes/upsert"), true);
assert.equal(mainProcess.includes("/notes/delete"), true);
assert.equal(mainProcess.includes("/notes/restore"), true);
assert.equal(mainProcess.includes("/notes/append-chip"), true);
assert.equal(mainProcess.includes("/preview/cache/clear"), true);
assert.equal(mainProcess.includes("/setup/office-addins"), true);
assert.equal(mainProcess.includes("/echo/kws"), true);
assert.equal(mainProcess.includes("/echo/enroll-keyword"), true);
assert.equal(mainProcess.includes("/note/transcribe"), true);
assert.equal(mainProcess.includes("/connectors/connected-accounts/"), true);
assert.equal(mainProcess.includes("/connectors/accounts/"), true);
assert.equal(mainProcess.includes("/cancel"), true);
assert.equal(mainProcess.includes("/retry"), true);
assert.equal(mainProcess.includes("/restore"), true);
assert.equal(mainProcess.includes("showDesktopNotification"), true);
// Permission handler for the Web Speech API mic access
assert.equal(mainProcess.includes("setPermissionRequestHandler"), true);
assert.equal(mainProcess.includes("setPermissionCheckHandler"), true);

console.log("Desktop renderer verification passed.");
