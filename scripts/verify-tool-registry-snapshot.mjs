import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/tool-registry-inventory.md");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const expectedIds = [
  "open_url",
  "web_search",
  "compose_email",
  "send_email_smtp",
  "open_file",
  "reveal_in_explorer",
  "launch_app",
  "copy_to_clipboard",
  "notify",
  "file_op",
  "take_screenshot",
  "read_clipboard",
  "create_scheduled_task",
  "list_scheduled_tasks",
  "delete_scheduled_task",
  "pause_scheduled_task",
  "translate_text",
  "web_search_fetch",
  "fetch_url_content",
  "write_file",
  "edit_file",
  "run_script",
  "generate_document",
  "render_diagram",
  "render_svg",
  "list_files",
  "glob_files",
  "find_recent_files",
  "get_latest_artifact",
  "stat_file",
  "read_file_text",
  "read_folder_text",
  "search_file_content",
  "index_file_content",
  "verify_file_exists",
  "register_artifact",
  "resolve_output_path",
  "gui_find_element",
  "gui_click",
  "gui_type_text",
  "vision_analyze",
  "recall_memory",
  "list_recent_tasks",
  "get_task_detail",
  "list_conversation_artifacts",
  "draft_capability",
  "save_capability_draft",
  "preview_skill_from_github",
  "install_skill_from_github",
  "connector_catalog_search",
  "connector_catalog_get",
  "connector_workflow_run",
  "connector_plugin_manage",
  "account_list_connected_accounts",
  "account_list_emails",
  "account_list_events",
  "account_list_files",
  "account_download_file",
  "account_send_email",
  "account_upload_file",
  "account_create_event"
];

const expectedConfirmationIds = [
  "account_send_email",
  "create_scheduled_task",
  "delete_scheduled_task",
  "gui_click",
  "gui_type_text",
  "index_file_content",
  "install_skill_from_github",
  "save_capability_draft",
  "send_email_smtp"
];

