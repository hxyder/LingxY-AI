import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

const consoleHtml = await read("src/desktop/renderer/console.html");
assert.equal(consoleHtml.includes('id="panel-tasks"'), true);
assert.equal(consoleHtml.includes('id="panel-schedules"'), true);
assert.equal(consoleHtml.includes('data-tab="files"'), false);
assert.equal(consoleHtml.includes('id="consoleChatFilesBtn"'), true);
assert.equal(consoleHtml.includes('id="panel-settings"'), true);
assert.equal(consoleHtml.includes("Tasks"), true);
assert.equal(consoleHtml.includes("Schedules"), true);
assert.equal(consoleHtml.includes("Pending Approvals"), true);
assert.equal(consoleHtml.includes('id="approvalList"'), true);
assert.equal(consoleHtml.includes('id="templateList"'), true);
assert.equal(consoleHtml.includes('id="templateImportInput"'), true);
assert.equal(consoleHtml.includes("Import JSON"), true);
assert.equal(consoleHtml.includes('id="monthlyBudgetInput"'), true);
assert.equal(consoleHtml.includes("Budget"), true);
assert.equal(consoleHtml.includes('id="auditList"'), true);
// UCA-121: "History" tab retired. "History" may still appear in
// cheatsheet label for task timeline; verify is intentionally removed.
assert.equal(consoleHtml.includes("Privacy & Security"), true);
assert.equal(consoleHtml.includes("Audit Log"), true);
assert.equal(consoleHtml.includes("Artifacts"), true);
assert.equal(consoleHtml.includes("Subtasks"), true);
assert.equal(consoleHtml.includes("Open"), true);
assert.equal(consoleHtml.includes("One-click Setup"), true);
assert.equal(consoleHtml.includes("Office Add-ins"), true);
assert.equal(consoleHtml.includes("Email Accounts"), true);
assert.equal(consoleHtml.includes("projectWorkspaceSummary"), true);
assert.equal(consoleHtml.includes("projectInstructionsInput"), true);
assert.equal(consoleHtml.includes("projectOpenChatBtn"), true);
assert.equal(consoleHtml.includes("projectStartChatBtn"), true);
assert.equal(consoleHtml.includes("projectQuickChatForm"), false);
assert.equal(consoleHtml.includes("project-clean-layout"), true);

const consoleJs = await read("src/desktop/renderer/console.js");
const runtimePreflightClient = await read("src/desktop/renderer/shared/runtime-preflight-client.mjs");
const taskTimelineJs = await read("src/desktop/renderer/console-task-timeline.mjs");
const taskEventControllerJs = await read("src/desktop/renderer/console-task-event-stream.mjs");
const projectColorsIndex = consoleJs.indexOf("const PROJECT_COLORS");
const workspaceSignaturesIndex = consoleJs.indexOf("const workspaceRenderSignatures");
const fileIndexPanelIndex = consoleJs.indexOf("createFileContentIndexPanel({");
const restoreViewIndex = consoleJs.indexOf("requestAnimationFrame(() => switchTab(savedView))");
assert.ok(projectColorsIndex >= 0, "console.js must declare PROJECT_COLORS");
assert.ok(workspaceSignaturesIndex >= 0, "console.js must declare workspaceRenderSignatures");
assert.ok(fileIndexPanelIndex >= 0, "console.js must instantiate createFileContentIndexPanel");
assert.ok(restoreViewIndex >= 0, "console.js must restore saved console view");
assert.ok(
  projectColorsIndex < fileIndexPanelIndex,
  "console.js startup constants must be declared before file index panel creation"
);
assert.ok(
  workspaceSignaturesIndex < restoreViewIndex,
  "console.js render signature cache must be declared before saved-view restore can switch tabs"
);
function assertConsoleFetches(endpoint) {
  assert.ok(
    consoleJs.includes(`fetchJson("${endpoint}"`) || consoleJs.includes(`fetchJsonWithFallback("${endpoint}"`),
    `console.js must fetch ${endpoint}`
  );
}

assertConsoleFetches("/approvals");
assertConsoleFetches("/schedules");
assertConsoleFetches("/templates");
assert.equal(consoleJs.includes("importTemplateViaShell"), true);
assertConsoleFetches("/budget");
assertConsoleFetches("/dag/executions");
assert.equal(consoleJs.includes("consolePreflightClient.previewDag"), true);
assert.equal(runtimePreflightClient.includes('"/dag/preview"'), true);
// UCA-121: /history/search call retired along with the Memory tab.
assertConsoleFetches("/security/state");
assertConsoleFetches("/audit-log");
assertConsoleFetches("/config/email/settings");
assert.equal(consoleJs.includes("renderTaskArtifacts"), true);
assert.equal(consoleJs.includes("refreshProjectWorkspace"), true);
assert.equal(consoleJs.includes("saveProjectMetadataViaService"), true);
assert.equal(consoleJs.includes("setSelectedProjectChatScope"), true);
assert.equal(consoleJs.includes("openSelectedProjectChat"), true);
assert.equal(consoleJs.includes("openTaskArtifactButton"), true);
assert.equal(consoleJs.includes("useTaskArtifactContextButton"), true);
assert.equal(consoleJs.includes('consoleShellClient.showWindow("overlay")'), true);
assert.equal(consoleJs.includes("selectedTaskEventController.ensure"), true);
assert.equal(consoleJs.includes('from "./console-task-event-stream.mjs"'), true);
assert.equal(taskEventControllerJs.includes("handleSelectedTaskEventFrame"), true);
assert.equal(taskEventControllerJs.includes("subscribeTaskEvents"), true);
assert.equal(consoleJs.includes("formatTaskEventSummary"), true);
assert.equal(consoleJs.includes("configureOfficeAddins"), true);
assert.equal(consoleJs.includes("/setup/office-addins"), true);
assert.equal(consoleJs.includes("providerModelPresets"), true);
assert.equal(consoleJs.includes("modeOptionsForModel"), true);
assert.equal(consoleJs.includes("reasoningEffortOptions"), true);
assert.equal(consoleJs.includes("data-routing-reasoning"), true);
assert.equal(consoleJs.includes("data-routing-mode"), true);
// UCA-049 commit 3: task detail panel surfaces the resolved provider line
// + downgraded warning, derived from per-event provider_* fields.
assert.equal(consoleJs.includes("extractTaskProviderInfo"), true);
assert.equal(consoleJs.includes("renderDowngradedWarning"), true);
assert.equal(consoleJs.includes('from "./console-task-timeline.mjs"'), true);
assert.equal(taskTimelineJs.includes("renderProviderLine"), true);
assert.equal(taskTimelineJs.includes("data-uca-downgraded"), true);
// UCA-046: Console schedules tab calendar sub-view + category color rendering
assert.equal(consoleJs.includes("scheduleViewMode"), true);
assert.equal(consoleJs.includes("renderScheduleCalendarGrid"), true);
assert.equal(consoleJs.includes("data-schedule-view"), true);
assert.equal(consoleHtml.includes("scheduleCalendar"), true);
assert.equal(consoleHtml.includes("data-schedule-view=\"week\""), true);
assert.equal(consoleHtml.includes("data-schedule-view=\"month\""), true);

console.log("Rendered console workspace verification passed.");
