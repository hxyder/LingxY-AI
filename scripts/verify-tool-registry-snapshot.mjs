import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const root = process.cwd();
const docPath = path.join(root, "docs/architecture/tool-registry-inventory.md");

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
// No duplicate tool constant names would be detectable at import time
// (duplicate exports are parse errors in ESM). This is a structural
// invariant of the module system, not an extra assertion.

if (!process.exitCode) {
  console.log("[tool-registry] built-in tool registry snapshot verified.");
}