function fail(message) {
  console.error(`[tool-registry] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const ids = BUILTIN_ACTION_TOOLS.map((tool) => tool.id);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicateIds.length === 0, `duplicate tool ids: ${duplicateIds.join(", ")}`);
assert(JSON.stringify(ids) === JSON.stringify(expectedIds), "built-in tool id snapshot changed; update inventory intentionally.");

const confirmationIds = BUILTIN_ACTION_TOOLS
  .filter((tool) => tool.requires_confirmation)
  .map((tool) => tool.id)
  .sort();
assert(
  JSON.stringify(confirmationIds) === JSON.stringify(expectedConfirmationIds),
  "confirmation-gated tool id snapshot changed; update inventory intentionally."
);

assert(BUILTIN_ACTION_TOOLS.length === 61, "BUILTIN_ACTION_TOOLS count must remain 61");
assert(Object.isFrozen(BUILTIN_ACTION_TOOLS), "BUILTIN_ACTION_TOOLS must remain frozen");

const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
assert(doc.includes("Built-in tool count: 61"), "tool registry inventory missing tool count");
for (const id of expectedIds) assert(doc.includes(id), `tool registry inventory missing ${id}`);
for (const id of expectedConfirmationIds) assert(doc.includes(id), `tool registry inventory missing confirmation id ${id}`);

// Phase 2D.0: inventory doc must document current family ownership so future
// extractions have explicit source-of-truth for which tools belong to which family.
const familyHeaders = [
  "Browser / Web / Search / Translation",
  "OS / App / Clipboard / Notification",
  "Scheduler",
  "File Write / Script Execution",
  "Document / Artifact / Diagram / SVG Generation",
  "File Discovery / Read / Index",
  "GUI Automation",
  "Capability Creator",
  "Email"
];
for (const header of familyHeaders) {
  assert(doc.includes(header), `tool registry inventory missing family: ${header}`);
}
assert(doc.includes("External families"), "tool registry inventory must document external tool families");
assert(doc.includes("Phase 2D extraction order"), "tool registry inventory must document Phase 2D extraction order");

// Confirm BUILTIN_ACTION_TOOLS freezes the current tool id order.
// This verifier directly imports the live module, so any reorder
// or id rename will fail the expectedIds snapshot above.
const toolNameSet = new Set();
for (const tool of BUILTIN_ACTION_TOOLS) {
  assert(typeof tool.id === "string" && tool.id.length > 0, `tool missing id`);
  assert(typeof tool.name === "string", `tool ${tool.id} missing name`);
}
// Phase 2D source-ownership assertions (Codex 2D.2b/2D.3 review):
// extracted tool bodies must live only in their owner modules, and
// index.mjs must only import + aggregate, not redefine them.

const openHandlerSrc = read("src/service/capabilities/tools/open-with-default-handler.mjs");
assert(openHandlerSrc.includes("async function openWithDefaultHandler"),
  "only open-with-default-handler.mjs may define openWithDefaultHandler");

const browserWebSrc = read("src/service/capabilities/tools/browser-web-tools.mjs");
assert(browserWebSrc.includes("import { openWithDefaultHandler } from"),
  "browser-web-tools.mjs must import openWithDefaultHandler from the shared module");
assert(!browserWebSrc.includes("function openWithDefaultHandler"),
  "browser-web-tools.mjs must NOT define its own openWithDefaultHandler");
for (const tool of ["OPEN_URL_TOOL", "WEB_SEARCH_TOOL", "TRANSLATE_TEXT_TOOL", "WEB_SEARCH_FETCH_TOOL", "FETCH_URL_CONTENT_TOOL"]) {
  assert(browserWebSrc.includes(`export const ${tool}`),
    `browser-web-tools.mjs must own ${tool}`);
}

const osAppSrc = read("src/service/capabilities/tools/os-app-tools.mjs");
assert(osAppSrc.includes("import { openWithDefaultHandler } from"),
  "os-app-tools.mjs must import openWithDefaultHandler from the shared module");
assert(!osAppSrc.includes("function openWithDefaultHandler"),
  "os-app-tools.mjs must NOT define its own openWithDefaultHandler");
for (const tool of ["OPEN_FILE_TOOL", "REVEAL_IN_EXPLORER_TOOL", "FILE_OP_TOOL", "COPY_TO_CLIPBOARD_TOOL", "READ_CLIPBOARD_TOOL", "NOTIFY_TOOL"]) {
  assert(osAppSrc.includes(`export const ${tool}`),
    `os-app-tools.mjs must own ${tool}`);
}

// Phase 2D.5: email-tools ownership (domain-correct owner, not mixed into os-app-tools)
const emailSrc = read("src/service/capabilities/tools/email-tools.mjs");
assert(emailSrc.includes("import { openWithDefaultHandler } from"),
  "email-tools.mjs must import openWithDefaultHandler from the shared module");
for (const tool of ["COMPOSE_EMAIL_TOOL", "SEND_EMAIL_SMTP_TOOL"]) {
  assert(emailSrc.includes(`export const ${tool}`),
    `email-tools.mjs must own ${tool}`);
}

const schedulerSrc = read("src/service/capabilities/tools/scheduler-tools.mjs");
assert(schedulerSrc.includes("function getSchedulerRuntime"),
  "scheduler-tools.mjs must own getSchedulerRuntime");
for (const tool of ["CREATE_SCHEDULED_TASK_TOOL", "LIST_SCHEDULED_TASKS_TOOL", "DELETE_SCHEDULED_TASK_TOOL", "PAUSE_SCHEDULED_TASK_TOOL"]) {
  assert(schedulerSrc.includes(`export const ${tool}`),
    `scheduler-tools.mjs must own ${tool}`);
}

const indexSrc = read("src/service/action_tools/tools/index.mjs");
// index.mjs must import the extracted modules
assert(indexSrc.includes("from \"../../capabilities/tools/browser-web-tools.mjs\""),
  "index.mjs must import browser-web-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/os-app-tools.mjs\""),
  "index.mjs must import os-app-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/scheduler-tools.mjs\""),
  "index.mjs must import scheduler-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/email-tools.mjs\""),
  "index.mjs must import email-tools.mjs from capabilities/tools/");
// index.mjs must NOT redefine extracted tool bodies
for (const tool of ["COMPOSE_EMAIL_TOOL"]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine ${tool} (owned by email-tools.mjs)`);
}
for (const tool of ["OPEN_URL_TOOL", "WEB_SEARCH_TOOL", "TRANSLATE_TEXT_TOOL", "WEB_SEARCH_FETCH_TOOL", "FETCH_URL_CONTENT_TOOL"]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine ${tool} (owned by browser-web-tools.mjs)`);
}
for (const tool of ["OPEN_FILE_TOOL", "REVEAL_IN_EXPLORER_TOOL", "FILE_OP_TOOL", "COPY_TO_CLIPBOARD_TOOL", "READ_CLIPBOARD_TOOL", "NOTIFY_TOOL"]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine ${tool} (owned by os-app-tools.mjs)`);
}
for (const tool of ["CREATE_SCHEDULED_TASK_TOOL", "LIST_SCHEDULED_TASKS_TOOL", "DELETE_SCHEDULED_TASK_TOOL", "PAUSE_SCHEDULED_TASK_TOOL"]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine ${tool} (owned by scheduler-tools.mjs)`);
}
assert(!indexSrc.includes("function getSchedulerRuntime"),
  "index.mjs must NOT redefine getSchedulerRuntime (owned by scheduler-tools.mjs)");
assert(!indexSrc.includes("function openWithDefaultHandler"),
  "index.mjs must NOT redefine openWithDefaultHandler (owned by open-with-default-handler.mjs)");

// Phase 2D.4: file-read-tools ownership
const fileReadSrc = read("src/service/capabilities/tools/file-read-tools.mjs");
for (const tool of ["STAT_FILE_TOOL", "VERIFY_FILE_EXISTS_TOOL", "LIST_FILES_TOOL", "GLOB_FILES_TOOL", "FIND_RECENT_FILES_TOOL", "GET_LATEST_ARTIFACT_TOOL"]) {
  assert(fileReadSrc.includes(`export const ${tool}`),
    `file-read-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must NOT redefine ${tool} (owned by file-read-tools.mjs)`);
}
assert(indexSrc.includes("from \"../../capabilities/tools/file-read-tools.mjs\""),
  "index.mjs must import file-read-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/vision-analyze.mjs\""),
  "index.mjs must import vision-analyze.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/memory-tools.mjs\""),
  "index.mjs must import memory-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/skill-install-tools.mjs\""),
  "index.mjs must import skill-install-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/file-mutation-execution-tools.mjs\""),
  "index.mjs must import file-mutation-execution-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/document-render-tools.mjs\""),
  "index.mjs must import document-render-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/schemas/index.mjs\""),
  "index.mjs must import ACTION_TOOL_SCHEMAS from capabilities/schemas/");
assert(existsSync(path.join(root, "src/service/capabilities/schemas/index.mjs")),
  "CAP-2 schema owner must exist under capabilities/schemas/");
assert(!existsSync(path.join(root, "src/service/action_tools/schemas/index.mjs")),
  "CAP-2 schema owner must not remain under action_tools/schemas/");
assert(existsSync(path.join(root, "src/service/capabilities/registry/registry.mjs")),
  "CAP-3 registry owner must exist under capabilities/registry/");
assert(existsSync(path.join(root, "src/service/capabilities/registry/types.mjs")),
  "CAP-3 type owner must exist under capabilities/registry/");
assert(existsSync(path.join(root, "src/service/capabilities/registry/risk_matrix.mjs")),
  "CAP-3 risk owner must exist under capabilities/registry/");
assert(existsSync(path.join(root, "src/service/capabilities/registry/policy-guard.mjs")),
  "CAP-3 policy owner must exist under capabilities/registry/");
for (const oldPath of [
  "src/service/action_tools/registry.mjs",
  "src/service/action_tools/types.mjs",
  "src/service/action_tools/risk_matrix.mjs",
  "src/service/action_tools/policy-guard.mjs"
]) {
  assert(!existsSync(path.join(root, oldPath)),
    `CAP-3 moved file must not exist at old path: ${oldPath}`);
}

// CAP-1 closure: moved families must NOT exist at old action_tools/tools/ paths
const cap1MovedPaths = [
  "src/service/action_tools/tools/browser-web-tools.mjs",
  "src/service/action_tools/tools/os-app-tools.mjs",
  "src/service/action_tools/tools/scheduler-tools.mjs",
  "src/service/action_tools/tools/file-read-tools.mjs",
  "src/service/action_tools/tools/email-tools.mjs",
  "src/service/action_tools/tools/vision-analyze.mjs",
  "src/service/action_tools/tools/memory-tools.mjs",
  "src/service/action_tools/tools/skill-install-tools.mjs",
  "src/service/action_tools/tools/document-renderer.mjs",
  "src/service/action_tools/tools/svg-sanitize.mjs",
  "src/service/action_tools/tools/mermaid-assets.mjs",
  "src/service/action_tools/tools/file-manifest-helpers.mjs",
  "src/service/action_tools/tools/open-with-default-handler.mjs",
  "src/service/action_tools/tools/desktop-capture-gui-tools.mjs",
  "src/service/action_tools/tools/desktop-launch-tools.mjs",
  "src/service/action_tools/tools/file-content-tools.mjs",
  "src/service/action_tools/tools/file-mutation-execution-tools.mjs",
  "src/service/action_tools/tools/document-artifact-helpers.mjs",
  "src/service/action_tools/tools/document-render-tools.mjs",
];
for (const oldPath of cap1MovedPaths) {
  assert(!existsSync(path.join(root, oldPath)),
    `CAP-1 moved file must not exist at old path: ${oldPath}`);
}
// Remaining old-owner files are intentionally deferred:
//   index.mjs — live aggregator and remaining inline-tool owner

assert(indexSrc.includes("from \"../../capabilities/tools/desktop-capture-gui-tools.mjs\""),
  "index.mjs must import desktop-capture-gui-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/desktop-launch-tools.mjs\""),
  "index.mjs must import desktop-launch-tools.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/file-content-tools.mjs\""),
  "index.mjs must import file-content-tools.mjs from capabilities/tools/");
for (const tool of ["TAKE_SCREENSHOT_TOOL", "GUI_FIND_ELEMENT_TOOL", "GUI_CLICK_TOOL", "GUI_TYPE_TEXT_TOOL"]) {
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not redefine extracted ${tool}`);
}
const desktopLaunchSrc = read("src/service/capabilities/tools/desktop-launch-tools.mjs");
for (const tool of ["LAUNCH_APP_TOOL"]) {
  assert(desktopLaunchSrc.includes(`export const ${tool}`),
    `desktop-launch-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not redefine extracted ${tool}`);
}
for (const ownerText of [
  "const KNOWN_APPS",
  "function resolveAppCommand",
  "function hasKnownAppAlias",
  "function looksLikeExecutableTarget",
  "function stableLaunchCandidateId",
  "async function findPythonLauncherScript",
  "async function tryPythonLauncher",
  "async function resolveAppViaStartMenu"
]) {
  assert(desktopLaunchSrc.includes(ownerText), `desktop-launch-tools.mjs missing ${ownerText}`);
  assert(!indexSrc.includes(ownerText), `index.mjs must not retain desktop launch owner text: ${ownerText}`);
}

