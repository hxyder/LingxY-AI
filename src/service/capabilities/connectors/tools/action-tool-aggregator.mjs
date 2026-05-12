import {
  ACCOUNT_DOWNLOAD_FILE_TOOL,
  ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL,
  ACCOUNT_LIST_EMAILS_TOOL,
  ACCOUNT_LIST_EVENTS_TOOL,
  ACCOUNT_LIST_FILES_TOOL
} from "./read-tools.mjs";
import {
  ACCOUNT_CREATE_EVENT_TOOL,
  ACCOUNT_SEND_EMAIL_TOOL,
  ACCOUNT_UPLOAD_FILE_TOOL
} from "./write-tools.mjs";
import {
  CONNECTOR_CATALOG_GET_TOOL,
  CONNECTOR_CATALOG_SEARCH_TOOL,
  CONNECTOR_WORKFLOW_RUN_TOOL
} from "./catalog-tools.mjs";
import { CONNECTOR_PLUGIN_MANAGE_TOOL } from "./plugin-tools.mjs";

/**
 * Single aggregation point for every connector-related action tool. Any new
 * connector tool must be added here (not inline in action_tools/tools/index.mjs)
 * so the framework stays provider-neutral and discovery stays in one place.
 */
export const CONNECTOR_ACTION_TOOLS = Object.freeze([
  CONNECTOR_CATALOG_SEARCH_TOOL,
  CONNECTOR_CATALOG_GET_TOOL,
  CONNECTOR_WORKFLOW_RUN_TOOL,
  CONNECTOR_PLUGIN_MANAGE_TOOL,
  ACCOUNT_LIST_CONNECTED_ACCOUNTS_TOOL,
  ACCOUNT_LIST_EMAILS_TOOL,
  ACCOUNT_LIST_EVENTS_TOOL,
  ACCOUNT_LIST_FILES_TOOL,
  ACCOUNT_DOWNLOAD_FILE_TOOL,
  ACCOUNT_SEND_EMAIL_TOOL,
  ACCOUNT_UPLOAD_FILE_TOOL,
  ACCOUNT_CREATE_EVENT_TOOL
]);
