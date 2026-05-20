import { CONNECTOR_ACTION_TOOLS } from "../../capabilities/connectors/tools/action-tool-aggregator.mjs";
import { MEMORY_TOOLS } from "../../capabilities/tools/memory-tools.mjs";
import { TRANSLATE_TEXT_TOOL, WEB_SEARCH_FETCH_TOOL, FETCH_URL_CONTENT_TOOL, DOWNLOAD_FILE_TOOL, OPEN_URL_TOOL, WEB_SEARCH_TOOL } from "../../capabilities/tools/browser-web-tools.mjs";
import { OPEN_FILE_TOOL, REVEAL_IN_EXPLORER_TOOL, FILE_OP_TOOL, COPY_TO_CLIPBOARD_TOOL, READ_CLIPBOARD_TOOL, NOTIFY_TOOL } from "../../capabilities/tools/os-app-tools.mjs";
import { COMPOSE_EMAIL_TOOL, SEND_EMAIL_SMTP_TOOL } from "../../capabilities/tools/email-tools.mjs";
import { CREATE_SCHEDULED_TASK_TOOL, LIST_SCHEDULED_TASKS_TOOL, DELETE_SCHEDULED_TASK_TOOL, PAUSE_SCHEDULED_TASK_TOOL } from "../../capabilities/tools/scheduler-tools.mjs";
import { STAT_FILE_TOOL, VERIFY_FILE_EXISTS_TOOL, LIST_FILES_TOOL, GLOB_FILES_TOOL, FIND_RECENT_FILES_TOOL, GET_LATEST_ARTIFACT_TOOL } from "../../capabilities/tools/file-read-tools.mjs";
import { VISION_ANALYZE_TOOL } from "../../capabilities/tools/vision-analyze.mjs";
import { TAKE_SCREENSHOT_TOOL, GUI_FIND_ELEMENT_TOOL, GUI_CLICK_TOOL, GUI_TYPE_TEXT_TOOL } from "../../capabilities/tools/desktop-capture-gui-tools.mjs";
import { LAUNCH_APP_TOOL } from "../../capabilities/tools/desktop-launch-tools.mjs";
import { READ_FILE_TEXT_TOOL, READ_FOLDER_TEXT_TOOL, SEARCH_FILE_CONTENT_TOOL, INDEX_FILE_CONTENT_TOOL, REGISTER_ARTIFACT_TOOL, RESOLVE_OUTPUT_PATH_TOOL } from "../../capabilities/tools/file-content-tools.mjs";
import { WRITE_FILE_TOOL, EDIT_FILE_TOOL, RUN_SCRIPT_TOOL } from "../../capabilities/tools/file-mutation-execution-tools.mjs";
import { GENERATE_DOCUMENT_TOOL, RENDER_DIAGRAM_TOOL, RENDER_SVG_TOOL } from "../../capabilities/tools/document-render-tools.mjs";
import { DRAFT_CAPABILITY_TOOL, SAVE_CAPABILITY_DRAFT_TOOL } from "../../capabilities/tools/capability-creator-tools.mjs";
import {
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL
} from "../../capabilities/tools/skill-install-tools.mjs";

export {
  createLaunchAmbiguityResult,
  normalizeLaunchCandidates
} from "../../capabilities/tools/desktop-launch-tools.mjs";

export {
  EDIT_FILE_TOOL,
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  RENDER_SVG_TOOL,
  DRAFT_CAPABILITY_TOOL,
  SAVE_CAPABILITY_DRAFT_TOOL,
  RUN_SCRIPT_TOOL,
  WRITE_FILE_TOOL
};

export const BUILTIN_ACTION_TOOLS = Object.freeze([
  OPEN_URL_TOOL,
  WEB_SEARCH_TOOL,
  COMPOSE_EMAIL_TOOL,
  SEND_EMAIL_SMTP_TOOL,
  OPEN_FILE_TOOL,
  REVEAL_IN_EXPLORER_TOOL,
  LAUNCH_APP_TOOL,
  COPY_TO_CLIPBOARD_TOOL,
  NOTIFY_TOOL,
  FILE_OP_TOOL,
  TAKE_SCREENSHOT_TOOL,
  READ_CLIPBOARD_TOOL,
  CREATE_SCHEDULED_TASK_TOOL,
  LIST_SCHEDULED_TASKS_TOOL,
  DELETE_SCHEDULED_TASK_TOOL,
  PAUSE_SCHEDULED_TASK_TOOL,
  TRANSLATE_TEXT_TOOL,
  WEB_SEARCH_FETCH_TOOL,
  FETCH_URL_CONTENT_TOOL,
  DOWNLOAD_FILE_TOOL,
  WRITE_FILE_TOOL,
  EDIT_FILE_TOOL,
  RUN_SCRIPT_TOOL,
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  RENDER_SVG_TOOL,
  // UCA-053: File Discovery & Artifact Verification
  LIST_FILES_TOOL,
  GLOB_FILES_TOOL,
  FIND_RECENT_FILES_TOOL,
  GET_LATEST_ARTIFACT_TOOL,
  STAT_FILE_TOOL,
  READ_FILE_TEXT_TOOL,
  READ_FOLDER_TEXT_TOOL,
  SEARCH_FILE_CONTENT_TOOL,
  INDEX_FILE_CONTENT_TOOL,
  VERIFY_FILE_EXISTS_TOOL,
  REGISTER_ARTIFACT_TOOL,
  RESOLVE_OUTPUT_PATH_TOOL,
  // UCA-076: GUI Automation
  GUI_FIND_ELEMENT_TOOL,
  GUI_CLICK_TOOL,
  GUI_TYPE_TEXT_TOOL,
  // Tool-backed vision specialist. Lets tool_using handle "what's in
  // this image" without bouncing the task to the multi_modal executor.
  VISION_ANALYZE_TOOL,
  // UCA-182 Phase 21: memory introspection tools so the planner can
  // ask for prior-task context on its own, replacing the earlier
  // submit-time digest injection.
  ...MEMORY_TOOLS,
  // UCA-077: Capability creator (skill / MCP), draft-only and read-only.
  DRAFT_CAPABILITY_TOOL,
  // UCA-077: Save the capability draft. High-risk + confirmation-required;
  // never enables an MCP server or mutates runtime config.
  SAVE_CAPABILITY_DRAFT_TOOL,
  // C18 #2b: two-step LLM-callable skill install. Preview (low risk,
  // no confirmation) stages + returns SKILL.md preview + state token.
  // Install (high risk, requires_confirmation) consumes the token to
  // commit. Surface gating in tool-surface.mjs.shouldExposeSkillInstall
  // requires user_command to contain BOTH an install verb AND a
  // github.com URL in the same source.
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL,
  // Connector catalog + provider account tools (single aggregation point)
  ...CONNECTOR_ACTION_TOOLS
]);