const fileContentSrc = read("src/service/capabilities/tools/file-content-tools.mjs");
for (const tool of [
  "READ_FILE_TEXT_TOOL",
  "READ_FOLDER_TEXT_TOOL",
  "SEARCH_FILE_CONTENT_TOOL",
  "INDEX_FILE_CONTENT_TOOL",
  "REGISTER_ARTIFACT_TOOL",
  "RESOLVE_OUTPUT_PATH_TOOL"
]) {
  assert(fileContentSrc.includes(`export const ${tool}`),
    `file-content-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not redefine extracted ${tool}`);
}
for (const ownerText of [
  "function clampNumber",
  "function emitFileReadEvent",
  "function emitToolFileReadTiming",
  "function fileReadResultFromTranscriptEntry"
]) {
  assert(fileContentSrc.includes(ownerText), `file-content-tools.mjs missing ${ownerText}`);
  assert(!indexSrc.includes(ownerText), `index.mjs must not retain file-content owner text: ${ownerText}`);
}

const fileMutationSrc = read("src/service/capabilities/tools/file-mutation-execution-tools.mjs");
for (const tool of ["WRITE_FILE_TOOL", "EDIT_FILE_TOOL", "RUN_SCRIPT_TOOL"]) {
  assert(fileMutationSrc.includes(`export const ${tool}`),
    `file-mutation-execution-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not redefine extracted ${tool}`);
}
for (const ownerText of [
  "async function resolveEditableTargetForEdit",
  "function decodeWriteFileContent",
  "const RUN_SCRIPT_LANGUAGES",
  "function clampTimeout",
  "async function spawnScript"
]) {
  assert(fileMutationSrc.includes(ownerText), `file-mutation-execution-tools.mjs missing ${ownerText}`);
  assert(!indexSrc.includes(ownerText), `index.mjs must not retain file-mutation owner text: ${ownerText}`);
}

