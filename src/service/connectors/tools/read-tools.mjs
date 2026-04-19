import { createActionResult } from "../../action_tools/types.mjs";
import { listUserAccounts, updateAccountLastUsed } from "../core/account-registry.mjs";
import { resolveAccount } from "../core/account-router.mjs";
import { listGoogleEmails, listGoogleEvents, listGoogleFiles } from "../google/google-connector.mjs";
import { listMicrosoftEmails, listMicrosoftEvents, listMicrosoftFiles } from "../microsoft/microsoft-connector.mjs";

function toActionResult(toolId, connectorResult, noun) {
  if (connectorResult.status !== "success") {
    return createActionResult({
      success: false,
      observation: connectorResult.message ?? `${toolId} requires follow-up: ${connectorResult.status}`,
      metadata: {
        tool_id: toolId,
        connector_status: connectorResult.status,
        ...connectorResult
      }
    });
  }
  const values = connectorResult.data?.[noun] ?? [];
  return createActionResult({
    success: true,
    observation: `${toolId} returned ${values.length} ${noun}.`,
    metadata: {
      tool_id: toolId,
      connector_status: "success",
      provider: connectorResult.provider,
      accountId: connectorResult.accountId,
      ...connectorResult.data
    }
  });
}

async function dispatchRead(runtime, account, kind, input, options = {}) {
  if (account.provider === "google") {
    if (kind === "emails") return listGoogleEmails(runtime, account, input, options);
    if (kind === "files") return listGoogleFiles(runtime, account, input, options);
    if (kind === "events") return listGoogleEvents(runtime, account, input, options);
  }
  if (account.provider === "microsoft") {
    if (kind === "emails") return listMicrosoftEmails(runtime, account, input, options);
    if (kind === "files") return listMicrosoftFiles(runtime, account, input, options);
    if (kind === "events") return listMicrosoftEvents(runtime, account, input, options);
  }
  return {
    status: "error",
    errorCode: "UNSUPPORTED_PROVIDER",
    message: `Unsupported connector provider: ${account.provider}`
  };
}

function createReadTool({ id, name, description, schema, requiredCapability, kind }) {
  return {
    id,
    name,
    description,
    parameters: schema,
    risk_level: "low",
    required_capabilities: ["network"],
    requires_confirmation: false,
    async execute(args = {}, ctx = {}) {
      const runtime = ctx.runtime;
      if (!runtime) {
        return createActionResult({ success: false, observation: "connector runtime missing", metadata: { tool_id: id } });
      }
      const connectedAccounts = listUserAccounts(runtime, args.userId ?? "local");
      const resolved = resolveAccount({
        connectedAccounts,
        userUtterance: ctx.task?.user_command ?? ctx.userUtterance ?? ""
      }, args, requiredCapability);
      if (resolved.status) {
        return toActionResult(id, resolved, kind);
      }
      const result = await dispatchRead(runtime, resolved, kind, args, {
        fetchImpl: ctx.fetchImpl ?? fetch
      });
      if (result.status === "success") {
        updateAccountLastUsed(runtime, resolved.id);
      }
      return toActionResult(id, result, kind);
    }
  };
}

export const ACCOUNT_LIST_EMAILS_TOOL = createReadTool({
  id: "account_list_emails",
  name: "Account List Emails",
  description: "List recent emails from a connected Google or Microsoft account. Supports accountId/provider routing.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      query: { type: "string" },
      unreadOnly: { type: "boolean" },
      limit: { type: "number" }
    }
  },
  requiredCapability: "emailRead",
  kind: "emails"
});

export const ACCOUNT_LIST_FILES_TOOL = createReadTool({
  id: "account_list_files",
  name: "Account List Files",
  description: "List files from a connected Google Drive or OneDrive account. This is cloud account storage, not local files.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      query: { type: "string" },
      folderId: { type: "string" },
      limit: { type: "number" }
    }
  },
  requiredCapability: "fileRead",
  kind: "files"
});

export const ACCOUNT_LIST_EVENTS_TOOL = createReadTool({
  id: "account_list_events",
  name: "Account List Events",
  description: "List calendar events from a connected Google Calendar or Microsoft Calendar account.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      startTime: { type: "string" },
      endTime: { type: "string" },
      query: { type: "string" },
      limit: { type: "number" }
    }
  },
  requiredCapability: "calendarRead",
  kind: "events"
});

