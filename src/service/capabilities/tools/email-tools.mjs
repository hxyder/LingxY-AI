import { ACTION_TOOL_SCHEMAS } from "../schemas/index.mjs";
import { createActionResult } from "../registry/types.mjs";
import { openWithDefaultHandler } from "./open-with-default-handler.mjs";

function asList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

async function sendViaConfiguredSmtpTransport(transport, message) {
  if (typeof transport === "function") {
    return transport(message);
  }
  if (typeof transport?.sendMail === "function") {
    return transport.sendMail(message);
  }
  if (typeof transport?.send === "function") {
    return transport.send(message);
  }
  return null;
}

export const SEND_EMAIL_SMTP_TOOL = {
  id: "send_email_smtp",
  name: "Send Email SMTP",
  description: "Send an email directly over a configured SMTP transport. Fails closed when SMTP is not configured.",
  parameters: ACTION_TOOL_SCHEMAS.send_email_smtp,
  risk_level: "high",
  required_capabilities: ["network"],
  requires_confirmation: true,
  formatObservation(args) {
    return `Sent SMTP email to ${asList(args.to).join(", ")}`;
  },
  async execute(args = {}, ctx = {}) {
    const transport = ctx?.smtpTransport ?? ctx?.runtime?.smtpTransport ?? null;
    const to = asList(args.to);
    const cc = asList(args.cc);
    const bcc = asList(args.bcc);
    const subject = String(args.subject ?? "").trim();
    const body = String(args.body ?? "").trim();

    if (!transport) {
      return createActionResult({
        success: false,
        observation: "SMTP email sending is not configured. Connect a Gmail/Outlook account or configure a real SMTP transport before sending.",
        metadata: {
          tool_id: "send_email_smtp",
          connector_status: "unsupported",
          delivery_attempted: false,
          email_delivery_verified: false
        }
      });
    }

    if (to.length === 0 || !subject || !body) {
      return createActionResult({
        success: false,
        observation: "SMTP email requires at least one recipient, a subject, and a body.",
        metadata: {
          tool_id: "send_email_smtp",
          connector_status: "missing_required_input",
          delivery_attempted: false,
          email_delivery_verified: false
        }
      });
    }

    try {
      const result = await sendViaConfiguredSmtpTransport(transport, {
        to,
        cc,
        bcc,
        subject,
        body,
        attachmentPaths: Array.isArray(args.attachmentPaths) ? args.attachmentPaths : []
      });
      if (!result) {
        return createActionResult({
          success: false,
          observation: "Configured SMTP transport does not expose a supported send function.",
          metadata: {
            tool_id: "send_email_smtp",
            connector_status: "unsupported_transport",
            delivery_attempted: false,
            email_delivery_verified: false
          }
        });
      }
      if (result?.success === false || result?.ok === false) {
        return createActionResult({
          success: false,
          observation: result?.observation ?? result?.message ?? "SMTP transport reported send failure.",
          metadata: {
            tool_id: "send_email_smtp",
            connector_status: result?.status ?? "failed",
            delivery_attempted: true,
            email_delivery_verified: false,
            ...(result?.metadata ?? {})
          }
        });
      }
      const messageId = result?.messageId ?? result?.message_id ?? result?.id ?? null;
      return createActionResult({
        success: true,
        observation: `Sent SMTP email to ${to.join(", ")}${messageId ? ` (messageId=${messageId})` : ""}.`,
        metadata: {
          tool_id: "send_email_smtp",
          connector_status: "success",
          sent: true,
          delivery_attempted: true,
          email_delivery_verified: true,
          ...(messageId ? { messageId } : {}),
          ...(result?.metadata ?? {})
        }
      });
    } catch (error) {
      return createActionResult({
        success: false,
        observation: `SMTP send failed: ${error.message}`,
        metadata: {
          tool_id: "send_email_smtp",
          connector_status: "failed",
          delivery_attempted: true,
          email_delivery_verified: false
        }
      });
    }
  }
};

export const COMPOSE_EMAIL_TOOL = {
  id: "compose_email",
  name: "Compose Email",
  description: "Open a mail draft with prefilled recipients, subject, and body.",
  parameters: ACTION_TOOL_SCHEMAS.compose_email,
  risk_level: "low",
  required_capabilities: ["launch_app"],
  requires_confirmation: false,
  formatObservation(args) {
    return `Prepared a draft email to ${(args.to ?? []).join(", ")}`;
  },
  async execute(args = {}) {
    let toList = [];
    if (Array.isArray(args.to)) toList = args.to;
    else if (typeof args.to === "string" && args.to.trim()) toList = [args.to.trim()];

    let ccList = [];
    if (Array.isArray(args.cc)) ccList = args.cc;
    else if (typeof args.cc === "string" && args.cc.trim()) ccList = [args.cc.trim()];

    const subject = args.subject ?? "";
    const body = args.body ?? "";

    const params = [];
    if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
    if (body) params.push(`body=${encodeURIComponent(body)}`);
    if (ccList.length > 0) params.push(`cc=${encodeURIComponent(ccList.join(","))}`);
    const mailto = `mailto:${toList.join(",")}${params.length > 0 ? "?" + params.join("&") : ""}`;

    try {
      await openWithDefaultHandler(mailto);
      const recipients = toList.length > 0 ? toList.join(", ") : "(no recipient)";
      return createActionResult({
        success: true,
        observation: `Opened email draft to ${recipients}${subject ? ` with subject "${subject}"` : ""}.`
      });
    } catch (error) {
      return createActionResult({ success: false, observation: `Failed to open email draft: ${error.message}` });
    }
  }
};
