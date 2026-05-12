#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS } from "./check-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const exists = (relativePath) => existsSync(path.join(repoRoot, relativePath));

const checklistPath = "docs/release/user_interaction_smoke_checklist.md";
assert.equal(exists(checklistPath), true, "missing user interaction smoke checklist");

const checklist = read(checklistPath);
const functionalMatrix = read("docs/release/functional_acceptance_matrix.md");
const releaseReadiness = read("scripts/verify-release-readiness.mjs");
const releaseConfig = read("tools/release/release-config.json");
const desktopGuiSmoke = read("src/desktop/smoke/desktop-gui-smoke-runner.mjs");
const electronGuiSmokeScript = read("scripts/run-electron-gui-smoke.mjs");
const pkg = JSON.parse(read("package.json"));

for (const section of [
  "Desktop Surfaces",
  "Voice and Audio",
  "Browser Extension",
  "Office, Files, And Automation",
  "Release Recording"
]) {
  assert.equal(checklist.includes(`## ${section}`), true,
    `user interaction checklist missing section: ${section}`);
}

for (const row of [
  "Dock",
  "Overlay chat",
  "Console chat",
  "Overlay voice input",
  "Note recording",
  "Echo mode",
  "Popup",
  "Floating chip",
  "Side panel",
  "Standalone mode",
  "Office add-ins",
  "Explorer entry",
  "Scheduler",
  "Side-effect approval"
]) {
  assert.equal(checklist.includes(`| ${row} |`), true,
    `user interaction checklist missing row: ${row}`);
}

for (const phrase of [
  "if a control is visible in a public build",
  "Standalone mode only promises browser-context LLM help",
  "files are not opened just because they were attached",
  "copy every partial/fail into `docs/release/known_issues.md`"
]) {
  assert.equal(checklist.toLowerCase().includes(phrase.toLowerCase()), true,
    `user interaction checklist missing discipline phrase: ${phrase}`);
}

assert.equal(functionalMatrix.includes("user_interaction_smoke_checklist.md"), true,
  "functional acceptance matrix must reference the user interaction checklist");
assert.equal(releaseReadiness.includes(checklistPath), true,
  "release readiness verifier must require the user interaction checklist");
assert.equal(releaseConfig.includes(checklistPath), true,
  "trial bundle must include the user interaction checklist");

assert.equal(typeof pkg.scripts["verify:user-interaction-smoke"], "string",
  "package.json missing verify:user-interaction-smoke script");
assert.equal(pkg.scripts["verify:desktop-gui-smoke"], "node scripts/run-electron-gui-smoke.mjs",
  "package.json must expose the real Electron GUI smoke for local desktop sessions");
for (const checkName of [
  "overlay_visible",
  "global_shortcut_handlers_installed",
  "global_shortcuts_registration_observed",
  "global_shortcut_toggle_overlay",
  "global_shortcut_open_console",
  "explorer_handoff_file_context",
  "explorer_handoff_file_openable",
  "overlay_voice_mediarecorder_path",
  "overlay_note_mic_mediarecorder_path",
  "task_cancel_ipc_bridge",
  "overlay_stop_button_cancel",
  "overlay_inline_error_retry",
  "overlay_llm_usage_timeline",
  "overlay_stream_delta_load",
  "overlay_task_list_keyboard_nav",
  "console_stream_delta_load",
  "console_settings_keyboard_nav",
  "console_schedule_form_keyboard_labels",
  "console_stop_button_cancel",
  "console_task_detail_cancel",
  "console_inline_error_retry",
  "console_chat_branch_fork",
  "console_chat_branch_rewind",
  "console_chat_branch_edit",
  "preview_tool_input_delta_load",
  "preview_generate_document_initial_draft",
  "preview_task_binding_isolation",
  "link_browser_close_control_injected",
  "popup_scheduled_artifact_card_visible",
  "popup_scheduled_artifact_card_controls",
  "popup_scheduled_artifact_card_close",
  "popup_scheduled_plain_card_visible",
  "popup_scheduled_plain_card_controls",
  "popup_scheduled_plain_card_close",
  "popup_scheduled_failure_card_visible",
  "popup_scheduled_failure_card_controls",
  "popup_scheduled_failure_card_close",
  "popup_updater_available_card_visible",
  "popup_updater_available_card_controls",
  "popup_updater_available_card_close",
  "popup_approval_card_visible",
  "popup_approval_card_controls",
  "popup_approval_card_keyboard_reject_closes"
]) {
  assert.equal(desktopGuiSmoke.includes(checkName), true,
    `desktop GUI smoke must retain check: ${checkName}`);
}
const smokeScript = pkg.scripts["verify:user-interaction-smoke"].match(/node\s+(scripts\/[^ ]+\.mjs)/u)?.[1];
assert.ok(smokeScript, "verify:user-interaction-smoke must be a node verifier");
assert.equal(CHECK_COMMANDS.includes(`node ${smokeScript}`), true,
  "npm run check must include user interaction smoke verifier");
assert.match(electronGuiSmokeScript, /url\.pathname === "\/health"/,
  "desktop GUI smoke fake service must answer /health so Electron does not start embedded SQLite runtime");
assert.match(electronGuiSmokeScript, /service:\s*"electron-gui-smoke"/,
  "desktop GUI smoke /health response must identify the fake service");

const popupHtml = read("browser_ext/popup/index.html");
const popupJs = read("browser_ext/popup/index.js");
const sidepanelHtml = read("browser_ext/sidepanel/index.html");
const sidepanelJs = read("browser_ext/sidepanel/index.js");
const runModeViewJs = read("browser_ext/shared/run-mode-view.js");

assert.equal(popupHtml.includes('id="mode-detail"'), true,
  "browser popup must expose a run-mode detail line");
assert.equal(sidepanelHtml.includes('id="sp-mode-detail"'), true,
  "browser side panel must expose a run-mode detail line");
assert.equal(popupJs.includes("../shared/run-mode-view.js"), true,
  "browser popup must use the shared run-mode view");
assert.equal(sidepanelJs.includes("../shared/run-mode-view.js"), true,
  "browser side panel must use the shared run-mode view");
assert.equal(/独立模式[\s\S]*本地工具/.test(runModeViewJs), true,
  "browser extension UI must explain standalone mode limitations");

console.log("ok verify-user-interaction-smoke");
