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
for (const tool of ["OPEN_FILE_TOOL", "REVEAL_IN_EXPLORER_TOOL", "FILE_OP_TOOL", "COPY_TO_CLIPBOARD_TOOL", "NOTIFY_TOOL"]) {
  assert(osAppSrc.includes(`export const ${tool}`),
    `os-app-tools.mjs must own ${tool}`);
}

// Phase 2D.5: email-tools ownership (domain-correct owner, not mixed into os-app-tools)
const emailSrc = read("src/service/capabilities/tools/email-tools.mjs");
assert(emailSrc.includes("import { openWithDefaultHandler } from"),
  "email-tools.mjs must import openWithDefaultHandler from the shared module");
for (const tool of ["COMPOSE_EMAIL_TOOL"]) {
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
for (const tool of ["OPEN_FILE_TOOL", "REVEAL_IN_EXPLORER_TOOL", "FILE_OP_TOOL", "COPY_TO_CLIPBOARD_TOOL", "NOTIFY_TOOL"]) {
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
assert(indexSrc.includes("await import(\"../../capabilities/tools/document-renderer.mjs\")"),
  "index.mjs must dynamically import document-renderer.mjs from capabilities/tools/");
assert(indexSrc.includes("from \"../../capabilities/tools/svg-sanitize.mjs\""),
  "index.mjs must import svg-sanitize.mjs from capabilities/tools/");

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
  "src/service/action_tools/tools/file-manifest-helpers.mjs",
  "src/service/action_tools/tools/open-with-default-handler.mjs",
];
for (const oldPath of cap1MovedPaths) {
  assert(!existsSync(path.join(root, oldPath)),
    `CAP-1 moved file must not exist at old path: ${oldPath}`);
}
// Remaining old-owner files are intentionally deferred:
//   index.mjs — live aggregator and remaining inline-tool owner
//   mermaid-assets.mjs — diagram rendering (later phase)

// Deferred tools still in index.mjs must still be present
for (const tool of ["LAUNCH_APP_TOOL", "TAKE_SCREENSHOT_TOOL"]) {
  assert(indexSrc.includes(`export const ${tool}`),
    `index.mjs must still own deferred ${tool}`);
}
assert(indexSrc.includes("READ_CLIPBOARD_TOOL"),
  "index.mjs must still own deferred READ_CLIPBOARD_TOOL (NOOP_TOOLS reference)");

if (!process.exitCode) {
  console.log("[tool-registry] built-in tool registry snapshot and source ownership verified.");
}
