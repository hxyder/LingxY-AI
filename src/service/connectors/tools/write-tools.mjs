import { createActionResult } from "../../action_tools/types.mjs";
import { listUserAccounts, updateAccountLastUsed } from "../core/account-registry.mjs";
import { resolveAccount } from "../core/account-router.mjs";
import { createGoogleEvent, sendGoogleEmail, uploadGoogleFile } from "../google/google-connector.mjs";
import { createMicrosoftEvent, sendMicrosoftEmail, uploadMicrosoftFile } from "../microsoft/microsoft-connector.mjs";

// Extract every plausible email address from a string. Handles
// separators the LLM commonly produces but the old `[,;\s]+` splitter
// missed: Chinese conjunctions (和 / 与 / 及 / 以及 / 、), ASCII "and"
// between two addresses, and combinations. Falls back to the raw
// string when no @ pattern is present so the validator downstream
// reports a clear "invalid recipient" instead of silently keeping
// the wrong text. (UCA-181 follow-up: a scheduled task with
// "...到 a@b.com和c@d.com" was sending to a malformed single
// recipient because `和` was not a separator.)
// Conservative local-part charset; the permissive RFC-5322 form
// (allowing `/`, `!`, `#`, etc.) accidentally swallowed separator
// characters when the LLM emitted shapes like "a@x.com/b@y.com".
const EMAIL_LIKE_REGEX = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function extractEmailAddresses(text) {
  const matches = String(text).match(EMAIL_LIKE_REGEX) ?? [];
  return [...new Set(matches.map((s) => s.trim()).filter(Boolean))];
}

function splitEmailString(value) {
  const text = String(value);
  const emails = extractEmailAddresses(text);
  if (emails.length > 0) return emails;
  // No @-bearing tokens — fall back to the legacy whitespace/punct
  // split so the validator reports a typed "invalid email" error
  // rather than treating the whole prose as one recipient.
  return text.split(/[,;\s]+/).map((part) => part.trim()).filter(Boolean);
}

function asEmailArray(value) {
  if (value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    // The LLM sometimes passes an array with ONE element that itself
    // contains multiple addresses joined by 和 / and / etc. Re-split
    // every entry through the same extractor so a single-element
    // array of "a@b.com和c@d.com" still resolves to two recipients.
    const out = [];
    for (const item of value) {
      const trimmed = String(item ?? "").trim();
      if (!trimmed) continue;
      const split = splitEmailString(trimmed);
      out.push(...(split.length > 0 ? split : [trimmed]));
    }
    return [...new Set(out)];
  }
  if (typeof value === "string") return splitEmailString(value);
  return [String(value)];
}

function normalizeEmailArgs(args = {}) {
  const normalized = { ...args };
  if (normalized.to !== undefined) normalized.to = asEmailArray(normalized.to);
  if (normalized.cc !== undefined) normalized.cc = asEmailArray(normalized.cc);
  if (normalized.bcc !== undefined) normalized.bcc = asEmailArray(normalized.bcc);
  if (normalized.attendees !== undefined) normalized.attendees = asEmailArray(normalized.attendees);
  return normalized;
}

function toActionResult(toolId, connectorResult, dataKey = null) {
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
  const summary = dataKey && connectorResult.data?.[dataKey]?.id
    ? `${toolId} completed (${dataKey}=${connectorResult.data[dataKey].id}).`
    : `${toolId} completed.`;
  return createActionResult({
    success: true,
    observation: summary,
    metadata: {
      tool_id: toolId,
      connector_status: "success",
      provider: connectorResult.provider,
      accountId: connectorResult.accountId,
      ...connectorResult.data
    }
  });
}

async function dispatchWrite(runtime, account, kind, input, options = {}) {
  if (account.provider === "google") {
    if (kind === "send_email") return sendGoogleEmail(runtime, account, input, options);
    if (kind === "upload_file") return uploadGoogleFile(runtime, account, input, options);
    if (kind === "create_event") return createGoogleEvent(runtime, account, input, options);
  }
  if (account.provider === "microsoft") {
    if (kind === "send_email") return sendMicrosoftEmail(runtime, account, input, options);
    if (kind === "upload_file") return uploadMicrosoftFile(runtime, account, input, options);
    if (kind === "create_event") return createMicrosoftEvent(runtime, account, input, options);
  }
  return {
    status: "error",
    errorCode: "UNSUPPORTED_PROVIDER",
    message: `Unsupported connector provider: ${account.provider}`
  };
}

function createWriteTool({ id, name, description, schema, requiredCapability, kind, riskLevel, requiresConfirmation, dataKey }) {
  return {
    id,
    name,
    description,
    parameters: schema,
    risk_level: riskLevel,
    required_capabilities: ["network"],
    requires_confirmation: requiresConfirmation,
    async execute(args = {}, ctx = {}) {
      const runtime = ctx.runtime;
      if (!runtime) {
        return createActionResult({ success: false, observation: "connector runtime missing", metadata: { tool_id: id } });
      }
      const normalized = normalizeEmailArgs(args);
      const connectedAccounts = listUserAccounts(runtime, normalized.userId ?? "local");
      const resolved = resolveAccount({
        connectedAccounts,
        userUtterance: ctx.task?.user_command ?? ctx.userUtterance ?? ""
      }, normalized, requiredCapability);
      if (resolved.status) {
        return toActionResult(id, resolved, dataKey);
      }
      const result = await dispatchWrite(runtime, resolved, kind, normalized, {
        fetchImpl: ctx.fetchImpl ?? fetch
      });
      if (result.status === "success") {
        updateAccountLastUsed(runtime, resolved.id);
      }
      return toActionResult(id, result, dataKey);
    }
  };
}

export const ACCOUNT_SEND_EMAIL_TOOL = createWriteTool({
  id: "account_send_email",
  name: "Account Send Email",
  description: "Send an email through a connected Gmail or Microsoft Outlook account. This always requires confirmation before execution.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      to: {},
      cc: {},
      bcc: {},
      subject: { type: "string" },
      body: { type: "string" },
      attachmentPaths: {
        type: "array",
        items: { type: "string" },
        description: "Optional absolute local file paths to attach to the email."
      }
    }
  },
  requiredCapability: "emailWrite",
  kind: "send_email",
  riskLevel: "high",
  requiresConfirmation: true
});

export const ACCOUNT_UPLOAD_FILE_TOOL = createWriteTool({
  id: "account_upload_file",
  name: "Account Upload File",
  description: "Upload a local file to a connected Google Drive or OneDrive account.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      localPath: { type: "string" },
      folderId: { type: "string" },
      newFileName: { type: "string" }
    }
  },
  requiredCapability: "fileWrite",
  kind: "upload_file",
  riskLevel: "medium",
  requiresConfirmation: false,
  dataKey: "file"
});

export const ACCOUNT_CREATE_EVENT_TOOL = createWriteTool({
  id: "account_create_event",
  name: "Account Create Event",
  description: "Create a calendar event in a connected Google Calendar or Microsoft Calendar account.",
  schema: {
    type: "object",
    required: [],
    properties: {
      accountId: { type: "string" },
      provider: { type: "string", enum: ["google", "microsoft"] },
      title: { type: "string" },
      startTime: { type: "string" },
      endTime: { type: "string" },
      attendees: {},
      description: { type: "string" },
      location: { type: "string" },
      timeZone: { type: "string" }
    }
  },
  requiredCapability: "calendarWrite",
  kind: "create_event",
  riskLevel: "medium",
  requiresConfirmation: false,
  dataKey: "event"
});