const documentArtifactHelperSrc = read("src/service/capabilities/tools/document-artifact-helpers.mjs");
for (const ownerText of [
  "export const OUTLINE_KINDS",
  "export const KIND_EXTENSIONS",
  "export const KIND_MIMES",
  "export function artifactKindFromTarget",
  "export function normalizeDocumentOutline",
  "export async function writeDocumentPreviewSidecar",
  "export async function invokeDocumentRenderer",
  "await import(\"./document-renderer.mjs\")"
]) {
  assert(documentArtifactHelperSrc.includes(ownerText), `document-artifact-helpers.mjs missing ${ownerText}`);
}
for (const oldText of [
  "async function resolveDocumentRendererScript",
  "const OUTLINE_KINDS",
  "function artifactKindFromTarget",
  "function normalizeDocumentOutline",
  "async function writeDocumentPreviewSidecar",
  "async function invokeDocumentRenderer"
]) {
  assert(!indexSrc.includes(oldText), `index.mjs must not retain document-artifact helper text: ${oldText}`);
}

const documentRenderToolSrc = read("src/service/capabilities/tools/document-render-tools.mjs");
for (const tool of ["GENERATE_DOCUMENT_TOOL", "RENDER_DIAGRAM_TOOL", "RENDER_SVG_TOOL"]) {
  assert(documentRenderToolSrc.includes(`export const ${tool}`),
    `document-render-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not redefine extracted ${tool}`);
}
for (const ownerText of [
  "preview_html_path",
  "needs_pdf_conversion",
  "renderMermaidScriptTag()",
  "sanitizeSvgMarkup(args.svg"
]) {
  assert(documentRenderToolSrc.includes(ownerText), `document-render-tools.mjs missing ${ownerText}`);
}

assert(!indexSrc.includes("NOOP_TOOLS"), "index.mjs must not retain NOOP_TOOLS coupling");
assert(!indexSrc.includes("TOOL_DEFINITIONS"), "index.mjs must not retain stale TOOL_DEFINITIONS coupling");

if (!process.exitCode) {
  console.log("[tool-registry] built-in tool registry snapshot and source ownership verified.");
}
