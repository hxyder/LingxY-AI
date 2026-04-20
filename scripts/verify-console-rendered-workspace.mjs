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
assert.equal(consoleHtml.includes("Tasks"), true);
assert.equal(consoleHtml.includes("Pending Approvals"), true);
assert.equal(consoleHtml.includes("Scheduled Tasks"), true);
assert.equal(consoleHtml.includes("Templates"), true);
assert.equal(consoleHtml.includes("Import JSON"), true);
assert.equal(consoleHtml.includes("DAG Workflow"), true);
assert.equal(consoleHtml.includes("Budget"), true);
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

const consoleJs = await read("src/desktop/renderer/console.js");
assert.equal(consoleJs.includes('fetchJson("/approvals")'), true);
assert.equal(consoleJs.includes('fetchJson("/schedules")'), true);
assert.equal(consoleJs.includes('fetchJson("/templates")'), true);
assert.equal(consoleJs.includes('fetchJson("/templates/import"'), true);
assert.equal(consoleJs.includes('fetchJson("/budget")'), true);
assert.equal(consoleJs.includes('fetchJson("/dag/executions")'), true);
assert.equal(consoleJs.includes('fetchJson("/dag/preview"'), true);
// UCA-121: /history/search call retired along with the Memory tab.
assert.equal(consoleJs.includes('fetchJson("/security/state")'), true);
assert.equal(consoleJs.includes('fetchJson("/audit-log")'), true);
assert.equal(consoleJs.includes('fetchJson("/config/email/settings")'), true);
assert.equal(consoleJs.includes("renderTaskArtifacts"), true);
assert.equal(consoleJs.includes("openTaskArtifactButton"), true);
assert.equal(consoleJs.includes("useTaskArtifactContextButton"), true);
assert.equal(consoleJs.includes('window.ucaShell.showWindow("overlay")'), true);
assert.equal(consoleJs.includes("ensureSelectedTaskEventStream"), true);
assert.equal(consoleJs.includes("handleSelectedTaskEventFrame"), true);
assert.equal(consoleJs.includes("formatTaskEventSummary"), true);
assert.equal(consoleJs.includes("configureOfficeAddins"), true);
assert.equal(consoleJs.includes("/setup/office-addins"), true);
assert.equal(consoleJs.includes("providerModelPresets"), true);
assert.equal(consoleJs.includes("modeOptionsForModel"), true);
assert.equal(consoleJs.includes("deepseek-reasoner"), true);
assert.equal(consoleJs.includes("data-routing-mode"), true);
// UCA-049 commit 3: task detail panel surfaces the resolved provider line
// + downgraded warning, derived from per-event provider_* fields.
assert.equal(consoleJs.includes("extractTaskProviderInfo"), true);
assert.equal(consoleJs.includes("renderProviderLine"), true);
assert.equal(consoleJs.includes("renderDowngradedWarning"), true);
assert.equal(consoleJs.includes("data-uca-downgraded"), true);
// UCA-046: Console schedules tab calendar sub-view + category color rendering
assert.equal(consoleJs.includes("scheduleViewMode"), true);
assert.equal(consoleJs.includes("renderScheduleCalendarGrid"), true);
assert.equal(consoleJs.includes("data-schedule-view"), true);
assert.equal(consoleHtml.includes("scheduleCalendar"), true);
assert.equal(consoleHtml.includes("data-schedule-view=\"week\""), true);
assert.equal(consoleHtml.includes("data-schedule-view=\"month\""), true);

console.log("Rendered console workspace verification passed.");
